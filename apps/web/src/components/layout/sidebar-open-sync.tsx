/** @module 책임: request 시점에 읽은 sidebar cookie 값을 paint 전에 SidebarProvider 상태로 반영한다. */
'use client';

import { useLayoutEffect } from 'react';

import { useSidebar } from '../ui/sidebar';

export function SidebarOpenSync({ open }: { readonly open: boolean }) {
  const { open: currentOpen, setOpen } = useSidebar();

  // streaming으로 도착한 이 chunk가 그려지기 전에 상태를 맞춰 접힌 sidebar가 펼쳐진 채 보이는 시간을 줄인다.
  useLayoutEffect(() => {
    if (currentOpen !== open) setOpen(open);
    // 최초 cookie 값만 반영한다. 이후 사용자 toggle이 cookie를 소유한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
