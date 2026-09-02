/** @module 책임: legacy dashboard route를 공통 application shell·nuqs adapter·request 시점 경계와 검색 비노출 metadata에 연결한다. */
import { ApplicationShell } from '@/shell/layout/application-shell';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Suspense } from 'react';
import { SidebarAccount } from '@/components/layout/sidebar-account';
import { InfobarProvider } from '@/components/ui/infobar';
import { DashboardScreenSkeleton } from './_ui/dashboard-screen-skeleton';
import { LegacyHeaderControls } from './_ui/legacy-header-controls';

// legacy dashboard는 Cache Components 검증에서 제외한다(ADR 0028). canonical route로 옮길 때 지운다.
export const instant = false;

export const metadata: Metadata = {
  title: '입찰 인텔리전스',
  description: '입찰 분석과 업무 실행을 위한 운영 대시보드',
  robots: {
    index: false,
    follow: false
  }
};

// legacy page는 render 중 new Date() 같은 동기 IO를 쓰고 nuqs·infobar는 useSearchParams·usePathname으로
// request 값을 읽는다. 셋 다 prerender에서는 instant=false로도 허용되지 않으므로, shell 아래 subtree만
// connection()으로 request 시점에 묶어 shell은 static으로 두고 dashboard 본문은 streaming한다.
async function LegacyRequestBoundary({ children }: { readonly children: React.ReactNode }) {
  await connection();
  return (
    <NuqsAdapter>
      <InfobarProvider defaultOpen={false}>{children}</InfobarProvider>
    </NuqsAdapter>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ApplicationShell headerControls={<LegacyHeaderControls />} sidebarFooter={<SidebarAccount />}>
      <Suspense fallback={<DashboardScreenSkeleton />}>
        <LegacyRequestBoundary>{children}</LegacyRequestBoundary>
      </Suspense>
    </ApplicationShell>
  );
}
