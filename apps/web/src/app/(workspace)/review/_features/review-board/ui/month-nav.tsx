/** @module 책임: 복기의 연도·달 탭을 그리고 고른 달을 주소(`month`)에 남겨 서버 조회를 다시 부른다. */
'use client';
import { useQueryStates } from 'nuqs';
import { useTransition } from 'react';

import { reviewSearchParsers } from '@/app/(workspace)/review/_lib/review-search';
import type { ReviewMonthTab } from '../model/present-review';

const TAB =
  'rounded-full border border-border bg-muted/60 px-3.5 py-1.5 text-[14px] font-bold text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground';

/**
 * 몇 년치를 한 번에 펼치지 않는다. 연도를 고르고 그 해의 달 하나를 고른다 — 한 달은 40~150건이라 한 화면에 든다. 연도를 바꾸면 그
 * 해의 가장 최근 달로 간다.
 */
export function MonthNav({
  year,
  month,
  years,
  monthTabs
}: {
  readonly year: string;
  readonly month: string;
  readonly years: readonly { readonly year: string; readonly latestMonth: string }[];
  readonly monthTabs: readonly ReviewMonthTab[];
}) {
  const [pending, startTransition] = useTransition();
  const [, setSearch] = useQueryStates(reviewSearchParsers, { shallow: false, history: 'push', scroll: false, startTransition });
  return (
    <nav aria-label='기간' aria-busy={pending} className='mt-5 grid gap-3'>
      <div role='group' aria-label='연도' className='flex flex-wrap gap-1.5'>
        {years.map((entry) => (
          <button
            key={entry.year}
            type='button'
            aria-current={entry.year === year ? 'page' : undefined}
            onClick={() => void setSearch({ month: entry.latestMonth })}
            className='rounded-md px-2.5 py-1 text-[15px] font-extrabold text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground'
          >
            {entry.year}년
          </button>
        ))}
      </div>
      <div role='group' aria-label={`${year}년 달`} className='flex flex-wrap gap-1.5'>
        {monthTabs.map((tab) => (
          <button
            key={tab.month}
            type='button'
            aria-current={tab.month === month ? 'page' : undefined}
            onClick={() => void setSearch({ month: tab.month })}
            className={TAB}
          >
            {tab.label}
            <span className='ml-1 text-[12px] font-semibold tabular-nums'>{tab.rounds}건{tab.wins > 0 ? ` · 낙찰 ${tab.wins}` : ''}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
