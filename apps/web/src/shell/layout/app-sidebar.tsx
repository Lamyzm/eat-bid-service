/** @module 책임: 기본 navigation 묶음과 상위 layout이 주입한 묶음·footer를 접을 수 있는 application sidebar로 조립한다. */
'use client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger
} from '@/shared/ui/sidebar';
import { ThemeModeToggle } from '@/shell/theme/theme-mode-toggle';
import { navGroups } from './nav-config';
import { NavGroupMenus } from './nav-group-menu';
import * as React from 'react';

interface AppSidebarProps {
  /**
   * 세션 계약과 provider client를 읽는 계정 허브는 sidebar가 직접 import하지 않는다. shell은 endpoint를
   * 읽지 않으므로 소유 layout이 이 slot으로 주입한다(ADR 0023, ADR 0032 §1).
   */
  readonly footer?: React.ReactNode;
  /** 세션에 따라 보이는 묶음(운영자의 내 투찰)도 같은 이유로 소유 layout이 판정해 넣는다. 기본 묶음 뒤에 붙는다. */
  readonly extraNav?: React.ReactNode;
}

export default function AppSidebar({ footer, extraNav }: AppSidebarProps) {
  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='px-6.5 pt-6 pb-5 sm:max-nav:px-0 sm:max-nav:pt-5 sm:max-nav:text-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:text-center'>
        <span className='text-title font-extrabold tracking-tight sm:max-nav:text-body group-data-[collapsible=icon]:text-label'>
          eat<span className='text-brand'>bid</span>
        </span>
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        <NavGroupMenus groups={navGroups.filter((group) => group.placement !== 'bottom')} />
        {extraNav}
        {/* 내 사업장처럼 계정에 딸린 묶음은 메뉴 아래쪽, 계정 바로 위에 둔다(#241 시안 D의 "내 자리" 자리). */}
        <div className='mt-auto pt-2.5'>
          <div aria-hidden className='mx-6 mb-2.5 h-px bg-line sm:max-nav:mx-4' />
          <NavGroupMenus groups={navGroups.filter((group) => group.placement === 'bottom')} />
        </div>
      </SidebarContent>
      <SidebarFooter>
        {/* 휴대폰 폭에서는 머리 막대에 명암 전환과 메뉴 단추가 있다. PC 폭에는 머리 막대가 없어 두 단추를 메뉴 아래에 둔다
            — 접은 메뉴를 다시 펴는 길이 키보드에도 남아야 한다. */}
        <div className='hidden flex-wrap items-center gap-1 px-1.5 sm:flex sm:max-nav:justify-center group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center'>
          <ThemeModeToggle />
          <SidebarTrigger aria-label='메뉴 접기·펴기' title='메뉴 접기·펴기' />
        </div>
        {footer}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
