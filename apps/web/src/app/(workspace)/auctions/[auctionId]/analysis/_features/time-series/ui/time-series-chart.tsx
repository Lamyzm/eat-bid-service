/** @module 책임: 시간축 표시 모델을 캔버스 한 장에 그리고 축 눈금과 요약 문장을 함께 낸다. */
'use client';
import { useEffect, useRef, useState } from 'react';
import { CHART } from '@/shared/lib/chart-colors';
import type { TimeSeriesPlot } from '../model/present-time-series';

/** 축 라벨이 들어갈 여백이다. 캔버스 안쪽 좌표계와 바깥 눈금 라벨이 같은 값을 써야 눈금이 선과 맞는다. */
const PAD = { left: 56, right: 12, top: 10, bottom: 26 } as const;

function scale(value: number, from: number, to: number, size: number): number {
  return to === from ? size / 2 : ((value - from) / (to - from)) * size;
}

/**
 * 밀도 칸의 진하기다. 관측 수를 최대값으로 나눈 비율을 그대로 쓰면 1건짜리 칸이 거의 보이지 않아
 * "범위 밖 극단값을 숨기지 않는다"는 약속이 눈에서 깨진다. 제곱근으로 눌러 1건도 보이게 하고 최소
 * 진하기를 준다.
 */
function cellAlpha(count: number, maxCount: number): number {
  return 0.18 + 0.72 * Math.sqrt(count / maxCount);
}

function draw(canvas: HTMLCanvasElement, plot: TimeSeriesPlot, full: boolean): void {
  const view = full ? plot.fullDomain : plot.domain;
  const viewTicks = full ? plot.fullYTicks : plot.yTicks;
  const context = canvas.getContext('2d');
  if (context === null) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const plotWidth = Math.max(width - PAD.left - PAD.right, 1);
  const plotHeight = Math.max(height - PAD.top - PAD.bottom, 1);
  const { xFrom, xTo, yFrom, yTo } = view;
  const px = (x: number) => PAD.left + scale(x, xFrom, xTo, plotWidth);
  // 캔버스의 y는 아래로 자란다. 사정률은 위로 자라야 하므로 여기서 한 번만 뒤집는다.
  const py = (y: number) => PAD.top + plotHeight - scale(y, yFrom, yTo, plotHeight);

  context.strokeStyle = CHART.volume;
  context.lineWidth = 1;
  for (const tick of viewTicks) {
    const y = Math.round(py(tick.y)) + 0.5;
    context.beginPath();
    context.moveTo(PAD.left, y);
    context.lineTo(PAD.left + plotWidth, y);
    context.stroke();
  }

  if (plot.comparison.kind === 'density') {
    context.fillStyle = CHART.volume;
    for (const cell of plot.comparison.cells) {
      const left = px(cell.x0);
      const right = px(cell.x1);
      const top = py(cell.y1);
      const bottom = py(cell.y0);
      context.globalAlpha = cellAlpha(cell.count, plot.comparison.maxCount);
      // 폭이 1px 미만인 칸도 한 줄로는 보이게 한다. 0으로 그리면 관측이 있는 자리가 빈 자리가 된다.
      context.fillRect(left, top, Math.max(right - left, 1), Math.max(bottom - top, 1));
    }
    context.globalAlpha = 1;
  } else {
    context.strokeStyle = CHART.volume;
    context.lineWidth = 1.25;
    for (const point of plot.comparison.points) {
      context.beginPath();
      context.arc(px(point.x), py(point.y), 3.5, 0, Math.PI * 2);
      context.stroke();
    }
  }

  // 기관 점을 마지막에 그린다. 비교군 위에 서야 또렷하게 보인다.
  context.fillStyle = CHART.win;
  for (const point of plot.target) {
    context.beginPath();
    context.arc(px(point.x), py(point.y), 4.5, 0, Math.PI * 2);
    context.fill();
  }
}

/**
 * 캔버스는 그리기 방식일 뿐 내용이 아니다. 내용은 `figcaption`의 문장과 축 라벨이 말하며, 캔버스에는
 * 같은 사실을 `role='img'` 이름으로 한 번 더 둔다. 점을 눌러 그 회차로 건너가는 선택은 아직 받을 곳이
 * 없어 만들지 않는다 — 아무 데도 닿지 않는 조작을 만들면 눌러 본 사람이 고장으로 읽는다.
 */
