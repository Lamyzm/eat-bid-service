import { describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';

import { proxy } from './proxy';
import { RETURN_PATH_HEADER } from '@/shell/auth/return-path';
import { SESSION_TOKEN_COOKIE_NAME } from '@/shell/auth/session-cookie';

const ORIGIN = 'https://eatbid.example';

function requestFor(path: string, options: { readonly signedIn?: boolean } = {}): NextRequest {
  const request = new NextRequest(new URL(path, ORIGIN));
  if (options.signedIn) request.cookies.set(SESSION_TOKEN_COOKIE_NAME, 'signed-token');
  return request;
}

function redirectTarget(path: string, options?: { readonly signedIn?: boolean }): string | null {
  const response = proxy(requestFor(path, options));
  const location = response.headers.get('location');
  return location === null
    ? null
    : new URL(location, ORIGIN).pathname + new URL(location, ORIGIN).search;
}

describe('로그인 게이트 proxy', () => {
  it('미로그인 업무 화면 요청을 보던 경로와 함께 로그인으로 보낸다', () => {
    expect(redirectTarget('/today?region=41')).toBe('/login?next=%2Ftoday%3Fregion%3D41');
    expect(redirectTarget('/auctions/9007199254740993')).toBe(
      '/login?next=%2Fauctions%2F9007199254740993'
    );
  });

  it('soft navigation의 내부 cache-buster는 복귀 경로에 싣지 않는다', () => {
    expect(redirectTarget('/today?region=41&_rsc=abc123')).toBe(
      '/login?next=%2Ftoday%3Fregion%3D41'
    );
    expect(redirectTarget('/today?_rsc=abc123')).toBe('/login?next=%2Ftoday');
  });

  it('목록에 없는 새 화면도 기본이 로그인이다', () => {
    // 열 것을 적는 목록이므로 화면이 늘어도 공개가 기본값이 되지 않는다.
    expect(redirectTarget('/reports/2026-09')).toBe('/login?next=%2Freports%2F2026-09');
  });

  it('로그인·설정 화면은 세션 없이 열린다', () => {
    expect(redirectTarget('/login')).toBeNull();
    expect(redirectTarget('/setup?next=%2Ftoday')).toBeNull();
  });

  it('세션 쿠키가 있으면 업무 화면을 그대로 통과시킨다', () => {
    expect(redirectTarget('/today', { signedIn: true })).toBeNull();
  });

  it('Nest ingress와 캐시 무효화 handler, Sentry tunnel은 게이트가 만지지 않는다', () => {
    for (const path of [
      '/api/v1/auctions',
      '/api/auth/get-session',
      '/internal/cache/revalidate',
      '/monitoring'
    ]) {
      expect([path, redirectTarget(path)]).toEqual([path, null]);
    }
  });

  it('통과시킨 화면 요청에는 요청 경로를 실어 화면 트리가 복귀 경로를 잃지 않게 한다', () => {
    const response = proxy(requestFor('/today?region=41', { signedIn: true }));
    expect(response.headers.get('x-middleware-override-headers')).toContain(RETURN_PATH_HEADER);
  });

  it('브라우저가 넣은 복귀 경로 헤더를 요청 경로로 덮어쓴다', () => {
    const request = requestFor('/today', { signedIn: true });
    request.headers.set(RETURN_PATH_HEADER, 'https://attacker.example/steal');
    expect(proxy(request).headers.get(`x-middleware-request-${RETURN_PATH_HEADER}`)).toBe('/today');
  });

  it('화면 표면 응답에는 색인 거부를 붙이고 Nest ingress에는 붙이지 않는다', () => {
    expect(proxy(requestFor('/today', { signedIn: true })).headers.get('x-robots-tag')).toBe(
      'noindex, nofollow'
    );
    expect(proxy(requestFor('/today')).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(proxy(requestFor('/login')).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(proxy(requestFor('/api/v1/auctions')).headers.get('x-robots-tag')).toBeNull();
  });
});
