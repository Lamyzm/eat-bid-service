/** @module 책임: legacy dashboard route를 공통 application shell과 검색 비노출 metadata에 연결한다. */
import { ApplicationShell } from '@/shell/layout/application-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '입찰 인텔리전스',
  description: '입찰 분석과 업무 실행을 위한 운영 대시보드',
  robots: {
    index: false,
    follow: false
  }
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
