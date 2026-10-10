/** @module 책임: 기본 navigation 묶음과 상위 layout이 주입한 묶음·footer를 접을 수 있는 application sidebar로 조립한다. */
'use client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail
} from '@/shared/ui/sidebar';
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
      <SidebarHeader />
      <SidebarContent className='overflow-x-hidden'>
        <NavGroupMenus groups={navGroups} />
        {extraNav}
      </SidebarContent>
      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  );
}
