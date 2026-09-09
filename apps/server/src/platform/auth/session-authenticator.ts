/**
 * @module 책임: 요청 헤더에서 provider 세션 주체를 얻는 port와 그 부재·장애의 구분을 정의한다.
 *
 * port를 두는 이유는 두 가지다. guard가 provider library를 직접 알지 않아도 되고, 테스트가 Google
 * 네트워크 대신 주체만 주입할 수 있다. production 코드에는 환경변수나 헤더로 인증을 건너뛰는 분기를
 * 만들지 않는다. 주입 지점은 bootstrap 하나뿐이다(ADR 0032 §9).
 */
import type { AuthenticatedSubject } from "./auth-identity";

export class AuthDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause?: unknown) {
    super("Authentication dependency is unavailable", { cause });
    this.name = "AuthDependencyUnavailable";
  }
}

export interface SessionAuthenticator {
  /** 유효한 세션이 없으면 `null`이다. 의존성 장애는 `AuthDependencyUnavailable`로 구분해 던진다. */
  authenticate(headers: Headers): Promise<AuthenticatedSubject | null>;
}

/**
 * 인증을 켜지 않은 배포의 authenticator다. 미로그인으로 조용히 통과시키지 않고 의존성 없음을 말한다.
 * 그래야 "로그인하면 된다"는 화면 안내와 "이 배포는 아직 로그인을 켜지 않았다"가 구분된다.
 */
export const unavailableSessionAuthenticator: SessionAuthenticator = {
  authenticate: () => Promise.reject(new AuthDependencyUnavailable()),
};
