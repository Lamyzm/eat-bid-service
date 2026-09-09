/**
 * @module 책임: 업무 화면 요청이 렌더를 시작하기 전에 provider 세션 쿠키 유무로 로그인 화면 이동을
 * 결정하고, 앱 표면 응답에 색인 거부 헤더를 붙인다.
 *
 * 여기서 하는 것은 인가가 아니라 안내다. 권위는 Nest guard이며 그것이 401을 돌려주기 때문에 데이터가
 * 새지 않는다(ADR 0032 §1·§12). 이 자리에서 세션을 서버에 물어보지 않는 이유는 두 가지다. 요청마다
 * 왕복 하나가 붙어 게이트 자체가 부하가 되고, 헤더 조작으로 우회된 전례(CVE-2025-29927)가 있는 지점을
 * 유일한 판정으로 삼으면 진실 원천이 둘이 된다. app 계정 초기화 여부는 쿠키가 답할 수 없으므로
 * `(workspace)/layout.tsx`의 세션 계약 loader가 맡는다.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { RETURN_PATH_HEADER, loginRouteWithReturn } from '@/shell/auth/return-path';
import { hasProviderSessionCookie } from '@/shell/auth/session-cookie';

/**
 * 게이트와 색인 거부 둘 다에서 빠지는 경로다. Nest ingress와 캐시 무효화 handler는 화면이 아니라
 * 각자의 토큰·guard로 스스로를 지키고, Sentry tunnel은 브라우저가 보내는 보고 경로다. 화면을 여기에
 * 더하면 그 화면만 조용히 공개되므로 목록은 화면이 아닌 표면만 담는다.
 */
const NON_SCREEN_PREFIXES = ['/api', '/internal', '/monitoring'] as const;

/**
 * 세션 없이 열려야 하는 화면이다. 로그인·설정을 게이트가 막으면 로그인하러 갈 곳이 없어진다.
 * 나머지는 전부 막는다. 열 것을 적는 목록이라 새 업무 route가 기본으로 공개되지 않는다.
 */
const OPEN_SCREEN_PREFIXES = ['/login', '/setup'] as const;

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * 색인 거부는 화면 표면 전체에 붙인다. 사이트가 검색되는 것과 공고 데이터가 검색되는 것은 다른 일이고,
 * 지금 이 앱에는 검색돼야 할 화면이 없다. 로그인·설정도 여기 포함된다.
 */
function screenResponse(response: NextResponse): NextResponse {
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}

/**
 * Next는 soft navigation과 prefetch 요청에 `_rsc` cache-buster를 붙인다. 그 값이 복귀 경로에 실리면
 * 로그인을 마친 사용자가 내부 parameter가 남은 주소로 돌아간다. 사용자가 보던 주소만 남긴다.
 */
function screenPath(url: NextRequest['nextUrl']): string {
  const search = new URLSearchParams(url.search);
  search.delete('_rsc');
  const query = search.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (NON_SCREEN_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix))) {
    return NextResponse.next();
  }
  const path = screenPath(request.nextUrl);
  if (
    OPEN_SCREEN_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix)) ||
    hasProviderSessionCookie(request.cookies)
  ) {
    // 화면 트리는 자기 URL을 받지 못한다. 미초기화 사용자를 설정으로 보낼 때 보던 화면을 잃지 않도록
    // 요청 경로를 여기서 한 번 실어 준다. 브라우저가 같은 이름을 넣어 보내도 이 대입이 덮어쓴다.
    const headers = new Headers(request.headers);
    headers.set(RETURN_PATH_HEADER, path);
    return screenResponse(NextResponse.next({ request: { headers } }));
  }
  return screenResponse(NextResponse.redirect(new URL(loginRouteWithReturn(path), request.url)));
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)'
  ]
};
