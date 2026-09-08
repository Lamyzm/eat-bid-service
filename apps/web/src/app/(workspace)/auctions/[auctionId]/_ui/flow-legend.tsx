/** @module 책임: 흐름 차트 계열의 켜짐·꺼짐을 브라우저 안에서만 기억하는 store와 그 store를 누르는 범례 버튼을 소유한다. */
'use client';

import { useSyncExternalStore } from 'react';
import { Button } from '@/shared/ui/button';

import { FLOW_SERIES, type FlowSeriesKey } from '../_model/flow-series';

export type FlowSeriesVisibility = Readonly<Record<FlowSeriesKey, boolean>>;

// 시안(상세 1440 · 흐름 탭)의 시작 상태다. 2등은 낙찰 바로 위를 따라가는 보조 계열이라 근거 열 폭에서는 낙찰선을
// 가리므로 꺼진 채 시작하고, 나머지는 켜져 있어야 회차 점·내 값·명단이 첫 화면에서 읽힌다.
const INITIAL: FlowSeriesVisibility = { win: true, runnerUp: false, myRate: true, otherItems: true, listCount: true };

/*
 * 범례는 탭 스트립 줄에, 차트는 본문에 있어 같은 부모가 없다. 서버 컴포넌트인 근거 카드에 provider를 끼우지
 * 않고도 둘이 같은 상태를 보도록 모듈 하나가 store를 든다. 토글은 보는 방식일 뿐 판단 재료가 아니라 URL에
 * 싣지 않으며, 서버 렌더와 첫 hydration은 시작 상태다.
 */
let visibility: FlowSeriesVisibility = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleFlowSeries(key: FlowSeriesKey): void {
  visibility = { ...visibility, [key]: !visibility[key] };
  for (const listener of listeners) listener();
}

/** 다른 화면·테스트가 이전 토글을 물려받지 않게 시작 상태로 되돌린다. */
export function resetFlowSeries(): void {
  if (visibility === INITIAL) return;
  visibility = INITIAL;
  for (const listener of listeners) listener();
}

export function useFlowSeriesVisibility(): FlowSeriesVisibility {
  return useSyncExternalStore(subscribe, () => visibility, () => INITIAL);
}

// 표식과 색은 차트의 각 계열이 쓰는 것과 같아야 범례가 이름표로 성립한다. 색만으로 구분하지 않도록 표식도 다르다.
const MARK: Record<FlowSeriesKey, { readonly glyph: string; readonly tone: string }> = {
  win: { glyph: '━', tone: 'text-foreground' },
  runnerUp: { glyph: '┅', tone: 'text-muted-foreground' },
  myRate: { glyph: '━', tone: 'text-primary' },
  otherItems: { glyph: '○', tone: 'text-foreground' },
  listCount: { glyph: '▮', tone: 'text-muted-foreground' }
};

export function FlowLegend() {
  const visible = useFlowSeriesVisibility();
  return (
    <span className='ml-auto inline-flex items-center gap-1 text-[13px] font-semibold'>
      {FLOW_SERIES.map((series, index) => {
        const on = visible[series.key];
        return (
          <span key={series.key} className='inline-flex items-center gap-1'>
            {index > 0 ? <span className='text-muted-foreground/50'>·</span> : null}
            <Button
              variant='ghost'
              size='default'
              aria-pressed={on}
              onClick={() => toggleFlowSeries(series.key)}
              className={`inline-flex h-7 items-center gap-1 rounded-md px-1.5 whitespace-nowrap ${
                on ? MARK[series.key].tone : 'text-muted-foreground/60 line-through'
              }`}
            >
              <span aria-hidden='true'>{MARK[series.key].glyph}</span>
              {series.name}
            </Button>
          </span>
        );
      })}
    </span>
  );
}
