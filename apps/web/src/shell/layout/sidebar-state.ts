/** @module 책임: sidebar 접힘 cookie 이름과 해석 규칙을 inline script·client 동기화가 함께 쓰는 한 곳에 둔다. */

/**
 * cookie를 쓰는 쪽은 `components/ui/sidebar.tsx`의 `SidebarProvider`이지만 그 파일은 legacy fingerprint로
 * 동결돼 상수를 export할 수 없다. 이름이 갈라지면 오류 없이 기본값으로 되돌아가므로
 * `sidebar-state.test.tsx`가 provider가 실제로 쓰는 cookie를 이 상수로 읽어 두 곳을 묶는다.
 */
export const SIDEBAR_COOKIE_NAME = 'sidebar_state';

/** 접힘 상태를 첫 paint 전에 알리는 root element 속성. hydration 직후 제거한다. */
export const SIDEBAR_STATE_ATTRIBUTE = 'data-sidebar-state';

/** cookie가 없으면 펼침이 기본이다. shadcn SidebarProvider의 defaultOpen과 같은 규칙을 유지한다. */
export function readSidebarOpenCookie(cookie: string): boolean {
  const match = cookie.match(new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] === 'true' : true;
}
