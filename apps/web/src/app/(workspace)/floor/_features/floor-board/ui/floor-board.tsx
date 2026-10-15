/** @module 책임: 세 보기(공고별·달별·넣을 값 따져 보기) 탭을 그리고, 탭이 함께 쓰는 칸 너비를 들고 고른 탭을 주소에 남긴다. */
'use client';
import { useQueryStates } from 'nuqs';
import { useRef, useState, type KeyboardEvent } from 'react';

import type { FloorPeriod } from '@/entities/floor-line/floor-period';
import { FLOOR_VIEWS, floorSearchParsers, type FloorViewKey } from '@/app/(workspace)/floor/_lib/floor-search';
import type { BandWidth } from '@/app/(workspace)/floor/_lib/floor-stats';
import { MonthsPanel } from '@/app/(workspace)/floor/_features/floor-months/ui/months-panel';
import { PointsPanel } from '@/app/(workspace)/floor/_features/floor-points/ui/points-panel';
import { RulePanel } from '@/app/(workspace)/floor/_features/floor-rule/ui/rule-panel';
import type { FloorData } from '../model/present-floor';

const TAB_LABEL: Record<FloorViewKey, string> = { points: '공고별', months: '달별', rule: '넣을 값 따져 보기' };

const TAB =
  'min-h-11 border-b-2 border-transparent px-3.5 text-[16px] font-bold text-muted-foreground aria-selected:border-foreground aria-selected:text-foreground';

/**
 * 공고별 그림은 탭을 옮겨도 떼어내지 않는다 — 다시 만들면 확대해 둔 기간이 풀린다. 달별·넣을 값 탭은 처음 열 때 만든다. 달별은
 * 순열 검정을 수천 번 세므로 열지 않은 사람에게 그 값을 치르게 하지 않는다.
 */
export function FloorBoard({ data, period, focusMonth }: { readonly data: FloorData; readonly period: FloorPeriod; readonly focusMonth: string | null }) {
  const [{ view }, setView] = useQueryStates({ view: floorSearchParsers.view }, { shallow: true, history: 'replace', scroll: false });
  const [width, setWidth] = useState<BandWidth>(0.2);
  const [opened, setOpened] = useState<ReadonlySet<FloorViewKey>>(() => new Set([view]));
  const tabs = useRef<Partial<Record<FloorViewKey, HTMLButtonElement | null>>>({});
  const select = (next: FloorViewKey) => {
    setOpened((current) => (current.has(next) ? current : new Set([...current, next])));
    void setView({ view: next });
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = FLOOR_VIEWS.indexOf(view);
    const next = FLOOR_VIEWS[(index + (event.key === 'ArrowRight' ? 1 : FLOOR_VIEWS.length - 1)) % FLOOR_VIEWS.length]!;
    select(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className='grid gap-5'>
      <div role='tablist' aria-label='보기' className='flex flex-wrap gap-1 border-b border-border'>
        {FLOOR_VIEWS.map((key) => (
          <button
            key={key}
            ref={(element) => {
              tabs.current[key] = element;
            }}
            type='button'
            role='tab'
            id={`floor-tab-${key}`}
            aria-controls={`floor-panel-${key}`}
            aria-selected={view === key}
            tabIndex={view === key ? 0 : -1}
            onClick={() => select(key)}
            onKeyDown={moveFocus}
            className={TAB}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>
      <section role='tabpanel' id='floor-panel-points' aria-labelledby='floor-tab-points' hidden={view !== 'points'}>
        <PointsPanel data={data} period={period} width={width} onWidth={setWidth} focusMonth={focusMonth} />
      </section>
      <section role='tabpanel' id='floor-panel-months' aria-labelledby='floor-tab-months' hidden={view !== 'months'}>
        {opened.has('months') ? <MonthsPanel data={data} period={period} width={width} focusMonth={focusMonth} /> : null}
      </section>
      <section role='tabpanel' id='floor-panel-rule' aria-labelledby='floor-tab-rule' hidden={view !== 'rule'}>
        {opened.has('rule') ? <RulePanel data={data} period={period} /> : null}
      </section>
    </div>
  );
}
