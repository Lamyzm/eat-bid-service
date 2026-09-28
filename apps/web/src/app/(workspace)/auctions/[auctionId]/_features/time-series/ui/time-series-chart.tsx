/** @module 책임: 시간축 표시 모델을 ECharts 그림으로 붙이고(확대·이동·기간 선택·마우스 올림) 범례와 요약 문장을 함께 낸다. */
'use client';
import { ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent
} from 'echarts/components';
import { init, use as registerEchartsModules, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef, useState } from 'react';
import type { TimeSeriesPlot, TimeSeriesPoint } from '../model/present-time-series';
import { CROWD_THRESHOLD, TARGET_SERIES_ID, timeSeriesOption } from '../lib/time-series-option';
import { floorSentence, outsideSentences } from '../model/time-series-annotations';

/** 손가락이 주 입력인 기기다. effect 안에서만 부르므로 서버 렌더에는 닿지 않는다. */
function coarse(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

// 쓰는 차트·컴포넌트만 등록한다. 전체 번들을 들이지 않는다(ADR 0058 결정 1).
registerEchartsModules([ScatterChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, ToolboxComponent, CanvasRenderer]);

/**
 * 그림은 그리기 방식일 뿐 내용이 아니다. 내용은 `figcaption`의 문장이 말하며, 그림 자리에는 같은 사실을
 * `role='img'` 이름으로 한 번 더 둔다.
 *
 * 기관 낙찰점을 누르면 그 회차의 명단이 사이드바에 열린다(EAT-219). 그림의 점은 초점을 받을 수 없으므로
 * 키보드로는 아래 전체 개찰 이력의 행으로 같은 명단을 연다(EAT-218).
 */
export function TimeSeriesChart({
  plot,
  organizationLabel,
  comparisonLabel,
  selectedAttemptId = null,
  onSelectPoint
}: {
  readonly plot: TimeSeriesPlot;
  readonly organizationLabel: string;
  readonly comparisonLabel: string;
  readonly selectedAttemptId?: string | null;
  readonly onSelectPoint?: (point: TimeSeriesPoint) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [full, setFull] = useState(false);
  /**
   * 집어 둔 기관이다. 여섯을 한꺼번에 진하게 그리면 어느 고리가 어느 기관인지 그림에서 읽히지 않는다.
   * 하나를 집으면 그것만 진해지고 나머지는 자리만 남긴다.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  // 클릭·테마 처리기는 그림을 만든 때가 아니라 그 순간의 입력을 봐야 한다.
  const latest = useRef({ plot, onSelectPoint, full, pinned, selectedAttemptId });
  useEffect(() => {
    latest.current = { plot, onSelectPoint, full, pinned, selectedAttemptId };
  }, [plot, onSelectPoint, full, pinned, selectedAttemptId]);
  const view = full ? plot.fullDomain : plot.domain;

  // 그림은 브라우저에서 한 번만 만들고 떼어낼 때 버린다(ADR 0058 결정 5).
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const instance = init(element, null, { renderer: 'canvas' });
    chart.current = instance;
    instance.on('click', (params) => {
      if (params.seriesId !== TARGET_SERIES_ID) return;
      const point = latest.current.plot.target[params.dataIndex];
      if (point !== undefined) latest.current.onSelectPoint?.(point);
    });
    const size = new ResizeObserver(() => instance.resize());
    size.observe(element);
    // 테마는 root 요소의 class와 `data-theme`이 나른다. 바뀌면 그 순간의 색으로 다시 그린다.
    // ECharts는 CSS 변수를 못 읽어 그린 순간의 색을 들고 있으므로, 테마가 바뀌면 그때의 색으로 다시 넣는다.
    const theme = new MutationObserver(() => {
      const { plot: current, full: wide, pinned: focus, selectedAttemptId: chosen } = latest.current;
      instance.setOption(timeSeriesOption({ plot: current, full: wide, pinned: focus, selectedAttemptId: chosen, coarsePointer: coarse() }), {
        replaceMerge: ['series']
      });
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => {
      size.disconnect();
      theme.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // 계열만 갈아 끼운다. 통째로 바꾸면 사용자가 휠로 확대해 둔 기간이 점 하나 누를 때마다 풀린다.
    chart.current?.setOption(timeSeriesOption({ plot, full, pinned, selectedAttemptId, coarsePointer: coarse() }), {
      replaceMerge: ['series']
    });
  }, [plot, full, pinned, selectedAttemptId]);

  const density = plot.comparison.kind === 'density';
  // 범례 표식은 그림과 같은 모양이어야 한다. 비교 점이 많으면 그림이 채운 점이라 범례도 채운 점이다.
  const filled = density || plot.comparison.points.length > CROWD_THRESHOLD;
  const summary =
    `${organizationLabel} ${plot.targetCount}건, ${comparisonLabel} ${plot.comparisonCount}건` +
    `(그중 ${plot.overlapCount}건은 이 기관의 기록)`;
  return (
    <figure
      className='analysis-chart-figure px-[var(--analysis-padding)] pb-2'
      aria-label='기관 낙찰점과 비교군 관측의 시간축'
    >
      <div className='analysis-chart-box'>
        <div ref={host} role='img' aria-label={summary} className='h-full w-full' />
      </div>
      <figcaption className='mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1.5'>
          <span
            aria-hidden
            className='inline-block size-2.5 rounded-full'
            style={{ background: 'var(--primary)' }}
          />
          {organizationLabel} {plot.targetCount}건
        </span>
        <span className='flex items-center gap-1.5'>
          <span
            aria-hidden
            className={`inline-block size-2.5 ${filled ? 'rounded-full bg-muted-foreground/45' : 'rounded-full border border-muted-foreground/60'}`}
          />
          {comparisonLabel} {plot.comparisonCount}건{density ? ' · 크고 진할수록 관측이 많아요' : ''}
        </span>
        <span>겹침 {plot.overlapCount}건</span>
        {plot.overlays.map((series) => (
          <button
            key={series.organizationId}
            type='button'
            aria-pressed={pinned === series.organizationId}
            onClick={() =>
              setPinned((current) =>
                current === series.organizationId ? null : series.organizationId
              )
            }
            className='flex items-center gap-1.5 rounded-md px-1 py-0.5 aria-pressed:bg-accent aria-pressed:text-accent-foreground'
          >
            {/*
              색을 JS 팔레트에서 읽지 않는다. 그 값은 테마를 아는 브라우저에서만 맞아 서버가 그린 것과
              달라지고, React가 hydration 불일치로 잡는다(2026-09-18 dev 콘솔). 토큰을 그대로 쓴다.
            */}
            <span
              aria-hidden
              className='inline-flex size-4 items-center justify-center rounded-full border border-[var(--chart-3)] text-[10px] text-[var(--chart-3)]'
            >
              {series.index}
            </span>
            {series.label} {series.points.length}건{series.truncated ? ' 일부' : ''}
          </button>
        ))}
        <span>세로축 사정률(%)</span>
        {plot.truncation === null ? null : (
          <span className='text-foreground'>{plot.truncation}</span>
        )}
      </figcaption>
      <p className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground'>
        <button
          type='button'
          aria-pressed={full}
          onClick={() => setFull((current) => !current)}
          className='rounded-md border border-border px-2 py-1 text-foreground'
        >
          {full ? '가운데 값만 보기' : '전체 값 보기'}
        </button>
        <button
          type='button'
          onClick={() => chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })}
          className='rounded-md border border-border px-2 py-1 text-foreground'
        >
          전체 기간
        </button>
        {floorSentence(plot, view) === null ? null : (
          <span className='text-destructive'>{floorSentence(plot, view)}</span>
        )}
        {outsideSentences(plot, organizationLabel, comparisonLabel, full).map((sentence) => (
          <span key={sentence}>{sentence}</span>
        ))}
      </p>
    </figure>
  );
}

