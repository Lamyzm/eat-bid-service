/** @module 책임: navigation 묶음을 현재 경로의 활성 표시와 함께 sidebar menu로 그린다. 기본 묶음과 상위 layout이 주입한 묶음이 같은 모양을 쓴다. */
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Icons } from '@/shared/ui/icons';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from '@/shared/ui/sidebar';
import type { NavGroup } from './nav-config';

/** pathname이 아직 없으면(static shell) 활성 표시 없이 같은 menu를 그린다. */
function NavGroupMenu({ group, pathname }: { readonly group: NavGroup; readonly pathname: string | null }) {
  return (
    <SidebarGroup className='py-0'>
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
                <Icons.chevronRight className='ml-auto transition-transform duration-[var(--motion-duration-panel)] group-data-panel-open/collapsible:rotate-90' />
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
  );
}

// usePathname은 dynamic param route의 static shell을 만드는 동안 suspend한다(ADR 0028). 읽기를 이 leaf로
// 내려 sidebar frame과 menu는 prerender하고 활성 표시만 request 시점에 streaming한다.
function CurrentPathNavGroupMenus({ groups }: { readonly groups: readonly NavGroup[] }) {
  const pathname = usePathname();
  return groups.map((group) => <NavGroupMenu key={group.label || 'ungrouped'} group={group} pathname={pathname} />);
}

export function NavGroupMenus({ groups }: { readonly groups: readonly NavGroup[] }) {
  return (
    <React.Suspense
      fallback={groups.map((group) => <NavGroupMenu key={group.label || 'ungrouped'} group={group} pathname={null} />)}
    >
      <CurrentPathNavGroupMenus groups={groups} />
    </React.Suspense>
  );
}
