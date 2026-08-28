import React from 'react';
import { SidebarTrigger } from '../ui/sidebar';
import { Separator } from '../ui/separator';
import { Breadcrumbs } from '../breadcrumbs';
import { ThemeModeToggle } from '../themes/theme-mode-toggle';
import { RegionSwitcher } from '../region-switcher';
import { SessionBoot } from '../session-boot';
import { GlobalSettingsButton, GlobalSettingsDialog } from '../global-settings';

/**
 * 헤더는 최소로 — 토글 · 브레드크럼 | 지역 칩 · 전역 설정 · 테마 · 알림.
 * 계정(이메일·로그아웃)은 사이드바 하단 계정 허브로 이동 (R6 NAV 개편).
 * 스타터 잔재(깃허브·검색·테마 셀렉터)는 제거했다.
 */
export default function Header() {
  return (
    <header className='bg-background/60 sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-2 backdrop-blur-md md:h-14'>
      {/* G1: min-w-0 없이는 1280에서 브레드크럼이 한 글자씩 세로로 쌓인다 */}
      <div className='flex min-w-0 items-center gap-2 px-4'>
        <SidebarTrigger className='-ml-1' />
        <Separator orientation='vertical' className='mr-2 h-4 data-vertical:self-center' />
        <Breadcrumbs />
      </div>

      <div className='flex shrink-0 items-center gap-1.5 px-4'>
        <SessionBoot />
        <RegionSwitcher />
        <GlobalSettingsButton />
        <ThemeModeToggle />
      </div>

      <GlobalSettingsDialog />
    </header>
  );
}
