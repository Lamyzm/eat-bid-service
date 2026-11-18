/** @module 책임: breadcrumb·명암 전환과 상위 layout이 주입한 control slot을 공통 workspace header에 배치한다. */
import React, { Suspense } from 'react';
import { SidebarTrigger } from '@/shared/ui/sidebar';
import { Separator } from '@/shared/ui/separator';
import { Breadcrumbs } from './breadcrumbs';
import { ThemeModeToggle } from '@/shell';
import { SidebarOpenSync } from './sidebar-open-sync';

interface HeaderProps {
  /**
   * 지역 칩·session 부팅·전역 설정처럼 endpoint를 읽는 legacy control은 header가 직접 import하지 않는다.
   * legacy dashboard layout만 이 slot으로 주입하고 canonical 업무 route는 비워 둔다.
   */
  readonly controls?: React.ReactNode;
}

/**
 * 헤더는 최소로 — 토글 · 브레드크럼 | (주입된 control) · 명암 전환.
 * 휴대폰 폭(sm 아래)에서만 보인다. 메뉴가 Sheet라 여는 단추가 필요해서다. PC에서는 왼쪽 메뉴가 늘 보이고 화면 제목이
 * 경로를 대신하므로 막대를 두지 않는다 — 첫 화면에 공고 줄 하나를 더 들인다(#241). PC의 명암 전환은 메뉴 아래에 있다.
 * 계정(이메일·로그아웃)은 사이드바 하단 계정 허브로 이동 (R6 NAV 개편).
 * 색 테마는 하나뿐이라 고르는 자리를 두지 않는다(#240).
 */
export default function Header({ controls }: HeaderProps) {
  return (
    <header
      data-slot='workspace-header'
      className='bg-background/60 sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-2 backdrop-blur-md sm:hidden'
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
        <ThemeModeToggle />
      </div>
    </header>
  );
}
