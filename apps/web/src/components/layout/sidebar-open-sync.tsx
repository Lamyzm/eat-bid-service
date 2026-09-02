/** @module 책임: 첫 paint 전 inline script가 적용한 sidebar 접힘 상태를 hydration 직후 SidebarProvider 상태로 넘겨준다. */
'use client';

import { useLayoutEffect } from 'react';

import { SIDEBAR_STATE_ATTRIBUTE, readSidebarOpenCookie } from '@/shell/layout/sidebar-state';
import { useSidebar } from '../ui/sidebar';

export function SidebarOpenSync() {
  const { open, setOpen } = useSidebar();

  // server는 sidebar를 펼친 상태로 static 렌더하고 inline script가 접힘 폭을 미리 적용한다(ADR 0028).
  // hydration 직후 실제 상태를 넘긴 뒤 그 임시 폭 override를 지워 이후 toggle이 정상 동작하게 한다.
  useLayoutEffect(() => {
    const openFromCookie = readSidebarOpenCookie(document.cookie);
    if (openFromCookie !== open) setOpen(openFromCookie);
    document.documentElement.removeAttribute(SIDEBAR_STATE_ATTRIBUTE);
    // 최초 cookie 값만 반영한다. 이후에는 사용자 toggle이 cookie를 소유한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
