/** @module 책임: 달별 보기(지난 기록 경고, 표·산 모양 고르기, 몰린 칸 따라가기 검정)를 묶는다. */
'use client';
import { useMemo, useState } from 'react';

import type { FloorPeriod } from '@/app/(workspace)/floor/_lib/floor-period';
import type { FloorData } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { presentChance } from '../model/present-chance';
import { presentMonths } from '../model/present-months';
import { ChanceCard } from './chance-card';
import { MonthsRidge } from './months-ridge';
import { MonthsTable } from './months-table';

const SEGMENT = 'min-h-11 px-4 text-[14px] font-semibold text-muted-foreground aria-pressed:bg-foreground aria-pressed:text-background';

export function MonthsPanel({ data, period, width }: { readonly data: FloorData; readonly period: FloorPeriod; readonly width: number }) {
  const [shape, setShape] = useState<'table' | 'ridge'>('table');
  const months = useMemo(() => presentMonths(data.points, period, width), [data.points, period, width]);
  // 순열 검정은 수천 번 다시 센다. 탭을 처음 열 때 한 번, 칸 너비를 바꿀 때 한 번만 센다.
  const chance = useMemo(() => presentChance(data.points, period, data.quantiles, width), [data.points, period, data.quantiles, width]);
  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
        <p className='max-w-[66ch] text-muted-foreground'>달마다 하한선이 가장 많이 나온 칸이에요. 칸 너비는 공고별 보기에서 고른 것과 같아요.</p>
        <div role='group' aria-label='보는 방식' className='inline-flex overflow-hidden rounded-xl border border-border'>
          <button type='button' aria-pressed={shape === 'table'} onClick={() => setShape('table')} className={SEGMENT}>
            표로 보기
          </button>
          <button type='button' aria-pressed={shape === 'ridge'} onClick={() => setShape('ridge')} className={SEGMENT}>
            그림으로 보기
          </button>
        </div>
      </div>
      <div className='max-w-[78ch] rounded-2xl border border-chart-3/50 bg-chart-3/10 px-4 py-3'>
        <p>
          <b>지난 기록이에요.</b> 지난달 가장 많이 몰린 칸을 다음 달 공고에 대 봐도, 하한선이 그 칸에 든 건 아무 칸을 대 본 것과 같았어요(아래
          &quot;몰린 칸을 따라 넣으면 맞을까?&quot;). 두 달 연속 같은 칸이어도 다음 달을 알려 주지 않아요.
        </p>
      </div>
      {shape === 'table' ? (
        <MonthsTable view={months} />
      ) : (
        <MonthsRidge months={months.ridgeMonths} points={data.points} quantiles={data.quantiles} place={data.region.place} />
      )}
      <ChanceCard view={chance} quantiles={data.quantiles} width={width} />
    </div>
  );
}
