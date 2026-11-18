/**
 * @module 책임: 넣을 공고 본문(왼쪽 마감일 칩과 그날 목록, 오른쪽 이달 값 판)을 앱 폭에 맞춰 배치하고, 고른 마감일 하나를 소유한다.
 * 고른 날은 이 화면 안에서만 의미가 있어 주소에 싣지 않는다. 처음에는 가장 가까운 마감일(내일 또는 그다음)을 고른다.
 */
'use client';

import { useState } from 'react';

import type { WorkBoard as WorkBoardModel } from '../utils/work-board';
import { ClosingDayChips } from './closing-day-chips';
import { MonthValuesPanel } from './month-values-panel';
import { NoticeList } from './notice-list';

export function WorkBoard({ board }: { readonly board: WorkBoardModel }) {
  const [selected, setSelected] = useState(board.days[0]?.key ?? '');
  const day = board.days.find((entry) => entry.key === selected) ?? board.days[0];
  return (
    <div className='@container min-w-0'>
      <div className='flex flex-col gap-4 @3xl:flex-row @3xl:items-start @3xl:gap-6'>
        <div className='grid min-w-0 flex-1 content-start gap-4'>
          {board.truncated ? (
            <p role='status' className='rounded-control bg-muted px-4 py-3 text-body font-semibold'>
              늦게 마감하는 공고 일부를 읽지 못했어요.
            </p>
          ) : null}
          {day === undefined ? (
            <p className='rounded-panel bg-card px-6 py-5 text-body font-bold text-muted-foreground'>
              넣을 공고 0건
            </p>
          ) : (
            <>
              <ClosingDayChips days={board.days} selected={day.key} onSelect={setSelected} />
              <NoticeList day={day} />
            </>
          )}
        </div>
        <div className='order-first @3xl:order-none @3xl:w-60 @3xl:shrink-0 @5xl:w-70 @3xl:self-stretch'>
          <MonthValuesPanel monthLabel={board.monthLabel} values={board.month90} />
        </div>
      </div>
    </div>
  );
}
