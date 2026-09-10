/**
 * @module 책임: pinned Better Auth 인스턴스의 provider·쿠키·CSRF·계정 연결 정책을 한 자리에서 조립한다.
 *
 * 이 파일이 정하는 것은 전부 보안 판정이다. 값 하나를 바꾸면 세션이 새거나 계정이 합쳐지므로 각 선택에
 * 이유를 남긴다. 표 이름 같은 schema option은 여기서 정하지 않고 저장소 결합이 그대로 실어 온다.
 */
import { betterAuth } from "better-auth";
import type { AuthEnvironment } from "../config/environment";
import type { RedactingJsonLogger } from "../logging/logging.module";
import { createAuthProviderLogger } from "./auth-logger";
import type { AuthDatabaseBinding } from "./auth-database";

export const AUTH_BASE_PATH = "/api/auth";

/**
 * 서명된 세션 사본을 쿠키에 두고 그 수명 동안 세션 조회가 저장소를 읽지 않게 하는 창이다. 로그인
 * 게이트가 요청마다 세션을 보게 되므로 이 값이 없으면 게이트 자체가 요청당 DB 조회 하나가 된다.
 *
 * 60초인 이유: 캐시가 유효한 동안에는 회수된 세션도 통과하므로 그 창이 곧 취소 반영이 늦는 시간이다.
 * 로그아웃은 브라우저 POST가 세션 쿠키와 이 사본을 함께 즉시 무효화하므로 이 창은 "다른 기기에서
 * 회수했을 때"에만 남고, 그 지연을 1분으로 묶는 대신 요청당 조회를 없앤다(ADR 0032 §12).
 */
const SESSION_COOKIE_CACHE_SECONDS = 60;

export interface AuthInstanceInput {
  readonly environment: AuthEnvironment;
  readonly database: AuthDatabaseBinding;
  /** 상태 변경과 콜백 리디렉션을 허용할 origin 집합이다. 서버가 이미 검증한 CORS origin 하나를 재사용한다. */
  readonly trustedOrigins: readonly string[];
  readonly logger: RedactingJsonLogger;
}

export function createAuthInstance(input: AuthInstanceInput) {
  const { environment, database } = input;
  return betterAuth({
    appName: "eatbid",
    baseURL: environment.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: environment.secret,
    database: database.adapter,
    // 기본 logger는 driver 예외를 원문 그대로 console에 쏟는다. 그 예외에는 세션 토큰이 들어 있다.
    logger: createAuthProviderLogger(input.logger),
    ...database.schemaOptions,
    account: {
      ...database.schemaOptions.account,
      accountLinking: {
        // 이메일이 같다는 이유로 provider 계정을 자동으로 합치지 않는다. provider 쪽 이메일 변경이 곧
        // 계정 탈취 경로가 되기 때문이다. 명시적 연결 기능은 재인증과 함께 별도로 만든다(ADR 0032 §9).
        enabled: false,
        disableImplicitLinking: true,
      },
    },
    /**
     * 운영의 가입 방법은 Google 하나다. 이메일·비밀번호를 켜면 메일 발송·재설정·비밀번호 저장이 모두 보안
     * 표면이 되므로 이 값은 환경 경계가 production에서 거부한 개발 전용 opt-in을 그대로 옮긴 것이고, 여기서
     * `NODE_ENV`를 다시 보지 않는다. 판정 자리를 둘로 만들면 둘이 어긋난 배포가 생긴다(ADR 0032 §13).
     *
     * `autoSignIn`을 끄는 이유: 시드가 서버 API로 계정을 만들 때 아무도 들고 있지 않은 세션 행이 남지 않게
     * 한다. 로그인 화면은 sign-in만 부르므로 로그인 흐름에는 영향이 없다.
     */
    emailAndPassword: { enabled: environment.devLoginEnabled, autoSignIn: false },
    session: {
      ...database.schemaOptions.session,
      /**
       * 서명된 세션 사본을 쿠키에 실어 유효한 동안 저장소를 읽지 않는다. 로그인 게이트를 거는 변경과
       * 이 옵션은 한 쌍이다. 게이트만 세우면 화면 진입마다 세션 조회가 하나씩 늘어 게이트가 곧 DB
       * 부하가 된다. 사본은 provider secret으로 서명되므로 브라우저가 내용을 고쳐 통과할 수 없다.
       */
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
      /**
       * GET `/get-session`이 세션 수명을 바꾸지 못하게 한다. 이 옵션이 없으면 GET 하나가 DB `expiresAt`을
       * 연장하면서 `Set-Cookie`를 함께 만드는데, RSC나 서버 간 조회는 그 헤더를 브라우저로 전달하지
       * 못한다. 그러면 DB 수명만 늘고 쿠키는 그대로여서 두 수명이 갈라진다. 만료 세션의 DB 삭제도 GET에서
       * 일어나지 않게 막아, 읽기 한 번이 로그아웃을 확정하지 않는다(설치본 routes/session.mjs 148-190).
       * 실제 갱신은 브라우저가 POST로 요청해 `Set-Cookie`를 직접 받는다.
       */
      deferSessionRefresh: true,
    },
    // Google 자격이 없는 개발 로그인 전용 로컬은 provider를 등록하지 않는다. 빈 자격으로 등록하면 로그인
    // 버튼은 열리는데 Google 왕복이 실패하고, 그 실패는 사용자 오류처럼 보인다.
    socialProviders: environment.google === null
      ? {}
      : {
        google: {
          clientId: environment.google.clientId,
          clientSecret: environment.google.clientSecret,
        },
      },
    // 콜백 URL 검증과 Origin 검사가 이 목록을 쓴다. 별도 목록을 만들면 두 곳이 갈라진다.
    trustedOrigins: [...input.trustedOrigins],
    advanced: {
      // http loopback dev에서 Secure를 강제하면 브라우저가 세션 쿠키를 버려 매 요청이 미로그인이 된다.
      // 값의 근거는 base URL의 scheme이며 환경 경계가 이미 판정했다.
      useSecureCookies: environment.useSecureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
  });
}

/**
 * 타입을 `ReturnType<typeof betterAuth>`로 넓히지 않는다. provider는 전달한 option에서 endpoint와 context
 * 타입을 좁혀 만들고, 넓은 타입으로 되돌리면 우리가 실제로 켠 설정과 다른 계약을 컴파일러가 믿는다.
 */
export type AuthInstance = ReturnType<typeof createAuthInstance>;
