/** @module 책임: 복기 한 달의 공고마다 사정률 눈금자(하한·1등 자리·낙찰·낸 값·방법별 값)와 판정 문장을 그리고, 화면 안 거르기를 소유한다. */
'use client';
import Link from 'next/link';
import { useState } from 'react';

import { AXIS, AXIS_TICKS, type ReviewMark, type ReviewRowView } from '../model/present-review';

type Filter = 'all' | 'first' | 'own-below' | 'won';

const FILTERS: readonly { readonly key: Filter; readonly label: string; readonly keep: (row: ReviewRowView) => boolean }[] = [
  { key: 'all', label: '전체', keep: () => true },
  { key: 'first', label: '1등 자리가 있던 공고', keep: (row) => row.anyFirst },
  { key: 'own-below', label: '낸 값이 하한 미달', keep: (row) => row.ownBelowFloor },
  { key: 'won', label: '우리 낙찰', keep: (row) => row.won }
];

type LaneKey = keyof ReviewRowView['lanes'];

const OWN_MARK = 'size-3 rotate-45 scale-75 bg-foreground';

const METHOD_LANES: readonly { readonly key: Exclude<LaneKey, 'own'>; readonly name: string; readonly mark: string }[] = [
  { key: 'market-pick', name: '맞춤', mark: 'size-3 rounded-full bg-primary' },
  { key: 'national-rule', name: '전국', mark: 'size-0 border-x-[7px] border-b-[12px] border-x-transparent border-b-muted-foreground' },
  { key: 'morning-habit', name: '아침', mark: 'size-3 rounded-[2px] bg-teal-600 dark:bg-teal-400' }
];

const BAND = 'border-l-2 border-destructive bg-emerald-600/20 dark:bg-emerald-400/20';
const WINNER_LINE = 'w-0.5 bg-emerald-700 dark:bg-emerald-300';
// 낙찰선은 칸 왼쪽 끝(하한)과 같은 세로선이라 색만으로 갈리지 않는다. 위에 점을 달아 모양으로 가른다.
const WINNER_CAP = 'size-2 rounded-full bg-emerald-700 dark:bg-emerald-300';
const LANE_NAME = 'text-[12px] font-bold text-muted-foreground';

const tickPosition = (value: number) => ((value - AXIS.from) / (AXIS.to - AXIS.from)) * 100;

function Lane({ name, marks, shape }: { readonly name: string; readonly marks: readonly ReviewMark[]; readonly shape: string }) {
  return (
    <>
      <span className={LANE_NAME}>{name}</span>
      <div className='relative h-4'>
        {marks.map((mark, index) => (
          <i
            // 두 업체가 같은 사정률을 넣으면 문구가 같아 문구만으로는 표시 하나가 사라진다.
            key={`${index}-${mark.label}`}
            title={mark.label}
            className={`absolute top-0.5 -translate-x-1/2 ${shape} ${mark.first ? 'outline-2 outline-offset-1 outline-emerald-600 dark:outline-emerald-400' : ''}`}
            style={{ left: `${mark.position}%` }}
          />
        ))}
      </div>
    </>
  );
}

