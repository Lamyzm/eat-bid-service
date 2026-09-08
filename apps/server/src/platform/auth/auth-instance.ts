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
    // 이번 범위의 가입 방법은 Google 하나다. 이메일·비밀번호를 켜면 메일 발송·재설정·비밀번호 저장이
    // 모두 이 슬라이스의 보안 표면이 된다.
    emailAndPassword: { enabled: false },
    session: {
      ...database.schemaOptions.session,
      /**
       * GET `/get-session`이 세션 수명을 바꾸지 못하게 한다. 이 옵션이 없으면 GET 하나가 DB `expiresAt`을
       * 연장하면서 `Set-Cookie`를 함께 만드는데, RSC나 서버 간 조회는 그 헤더를 브라우저로 전달하지
       * 못한다. 그러면 DB 수명만 늘고 쿠키는 그대로여서 두 수명이 갈라진다. 만료 세션의 DB 삭제도 GET에서
       * 일어나지 않게 막아, 읽기 한 번이 로그아웃을 확정하지 않는다(설치본 routes/session.mjs 148-190).
       * 실제 갱신은 브라우저가 POST로 요청해 `Set-Cookie`를 직접 받는다.
       */
      deferSessionRefresh: true,
    },
    socialProviders: {
      google: {
        clientId: environment.googleClientId,
        clientSecret: environment.googleClientSecret,
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
