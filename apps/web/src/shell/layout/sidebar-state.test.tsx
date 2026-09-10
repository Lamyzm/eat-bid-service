import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { SidebarProvider, useSidebar } from '@/shared/ui/sidebar';
import { SIDEBAR_COOKIE_NAME, readSidebarOpenCookie } from './sidebar-state';

function CollapseButton() {
  const { setOpen } = useSidebar();
  return (
    <button type='button' onClick={() => setOpen(false)}>
      접기
    </button>
  );
}

describe('sidebar 접힘 cookie', () => {
  afterEach(() => {
    cleanup();
  });

  test('cookie가 없으면 펼침, "false"면 접힘으로 읽는다', () => {
    expect(readSidebarOpenCookie('')).toBe(true);
    expect(readSidebarOpenCookie('other=1')).toBe(true);
    expect(readSidebarOpenCookie(`${SIDEBAR_COOKIE_NAME}=true`)).toBe(true);
    expect(readSidebarOpenCookie(`other=1; ${SIDEBAR_COOKIE_NAME}=false`)).toBe(false);
  });

  test('SidebarProvider가 실제로 기록하는 cookie를 같은 이름으로 읽는다', async () => {
    const screen = render(
      <SidebarProvider>
        <CollapseButton />
      </SidebarProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: '접기' }));

    expect(readSidebarOpenCookie(document.cookie)).toBe(false);
  });
});