function Ruler({ row }: { readonly row: ReviewRowView }) {
  const methods = METHOD_LANES.filter((lane) => row.lanes[lane.key].length > 0);
  return (
    <div className='grid gap-1.5'>
      <p className='flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground tabular-nums'>
        {row.facts.map((fact, index) => (
          <span key={fact} className='whitespace-nowrap'>{index > 0 ? '· ' : ''}{fact}</span>
        ))}
      </p>
      {/* 눈금자의 숫자는 아래 판정 문장이 말로 다시 말한다. 그림은 위치를 보이는 보조라 읽기 도구에는 문장을 준다. */}
      <div aria-hidden='true' className='grid grid-cols-[56px_minmax(0,1fr)] items-center gap-y-1'>
        {/* 낸 값을 위에, 방법 값을 아래에 두어 둘 다 가운데의 하한·1등 자리 칸과 바로 견준다(시안 순서). */}
        <Lane name='낸 값' marks={row.lanes.own} shape={OWN_MARK} />
        <span className={LANE_NAME}>하한·낙찰</span>
        <div className='relative h-5'>
          <i className='absolute inset-x-0 top-[9px] h-0.5 bg-border' />
          <i
            className={`absolute top-0.5 h-4 rounded-r-sm ${BAND}`}
            style={{ left: `${row.band.from}%`, width: `${Math.max(0.6, row.band.to - row.band.from)}%` }}
          />
          {row.winner === null ? null : (
            <>
              <i className={`absolute top-0 h-5 ${WINNER_LINE}`} style={{ left: `${row.winner}%` }} />
              <i className={`absolute -top-1 -translate-x-[3px] ${WINNER_CAP}`} style={{ left: `${row.winner}%` }} />
            </>
          )}
        </div>
        {methods.map((lane) => (
          <Lane key={lane.key} name={lane.name} marks={row.lanes[lane.key]} shape={lane.mark} />
        ))}
        <span />
        <div className='relative h-4 text-[11px] text-muted-foreground tabular-nums'>
          {AXIS_TICKS.map((tick) => (
            <span
              key={tick}
              // 축 끝 숫자는 가운데 맞춤이면 화면 여백 밖으로 반이 나간다.
              className={`absolute ${tick === AXIS.to ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: `${tickPosition(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
      </div>
      <ul className='flex flex-wrap gap-1.5 text-[12.5px]' aria-label='판정'>
        {row.verdicts.map((verdict) => (
          <li
            key={verdict.name}
            className={`rounded-md px-2 py-0.5 ${verdict.first ? 'bg-emerald-600/15 text-foreground dark:bg-emerald-400/15' : 'bg-muted text-muted-foreground'}`}
          >
            <b className='font-bold text-foreground'>{verdict.name}</b> {verdict.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 범례는 색 이름 대신 모양과 자리로 말한다 — 적록 색약이면 빨간 선과 초록 선을 가르지 못한다. */
function Legend({ hasHabit }: { readonly hasHabit: boolean }) {
  return (
    <p aria-hidden='true' className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground'>
      <span>◆ 낸 값</span>
      <span className='text-primary'>● 맞춤</span>
      <span>▲ 전국 공식</span>
      {hasHabit ? <span className='text-teal-700 dark:text-teal-300'>■ 아침 갱신</span> : null}
      <span className='inline-flex items-center gap-1.5'>
        <i className={`inline-block h-2.5 w-4 ${BAND}`} />칸: 왼쪽 끝 선이 하한, 칸 안이 1등 자리
      </span>
      <span className='inline-flex items-center gap-1.5'>
        <span className='inline-flex flex-col items-center'>
          <i className={`inline-block ${WINNER_CAP}`} />
          <i className={`-mt-0.5 inline-block h-2.5 ${WINNER_LINE}`} />
        </span>
        점 달린 세로선: 낙찰
      </span>
      <span>테두리 두른 표시: 1등 자리에 든 값</span>
    </p>
  );
}

export function ReviewRows({ rows, hasHabit }: { readonly rows: readonly ReviewRowView[]; readonly hasHabit: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const keep = FILTERS.find((entry) => entry.key === filter)!.keep;
  const shown = rows.filter(keep);
  return (
    <section aria-labelledby='review-rows-title' className='mt-8'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 id='review-rows-title' className='text-[17px] font-extrabold tracking-[-0.02em]'>공고별</h2>
        <div role='group' aria-label='거르기' className='flex flex-wrap gap-1.5'>
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type='button'
              aria-pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
              className='rounded-lg border border-border px-2.5 py-1 text-[13px] font-bold text-muted-foreground aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-primary'
            >
              {entry.label} <span className='tabular-nums'>{rows.filter(entry.keep).length}</span>
            </button>
          ))}
        </div>
      </div>
      <Legend hasHabit={hasHabit} />
      {shown.length === 0 ? (
        <p className='py-6 text-[14px] text-muted-foreground'>이 조건에 맞는 공고가 없어요.</p>
      ) : (
        shown.map((row) => (
          <article key={row.id} className='grid gap-x-6 gap-y-2.5 border-t border-border py-4 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]'>
            <div className='min-w-0'>
              <Link href={row.href} className='text-[15px] font-bold tracking-[-0.02em] hover:underline'>{row.title}</Link>
              <p className='mt-1 flex flex-wrap gap-x-2.5 text-[13px] text-muted-foreground tabular-nums'>
                {row.meta.map((item) => <span key={item}>{item}</span>)}
              </p>
              {row.won ? <span className='mt-1.5 inline-block rounded-md bg-emerald-600 px-2 py-0.5 text-[12px] font-extrabold text-white'>우리 낙찰</span> : null}
            </div>
            <Ruler row={row} />
          </article>
        ))
      )}
    </section>
  );
}
