/** @module 책임: 시간축 표시 모델을 캔버스 한 장에 그리고 축 눈금과 요약 문장을 함께 낸다. */
'use client';
import { useEffect, useRef, useState } from 'react';
import type { TimeSeriesPlot, TimeSeriesPoint } from '../model/present-time-series';
import { nearestTargetPoint } from '../model/time-series-hit';
import { drawTimeSeries, PAD } from '../lib/draw-time-series';
import { floorInside, floorSentence, outsideSentences } from '../model/time-series-annotations';

/**
 * 캔버스는 그리기 방식일 뿐 내용이 아니다. 내용은 `figcaption`의 문장과 축 라벨이 말하며, 캔버스에는
 * 같은 사실을 `role='img'` 이름으로 한 번 더 둔다.
 *
 * 기관 낙찰점을 누르면 그 회차의 명단이 사이드바에 열린다(EAT-219). 캔버스의 점은 초점을 받을 수 없으므로
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const [full, setFull] = useState(false);
  /**
   * 집어 둔 기관이다. 여섯을 한꺼번에 진하게 그리면 어느 고리가 어느 기관인지 그림에서 읽히지 않는다.
   * 하나를 집으면 그것만 진해지고 나머지는 자리만 남긴다.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const view = full ? plot.fullDomain : plot.domain;
  const yTicks = full ? plot.fullYTicks : plot.yTicks;
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const render = () => drawTimeSeries(element, plot, full, pinned, selectedAttemptId);
    render();
    const size = new ResizeObserver(render);
    size.observe(element);
    /*
     * 캔버스는 CSS 변수를 못 읽어 그린 **순간의** 색을 들고 있다. 명암 모드나 색 테마를 바꿔도 다시
     * 그리지 않으면 어두운 배경 위에 밝은 모드의 점이 그대로 남는다 — 화면의 나머지는 바뀌고 차트만
     * 안 바뀐다. 테마는 root 요소의 class와 `data-theme`이 나르므로 그 둘을 본다.
     */
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });
    return () => {
      size.disconnect();
      theme.disconnect();
    };
  }, [plot, full, pinned, selectedAttemptId]);
  /** 누른 자리의 기관 낙찰점이다. 그리기와 같은 여백·축으로 좌표를 되짚는다. */
  const pointAt = (event: {
    readonly clientX: number;
    readonly clientY: number;
    readonly currentTarget: HTMLCanvasElement;
  }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const box = { width: rect.width, height: rect.height, pad: PAD };
    return nearestTargetPoint(
      plot.target,
      view,
      box,
      event.clientX - rect.left,
      event.clientY - rect.top
    );
  };
  const density = plot.comparison.kind === 'density';
  const summary =
    `${organizationLabel} ${plot.targetCount}건, ${comparisonLabel} ${plot.comparisonCount}건` +
    `(그중 ${plot.overlapCount}건은 이 기관의 기록)`;
  return (
    <figure
      className='analysis-chart-figure px-[var(--analysis-padding)] pb-2'
      aria-label='기관 낙찰점과 비교군 관측의 시간축'
    >
      <div className='analysis-chart-box'>
        <canvas
          ref={canvas}
          role='img'
          aria-label={summary}
          className='h-full w-full data-[hit=true]:cursor-pointer'
          onPointerMove={(event) => {
            if (onSelectPoint !== undefined)
              event.currentTarget.dataset.hit = String(pointAt(event) !== null);
          }}
          onClick={(event) => {
            const point = pointAt(event);
            if (point !== null) onSelectPoint?.(point);
          }}
        />
        {yTicks.map((tick) => (
          <span
            key={tick.y}
            aria-hidden
            className='pointer-events-none absolute left-0 w-12 -translate-y-1/2 text-right text-[11px] tabular-nums whitespace-nowrap text-muted-foreground'
            style={{
              top: `calc(${PAD.top}px + (100% - ${PAD.top + PAD.bottom}px) * ${1 - tickRatio(tick.y, view.yFrom, view.yTo)})`
            }}
          >
            {tick.label}
          </span>
        ))}
        {floorInside(plot, view) ? (
          <span
            aria-hidden
            className='pointer-events-none absolute right-3 -translate-y-full pb-0.5 text-[11px] font-medium tabular-nums text-destructive'
            style={{
              top: `calc(${PAD.top}px + (100% - ${PAD.top + PAD.bottom}px) * ${1 - tickRatio(plot.floor!.y, view.yFrom, view.yTo)})`
            }}
          >
            {plot.floor!.label}
          </span>
        ) : null}
        {plot.xTicks.map((tick, index) => {
          const edge = index === 0 || index === plot.xTicks.length - 1;
          return (
            <span
              key={tick.x}
              aria-hidden
              // 좁은 폭에서는 양끝만 남긴다. 다섯 개를 다 두면 `YYYY-MM-DD` 라벨이 서로 겹쳐 어느 날짜도
              // 읽히지 않는다(390px 실측). 기간 자체는 조건 막대의 시작일·종료일이 이미 말한다.
              className={`pointer-events-none absolute bottom-0 text-[11px] tabular-nums whitespace-nowrap text-muted-foreground${edge ? '' : ' hidden sm:inline'}`}
              style={{
                left: `calc(${PAD.left}px + (100% - ${PAD.left + PAD.right}px) * ${tickRatio(tick.x, view.xFrom, view.xTo)})`,
                transform:
                  index === 0
                    ? 'none'
                    : index === plot.xTicks.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)'
              }}
            >
              {tick.label}
            </span>
          );
        })}
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
            className={`inline-block size-2.5 ${density ? 'rounded-[2px] bg-muted-foreground/45' : 'rounded-full border border-muted-foreground/60'}`}
          />
          {comparisonLabel} {plot.comparisonCount}건{density ? ' · 진할수록 관측이 많아요' : ''}
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

function tickRatio(value: number, from: number, to: number): number {
  return to === from ? 0.5 : (value - from) / (to - from);
}
