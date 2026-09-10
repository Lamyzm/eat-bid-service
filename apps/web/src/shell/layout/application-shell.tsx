/** @module 책임: 탐색·헤더·전역 보조 영역과 command palette를 단일 main landmark의 공통 workspace shell로 조립한다. */
import CommandPalette from './command-palette/command-palette';
import AppSidebar from './app-sidebar';
import Header from './header';
import { SidebarInset, SidebarProvider } from '@/shared/ui/sidebar';
import { DockSlotHost, DockSlotsProvider } from '@/shared/ui/workspace-dock-slots';
import { WorkspaceHeaderTools, WorkspaceToolRail } from './workspace-dock';
import './workspace-layout.css';

interface ApplicationShellProps {
  readonly children: React.ReactNode;
  /** legacy dashboard처럼 endpoint를 읽는 header control은 shell이 아니라 상위 layout이 주입한다. */
  readonly headerControls?: React.ReactNode;
  /** session store를 읽는 계정 허브도 같은 이유로 상위 layout이 sidebar footer로 주입한다. */
  readonly sidebarFooter?: React.ReactNode;
}

/**
 * 업무 route들이 같은 탐색·테마·사이드바 chrome을 공유하도록 소유하는 서버 셸이다.
 * cookies()를 읽지 않아 static shell로 prerender되며, sidebar 열림 cookie는 header의 Suspense leaf가
 * request 시점에 반영한다(ADR 0028). legacy infobar는 usePathname으로 route를 읽고 dashboard 화면만
 * 쓰므로 dashboard layout이 소유한다.
 */
export function ApplicationShell({
  children,
  headerControls,
  sidebarFooter
}: ApplicationShellProps) {
  return (
    <CommandPalette>
      <DockSlotsProvider>
        <SidebarProvider>
          <a
            href='#main-content'
            className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
          >
            본문으로 건너뛰기
          </a>
          <AppSidebar footer={sidebarFooter} />
          <SidebarInset
            id='main-content'
            tabIndex={-1}
            className='scroll-mt-16'
            data-workspace-shell
          >
            <Header controls={headerControls} dockControls={<WorkspaceHeaderTools />} />
            <div data-slot='workspace-columns'>
              <div data-slot='workspace-page'>{children}</div>
              <DockSlotHost slot='panel' />
              <WorkspaceToolRail />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </DockSlotsProvider>
    </CommandPalette>
  );
}
