/** @module 책임: 로그인 게이트가 보는 provider 세션 쿠키의 이름 규칙과 그 존재 판정을 소유한다. */

/**
 * 이름 규칙의 근거는 설치본 `better-auth/cookies`다. prefix 기본값이 `better-auth`이고 `Secure` 배포는
 * `__Secure-`를 앞에 붙인다. 서버가 `advanced.cookiePrefix`를 바꾸면 이 이름도 같이 바꾼다.
 *
 * 같은 규칙이 `api/_transport/private-server-request.server.ts`에도 있다. 그쪽은 Nest로 넘길 인증 쿠키
 * **전부**를 고르고 여기는 "세션이 있다고 볼 근거" 하나만 고르므로 판정이 서로 다르며, 층 의존 방향이
 * `api → shell`을 허용하지 않아 한쪽이 다른 쪽을 import하지 않는다. prefix를 바꾸는 변경은 두 곳을 같이 고친다.
 */
export const SESSION_TOKEN_COOKIE_NAME = 'better-auth.session_token';
const SECURE_COOKIE_PREFIX = '__Secure-';

/**
 * 게이트는 쿠키가 있는지만 본다. 값을 해석하거나 검증하지 않는 이유는 두 가지다. 첫째, 검증 열쇠는
 * 서버에 있고 요청마다 그것을 부르면 게이트 자체가 왕복 하나가 된다. 둘째, 이 판정은 인가가 아니라
 * 화면 안내이며 권위는 Nest guard다(ADR 0032 §1). 위조한 쿠키로 얻을 수 있는 것은 401을 받는 화면뿐이다.
 */
export function hasProviderSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return (
    cookies.has(SESSION_TOKEN_COOKIE_NAME) ||
    cookies.has(`${SECURE_COOKIE_PREFIX}${SESSION_TOKEN_COOKIE_NAME}`)
  );
}
