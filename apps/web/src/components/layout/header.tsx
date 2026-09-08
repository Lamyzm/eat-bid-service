/** @module 책임: breadcrumb·theme control과 상위 layout이 주입한 control slot을 공통 workspace header에 배치한다. */
import React, { Suspense } from 'react';
import { SidebarTrigger } from '../ui/sidebar';
import { Separator } from '../ui/separator';
import { Breadcrumbs } from '../breadcrumbs';
import { ThemeModeToggle, ThemeSelector } from '@/shell';
import { SidebarOpenSync } from './sidebar-open-sync';

interface HeaderProps {
  /**
   * 지역 칩·session 부팅·전역 설정처럼 endpoint를 읽는 legacy control은 header가 직접 import하지 않는다.
   * legacy dashboard layout만 이 slot으로 주입하고 canonical 업무 route는 비워 둔다.
   */
  readonly controls?: React.ReactNode;
  readonly dockControls?: React.ReactNode;
}

/**
 * 헤더는 최소로 — 토글 · 브레드크럼 | (주입된 control) · 모드 · 색상 테마.
 * 계정(이메일·로그아웃)은 사이드바 하단 계정 허브로 이동 (R6 NAV 개편).
 * 색상 테마 선택기는 데스크톱에서 노출하고, 좁은 화면에서는 공간을 확보한다.
 */
export default function Header({ controls, dockControls }: HeaderProps) {
  return (
    <header
      data-slot='workspace-header'
      className='bg-background/60 sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-2 backdrop-blur-md md:h-14'
    >
      {/* G1: min-w-0 없이는 1280에서 브레드크럼이 한 글자씩 세로로 쌓인다 */}
      <div className='flex min-w-0 items-center gap-2 px-4'>
        {/* sidebar 접힘 cookie는 server가 아니라 inline script와 이 client leaf가 읽는다(ADR 0028). */}
        <SidebarOpenSync />
        <SidebarTrigger className='-ml-1' />
        <Separator orientation='vertical' className='mr-2 h-4 data-vertical:self-center' />
        {/* breadcrumb은 usePathname을 읽으므로 dynamic param route의 static shell 뒤에 streaming한다. */}
        <Suspense fallback={null}>
          <Breadcrumbs />
        </Suspense>
      </div>

      <div className='flex shrink-0 items-center gap-1.5 px-4'>
        {controls}
        {dockControls}
        <ThemeModeToggle />
        <div className='hidden sm:block'>
          <ThemeSelector />
        </div>
      </div>
    </header>
  );
}
