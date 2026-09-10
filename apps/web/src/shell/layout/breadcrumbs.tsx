/** @module 책임: 현재 경로에서 만든 breadcrumb 항목을 header 폭에 맞춰 한 줄로 렌더링한다. */
'use client';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/shared/ui/breadcrumb';
import { useBreadcrumbs } from './use-breadcrumbs';
import { Icons } from '@/shared/ui/icons';
import { Fragment } from 'react';

export function Breadcrumbs() {
  const items = useBreadcrumbs();
  if (items.length === 0) return null;

  return (
    // G1: 1280에서 세로로 깨지던 문제 — 줄바꿈 금지 + 넘치면 마지막 조각만 말줄임
    <Breadcrumb className='min-w-0'>
      <BreadcrumbList className='flex-nowrap whitespace-nowrap'>
        {items.map((item, index) => (
          <Fragment key={item.title}>
            {index !== items.length - 1 && (
              <BreadcrumbItem className='hidden shrink-0 md:block'>
                <BreadcrumbLink href={item.link}>{item.title}</BreadcrumbLink>
              </BreadcrumbItem>
            )}
            {index < items.length - 1 && (
              <BreadcrumbSeparator className='hidden shrink-0 md:block'>
                <Icons.slash />
              </BreadcrumbSeparator>
            )}
            {index === items.length - 1 && (
              <BreadcrumbPage className='block max-w-[32ch] min-w-0 truncate'>{item.title}</BreadcrumbPage>
            )}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
