/** @module 책임: sidebar 열림 cookie를 Suspense 안 request 시점에 읽어 static shell을 깨지 않고 client sidebar 상태에 전달한다. */
import { cookies } from 'next/headers';

import { SidebarOpenSync } from './sidebar-open-sync';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';

// shell에서 cookies()를 직접 읽으면 모든 route의 shell이 request-bound가 된다(ADR 0028). 이 leaf만
// Suspense 안에서 cookie를 읽고 sidebar는 기본 열림으로 먼저 prerender한 뒤 저장된 상태로 맞춘다.
export async function SidebarStateLoader() {
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value;
  const open = sidebarCookie == null ? true : sidebarCookie === 'true';
  return <SidebarOpenSync open={open} />;
}
