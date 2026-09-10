/** @module 책임: 공고 분석 조건 링크를 기존 shadcn 메뉴의 키보드 탐색과 현재 선택 표기로 제공한다. */
'use client';

import Link from 'next/link';
import { Button } from '@/shared/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import type { DecisionRoute } from '../_lib/decision-search-params';
import { useDecisionRoute } from './evidence-view';

export type ConditionChoice = { readonly label: string; readonly href: DecisionRoute; readonly selected: boolean };

export function ConditionMenu({ label, value, choices }: {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly ConditionChoice[];
}) {
  // 근거 탭은 서버 왕복 없이 바뀜다. 조건을 바꾸는 주소가 서버가 아는 탭을 그대로 실으면 방금 고른 탭이 되돌아간다.
  const route = useDecisionRoute();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='secondary' className='max-w-full' />} aria-label={`${label}: ${value}`}>
        <span className='text-muted-foreground'>{label}</span>
        <span className='max-w-48 truncate'>{value}</span>
        <span aria-hidden='true'>▾</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='min-w-48 max-w-[calc(100vw-2rem)]'>
        {choices.map((choice) => (
          <DropdownMenuLinkItem key={choice.href} closeOnClick render={<Link href={route(choice.href)} scroll={false} aria-label={choice.label} />} aria-current={choice.selected ? 'true' : undefined}>
            <span className='w-4 shrink-0' aria-hidden='true'>{choice.selected ? '✓' : ''}</span>
            <span className='whitespace-normal break-keep'>{choice.label}</span>
          </DropdownMenuLinkItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