export function TimeSeriesChart({
  plot,
  organizationLabel,
  comparisonLabel
}: {
  readonly plot: TimeSeriesPlot;
  readonly organizationLabel: string;
  readonly comparisonLabel: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [full, setFull] = useState(false);
  const view = full ? plot.fullDomain : plot.domain;
  const yTicks = full ? plot.fullYTicks : plot.yTicks;
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const render = () => draw(element, plot, full);
    render();
    const size = new ResizeObserver(render);
    size.observe(element);
    /*
     * 캔버스는 CSS 변수를 못 읽어 그린 **순간의** 색을 들고 있다. 명암 모드나 색 테마를 바꿔도 다시
     * 그리지 않으면 어두운 배경 위에 밝은 모드의 점이 그대로 남는다 — 화면의 나머지는 바뀌고 차트만
     * 안 바뀐다. 테마는 root 요소의 class와 `data-theme`이 나르므로 그 둘을 본다.
     */
    const theme = new MutationObserver(render);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => {
      size.disconnect();
      theme.disconnect();
    };
  }, [plot, full]);
  const density = plot.comparison.kind === 'density';
  const summary = `${organizationLabel} ${plot.targetCount}건, ${comparisonLabel} ${plot.comparisonCount}건`
    + `(그중 ${plot.overlapCount}건은 이 기관의 기록)`;
  return (
    <figure
      className='analysis-chart-figure px-[var(--analysis-padding)] pb-2'
      aria-label='기관 낙찰점과 비교군 관측의 시간축'
    >
      <div className='analysis-chart-box'>
        <canvas ref={canvas} role='img' aria-label={summary} className='h-full w-full' />
        {yTicks.map((tick) => (
          <span
            key={tick.y}
            aria-hidden
            className='pointer-events-none absolute left-0 w-12 -translate-y-1/2 text-right text-[11px] tabular-nums whitespace-nowrap text-muted-foreground'
            style={{ top: `calc(${PAD.top}px + (100% - ${PAD.top + PAD.bottom}px) * ${1 - tickRatio(tick.y, view.yFrom, view.yTo)})` }}
          >
            {tick.label}
          </span>
        ))}
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
              transform: index === 0 ? 'none' : index === plot.xTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)'
            }}
          >
            {tick.label}
          </span>
          );
        })}
      </div>
      <figcaption className='mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1.5'>
          <span aria-hidden className='inline-block size-2.5 rounded-full' style={{ background: 'var(--primary)' }} />
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
        <span>세로축 사정률(%)</span>
        {plot.truncation === null ? null : <span className='text-foreground'>{plot.truncation}</span>}
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
        {outsideSentences(plot, organizationLabel, comparisonLabel, full).map((sentence) => (
          <span key={sentence}>{sentence}</span>
        ))}
      </p>
    </figure>
  );
}

/**
 * 축 밖으로 나간 관측을 문장으로 말한다. 기본 축은 가운데 덩어리에 맞춰 잘리므로 "안 보이는 점이
 * 있다"는 사실을 화면이 직접 말하지 않으면 사용자는 그 점이 없는 줄 안다 — 그러면 우리가 관측을
 * 숨긴 것이 된다. 전체 값 보기에서는 남는 것이 없으므로 아무 문장도 만들지 않는다.
 */
function outsideSentences(
  plot: TimeSeriesPlot,
  organizationLabel: string,
  comparisonLabel: string,
  full: boolean
): readonly string[] {
  if (full) return [];
  const sentence = (title: string, target: number, comparison: number) => {
    const parts = [
      target === 0 ? null : `${organizationLabel} ${target}건`,
      comparison === 0 ? null : `${comparisonLabel} ${comparison}건`
    ].filter((part) => part !== null);
    return parts.length === 0 ? null : `${title} ${parts.join(' · ')}`;
  };
  return [
    sentence('위쪽 범위 밖', plot.outsideTarget.above, plot.outsideComparison.above),
    sentence('아래쪽 범위 밖', plot.outsideTarget.below, plot.outsideComparison.below)
  ].filter((line) => line !== null);
}

function tickRatio(value: number, from: number, to: number): number {
  return to === from ? 0.5 : (value - from) / (to - from);
}
