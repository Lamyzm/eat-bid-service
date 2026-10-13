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

const LANES: readonly { readonly key: keyof ReviewRowView['lanes']; readonly name: string; readonly mark: string }[] = [
  { key: 'own', name: '낸 값', mark: 'size-3 rotate-45 scale-75 bg-foreground' },
  { key: 'market-pick', name: '맞춤', mark: 'size-3 rounded-full bg-primary' },
  { key: 'national-rule', name: '전국', mark: 'size-0 border-x-[7px] border-b-[12px] border-x-transparent border-b-muted-foreground' },
  { key: 'morning-habit', name: '아침', mark: 'size-3 rounded-[2px] bg-teal-600 dark:bg-teal-400' }
];

const tickPosition = (value: number) => ((value - AXIS.from) / (AXIS.to - AXIS.from)) * 100;

function Marks({ marks, shape }: { readonly marks: readonly ReviewMark[]; readonly shape: string }) {
  return (
    <>
      {marks.map((mark) => (
        <i
          key={mark.label}
          title={mark.label}
          className={`absolute top-0.5 -translate-x-1/2 ${shape} ${mark.first ? 'outline-2 outline-offset-1 outline-emerald-600 dark:outline-emerald-400' : ''}`}
          style={{ left: `${mark.position}%` }}
        />
      ))}
    </>
  );
}

function Ruler({ row }: { readonly row: ReviewRowView }) {
  const lanes = LANES.filter((lane) => lane.key === 'own' || row.lanes[lane.key].length > 0);
  return (
    <div className='grid gap-1.5'>
      <p className='text-[13px] text-muted-foreground tabular-nums'>{row.facts}</p>
      {/* 눈금자의 숫자는 아래 판정 문장이 말로 다시 말한다. 그림은 위치를 보이는 보조라 읽기 도구에는 문장을 준다. */}
      <div aria-hidden='true' className='grid grid-cols-[56px_minmax(0,1fr)] items-center gap-y-1'>
        <span className='text-[11.5px] font-bold text-muted-foreground'>하한·낙찰</span>
        <div className='relative h-5'>
          <i className='absolute inset-x-0 top-[9px] h-0.5 bg-border' />
          {row.band === null ? (
            <i className='absolute top-0 h-5 w-0.5 bg-destructive' style={{ left: `${row.floor}%` }} />
          ) : (
            <>
              <i
                className='absolute top-0.5 h-4 rounded-r-sm border-l-2 border-destructive bg-emerald-600/20 dark:bg-emerald-400/20'
                style={{ left: `${row.band.from}%`, width: `${Math.max(0.6, row.band.to - row.band.from)}%` }}
              />
              <i className='absolute top-0 h-5 w-0.5 bg-emerald-600 dark:bg-emerald-400' style={{ left: `${row.band.to}%` }} />
            </>
          )}
        </div>
        {lanes.map((lane) => (
          <div key={lane.key} className='contents'>
            <span className='text-[11.5px] font-bold text-muted-foreground'>{lane.name}</span>
            <div className='relative h-4'>
              <Marks marks={row.lanes[lane.key]} shape={lane.mark} />
            </div>
          </div>
        ))}
        <span />
        <div className='relative h-4 text-[10.5px] text-muted-foreground tabular-nums'>
          {AXIS_TICKS.map((tick) => (
            <span key={tick} className='absolute -translate-x-1/2' style={{ left: `${tickPosition(tick)}%` }}>{tick}</span>
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

export function ReviewRows({ rows }: { readonly rows: readonly ReviewRowView[] }) {
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
      <p className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground'>
        <span>◆ 낸 값</span><span className='text-primary'>● 맞춤</span><span>▲ 전국 공식</span><span className='text-teal-700 dark:text-teal-300'>■ 아침 갱신</span>
        <span>빨간 선 하한 · 초록 칸 1등 자리 · 초록 선 낙찰</span>
      </p>
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
