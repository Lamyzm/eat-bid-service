import CommandPalette from '@/components/command-palette/command-palette';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: '입찰 인텔리전스',
  description: '입찰 분석과 업무 실행을 위한 운영 대시보드',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // 사용자가 선택한 sidebar 상태는 다음 방문에도 유지한다.
  const cookieStore = await cookies();
  // PC 우선: 쿠키가 없으면 라벨이 보이는 확장 상태가 기본 (U12 — 아이콘만 뜨면 초보가 못 씀)
  const sidebarCookie = cookieStore.get('sidebar_state')?.value;
  const defaultOpen = sidebarCookie == null ? true : sidebarCookie === 'true';
  return (
    <CommandPalette>
      <SidebarProvider defaultOpen={defaultOpen}>
        <a
          href='#main-content'
          className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset id='main-content' tabIndex={-1} className='scroll-mt-16'>
          <Header />
          <InfobarProvider defaultOpen={false}>
            {children}
          </InfobarProvider>
        </SidebarInset>
      </SidebarProvider>
    </CommandPalette>
  );
}
