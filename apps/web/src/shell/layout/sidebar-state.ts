/** @module 책임: sidebar 접힘 cookie 이름과 해석 규칙을 inline script·client 동기화가 함께 쓰는 한 곳에 둔다. */
export const SIDEBAR_COOKIE_NAME = 'sidebar_state';

/** 접힘 상태를 첫 paint 전에 알리는 root element 속성. hydration 직후 제거한다. */
export const SIDEBAR_STATE_ATTRIBUTE = 'data-sidebar-state';

/** cookie가 없으면 펼침이 기본이다. shadcn SidebarProvider의 defaultOpen과 같은 규칙을 유지한다. */
export function readSidebarOpenCookie(cookie: string): boolean {
  const match = cookie.match(new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] === 'true' : true;
}
