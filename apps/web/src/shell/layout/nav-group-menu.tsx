/**
 * @module 책임: navigation 묶음을 왼쪽 메뉴의 항목(아이콘·이름·지금 화면 표시·이동 대기)으로 그린다. 기본 묶음과 상위 layout이 주입한
 * 묶음이 같은 꼴을 쓰고, 묶음 사이는 이름표 대신 선으로 가른다. 폭 단계(넓게·좁게·접힘)는 sidebar wrapper의 폭과 이 항목의
 * 변형 클래스가 함께 정한다.
 */
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Icons } from '@/shared/ui/icons';
import { NavPending } from '@/shared/ui/nav-pending';
import { SidebarGroup } from '@/shared/ui/sidebar';
import type { NavGroup } from './nav-config';

// 넓게: 아이콘 옆 이름(17px). 좁게(sm 이상, nav 폭 아래): 아이콘 아래 이름(14px). 접힘(아이콘 폭): 이름은 읽기 전용으로만 남긴다.
const ITEM_CLASS = [
  'pressable relative flex h-12 w-full items-center gap-3 rounded-control px-3 text-body font-semibold text-muted-foreground',
  'hover:bg-muted aria-[current=page]:bg-brand-weak aria-[current=page]:text-brand-strong',
  'sm:max-nav:h-auto sm:max-nav:flex-col sm:max-nav:justify-center sm:max-nav:gap-1 sm:max-nav:px-0 sm:max-nav:py-2.5 sm:max-nav:text-center sm:max-nav:text-label',
  'group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0',
  '[&_svg]:size-5.5 [&_svg]:shrink-0'
].join(' ');

/** pathname이 아직 없으면(static shell) 지금 화면 표시 없이 같은 menu를 그린다. */
function NavGroupMenu({
  group,
  pathname
}: {
  readonly group: NavGroup;
  readonly pathname: string | null;
}) {
  return (
    <SidebarGroup className='px-3.5 py-0 sm:max-nav:px-2'>
      <ul aria-label={group.label} className='grid gap-1'>
        {group.items.map((item) => {
          const Icon = item.icon ? Icons[item.icon] : Icons.logo;
          if (item.url === '#') return null;
          return (
            <li key={item.title}>
              <Link
                href={item.url}
                aria-current={pathname === item.url ? 'page' : undefined}
                title={item.title}
                data-slot='nav-item'
                className={ITEM_CLASS}
              >
                <Icon aria-hidden />
                <span className='truncate group-data-[collapsible=icon]:sr-only sm:max-nav:whitespace-normal'>
                  {item.title}
                </span>
                <NavPending className='sm:max-nav:absolute sm:max-nav:top-1.5 sm:max-nav:right-1.5 group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-0 group-data-[collapsible=icon]:right-0' />
              </Link>
            </li>
          );
        })}
      </ul>
    </SidebarGroup>
  );
}

function Separated({
  groups,
  pathname
}: {
  readonly groups: readonly NavGroup[];
  readonly pathname: string | null;
}) {
  return groups.map((group, index) => (
    <React.Fragment key={group.label || 'ungrouped'}>
      {index === 0 ? null : (
        <div aria-hidden className='mx-6 my-2.5 h-px bg-line sm:max-nav:mx-4' />
      )}
      <NavGroupMenu group={group} pathname={pathname} />
    </React.Fragment>
  ));
}

// usePathname은 dynamic param route의 static shell을 만드는 동안 suspend한다(ADR 0028). 읽기를 이 leaf로
// 내려 sidebar frame과 menu는 prerender하고 지금 화면 표시만 request 시점에 streaming한다.
function CurrentPathNavGroupMenus({ groups }: { readonly groups: readonly NavGroup[] }) {
  return <Separated groups={groups} pathname={usePathname()} />;
}

export function NavGroupMenus({ groups }: { readonly groups: readonly NavGroup[] }) {
  return (
    <React.Suspense fallback={<Separated groups={groups} pathname={null} />}>
      <CurrentPathNavGroupMenus groups={groups} />
    </React.Suspense>
  );
}
