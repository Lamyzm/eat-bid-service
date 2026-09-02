/** @module 책임: sidebar·header·command palette와 단일 main landmark를 공통 workspace shell로 조립한다. */
import CommandPalette from '@/components/command-palette/command-palette';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { cookies } from 'next/headers';

interface ApplicationShellProps {
  readonly children: React.ReactNode;
  /** legacy dashboard처럼 endpoint를 읽는 header control은 shell이 아니라 상위 layout이 주입한다. */
  readonly headerControls?: React.ReactNode;
  /** session store를 읽는 계정 허브도 같은 이유로 상위 layout이 sidebar footer로 주입한다. */
  readonly sidebarFooter?: React.ReactNode;
}

/** 업무 route들이 같은 탐색·테마·사이드바 chrome을 공유하도록 소유하는 서버 셸이다. */
export async function ApplicationShell({ children, headerControls, sidebarFooter }: ApplicationShellProps) {
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_state')?.value;
  const defaultOpen = sidebarCookie == null ? true : sidebarCookie === 'true';

  return (
    <CommandPalette>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href='#main-content'
          className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
        >
          본문으로 건너뛰기
        </a>
        <AppSidebar footer={sidebarFooter} />
        <SidebarInset id='main-content' tabIndex={-1} className='scroll-mt-16'>
          <Header controls={headerControls} />
          <InfobarProvider defaultOpen={false}>{children}</InfobarProvider>
        </SidebarInset>
      </SidebarProvider>
    </CommandPalette>
  );
}
