/**
 * @module 책임: 로그인 게이트가 붙은 경로의 검사가 Google 왕복 없이 "로그인함"과 "미로그인"을 고르도록
 * 주체만 주입하는 두 authenticator를 빌려준다.
 *
 * 주입 지점을 쓰는 이유는 ADR 0032 §9다. 환경변수나 헤더로 인증을 건너뛰는 분기를 production 코드에
 * 만들면 배포 설정 실수 한 번이 전면 개방이 된다. 여기서 고르는 것은 guard의 입력뿐이고 guard·계약·
 * 응답 경로는 배포와 같은 코드를 지난다.
 */
import type { AuthenticatedSubject } from "../src/platform/auth/auth-identity";
import type { SessionAuthenticator } from "../src/platform/auth/session-authenticator";

export const testSubject: AuthenticatedSubject = {
  subject: "test-provider-user",
  displayName: "김이름",
  email: "reader@example.com",
};

/** 유효한 세션이 있는 요청을 재현한다. 공유 read 검사는 게이트 자체가 아니라 응답 계약을 본다. */
export const signedInSessionAuthenticator: SessionAuthenticator = {
  authenticate: () => Promise.resolve(testSubject),
};

/**
 * 세션이 없는 요청을 재현한다. authenticator를 아예 주입하지 않는 것과 다르다. 그때는 "인증을 켜지 않은
 * 배포"라 503이고, 여기서 확인하려는 것은 인증이 켜진 배포의 미로그인 401이다.
 */
export const anonymousSessionAuthenticator: SessionAuthenticator = {
  authenticate: () => Promise.resolve(null),
};
