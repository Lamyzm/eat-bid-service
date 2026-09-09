import { describe, expect, it } from 'bun:test';

import { SESSION_TOKEN_COOKIE_NAME, hasProviderSessionCookie } from './session-cookie';

function cookieJar(...names: readonly string[]): { has(name: string): boolean } {
  const present = new Set(names);
  return { has: (name) => present.has(name) };
}

describe('provider 세션 쿠키 판정', () => {
  it('세션 토큰 쿠키가 있으면 로그인한 요청으로 본다', () => {
    expect(hasProviderSessionCookie(cookieJar(SESSION_TOKEN_COOKIE_NAME))).toBe(true);
  });

  it('Secure 배포의 __Secure- 접두사 이름도 같은 쿠키로 본다', () => {
    expect(hasProviderSessionCookie(cookieJar(`__Secure-${SESSION_TOKEN_COOKIE_NAME}`))).toBe(true);
  });

  it('세션 사본 쿠키만으로는 로그인했다고 보지 않는다', () => {
    // 사본은 검증을 건너뛰는 캐시일 뿐이고 인증 근거는 서명된 세션 토큰이다.
    expect(hasProviderSessionCookie(cookieJar('better-auth.session_data'))).toBe(false);
  });

  it('테마·사이드바처럼 앱이 쓰는 다른 쿠키는 세션으로 보지 않는다', () => {
    expect(hasProviderSessionCookie(cookieJar('active_theme', 'sidebar_state'))).toBe(false);
  });
});
