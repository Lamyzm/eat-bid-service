/** @module 책임: 시도·시군구와 기간을 고르는 막대를 그리고, 고른 값을 주소에 남겨 서버 조회를 다시 부른다. */
'use client';
import { useQueryStates } from 'nuqs';
import { useId, useState, useTransition } from 'react';

import { controlPillClass, controlPillIconClass } from '@/shared/ui/control-pill';
import { Icons } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/cn';
import { floorSearchParsers, type FloorPeriodKey } from '@/app/(workspace)/floor/_lib/floor-search';
import { countText } from '@/entities/floor-line/floor-units';
import type { FloorRegionGroup } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { rememberRegion } from '../model/remember-region';

const PERIODS: readonly { readonly key: FloorPeriodKey; readonly label: string }[] = [
  { key: '3m', label: '최근 3달' },
  { key: '1y', label: '최근 1년' },
  { key: '3y', label: '최근 3년' }
];

const CHIP =
  'inline-flex min-h-11 items-center rounded-full border border-border bg-background px-4 text-[14px] font-semibold text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background';

/**
 * 시도를 바꾸면 시군구를 고를 때까지 조회하지 않는다. 시도만 바꾼 순간 첫 시군구를 불러오면 원하지 않은 지역 점 수천 개를
 * 한 번 더 받는다.
 */
export function RegionBar({
  groups,
  period,
  regionId,
  sidoId
}: {
  readonly groups: readonly FloorRegionGroup[];
  readonly period: FloorPeriodKey;
  readonly regionId: string | null;
  readonly sidoId: string | null;
}) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [, setSearch] = useQueryStates(
    { region: floorSearchParsers.region, period: floorSearchParsers.period },
    { shallow: false, history: 'push', scroll: false, startTransition }
  );
  const [sido, setSido] = useState(sidoId ?? '');
  const group = groups.find((entry) => entry.id === sido) ?? null;
  const sigunguValue = group !== null && group.id === sidoId && regionId !== null ? regionId : '';
  const pickRegion = (next: string) => {
    if (next === '') return;
    rememberRegion(next);
    void setSearch({ region: next, period });
  };
  return (
    <div aria-busy={pending} className='flex flex-wrap items-center gap-x-5 gap-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className={cn(controlPillClass, 'h-11 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50')}>
          <label htmlFor={`${id}-sido`} className='text-xs whitespace-nowrap text-muted-foreground'>
            시도
          </label>
          <select
            id={`${id}-sido`}
            value={sido}
            onChange={(event) => setSido(event.target.value)}
            className='min-w-0 flex-1 appearance-none bg-transparent text-[15px] font-semibold text-foreground outline-none'
          >
            {sido === '' ? <option value=''>고르세요</option> : null}
            {groups.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <Icons.chevronDown aria-hidden className={controlPillIconClass} />
        </span>
        <span className={cn(controlPillClass, 'h-11 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50')}>
          <label htmlFor={`${id}-sigungu`} className='text-xs whitespace-nowrap text-muted-foreground'>
            시군구
          </label>
          <select
            id={`${id}-sigungu`}
            value={sigunguValue}
            disabled={group === null}
            onChange={(event) => pickRegion(event.target.value)}
            className='min-w-0 flex-1 appearance-none bg-transparent text-[15px] font-semibold text-foreground outline-none'
          >
            {sigunguValue === '' ? <option value=''>고르세요</option> : null}
            {(group?.sigungu ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({countText(entry.count)}건)
              </option>
            ))}
          </select>
          <Icons.chevronDown aria-hidden className={controlPillIconClass} />
        </span>
      </div>
      <div role='group' aria-label='기간' className='flex flex-wrap gap-1.5'>
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type='button'
            aria-pressed={entry.key === period}
            onClick={() => void setSearch({ region: regionId, period: entry.key })}
            className={CHIP}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {pending ? (
        <span role='status' className='text-[13px] text-muted-foreground'>
          불러오는 중이에요
        </span>
      ) : null}
    </div>
  );
}
