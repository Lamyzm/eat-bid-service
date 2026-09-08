/** @module 책임: navigation 설정과 현재 경로를 접을 수 있는 application sidebar로 렌더링하고 footer는 상위 layout의 slot으로 받는다. */
'use client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail
} from '@/components/ui/sidebar';
import { navGroups } from '@/config/nav-config';
import { useFilteredNavGroups } from '@/hooks/use-nav';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Icons } from '@/components/icons';

interface AppSidebarProps {
  /**
   * 세션 계약과 provider client를 읽는 계정 허브는 sidebar가 직접 import하지 않는다. shell은 endpoint를
   * 읽지 않으므로 소유 layout이 이 slot으로 주입한다(ADR 0023, ADR 0032 §1).
   */
  readonly footer?: React.ReactNode;
}

/** pathname이 아직 없으면(static shell) 활성 표시 없이 같은 menu를 그린다. */
function SidebarNavGroups({ pathname }: { readonly pathname: string | null }) {
  const filteredGroups = useFilteredNavGroups(navGroups);

  return (
    <>
      {filteredGroups.map((group) => (
        <SidebarGroup key={group.label || 'ungrouped'} className='py-0'>
          {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
          <SidebarMenu>
            {group.items.map((item) => {
              const Icon = item.icon ? Icons[item.icon] : Icons.logo;
              return item?.items && item?.items?.length > 0 ? (
                <Collapsible
                  key={item.title}
                  defaultOpen={item.isActive}
                  render={<SidebarMenuItem />}
                >
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={pathname === item.url}
                        className='group/collapsible'
                      />
                    }
                  >
                    {item.icon && <Icon />}
                    <span>{item.title}</span>
                    <Icons.chevronRight className='ml-auto transition-transform duration-200 group-data-panel-open/collapsible:rotate-90' />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            render={<Link href={subItem.url} aria-label={subItem.title} />}
                            isActive={pathname === subItem.url}
                          >
                            <span>{subItem.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    render={<Link href={item.url} aria-label={item.title} />}
                    tooltip={item.title}
                    isActive={pathname === item.url}
                  >
                    <Icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}

// usePathname은 dynamic param route의 static shell을 만드는 동안 suspend한다(ADR 0028). 읽기를 이 leaf로
// 내려 sidebar frame과 menu는 prerender하고 활성 표시만 request 시점에 streaming한다.
function CurrentPathNavGroups() {
  const pathname = usePathname();
  return <SidebarNavGroups pathname={pathname} />;
}

export default function AppSidebar({ footer }: AppSidebarProps) {
  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader />
      <SidebarContent className='overflow-x-hidden'>
        <React.Suspense fallback={<SidebarNavGroups pathname={null} />}>
          <CurrentPathNavGroups />
        </React.Suspense>
      </SidebarContent>
      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  );
}
