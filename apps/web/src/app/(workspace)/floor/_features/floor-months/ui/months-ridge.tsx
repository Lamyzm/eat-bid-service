/** @module 책임: 달마다 하한선이 떨어진 산 모양을 쌓아 그리고, 같은 자리에 추첨 분포 모양을 점선으로 겹친다. */
'use client';
import type { MonthBand } from '@/app/(workspace)/floor/_lib/floor-stats';
import { basePercentOf, monthLabel } from '@/app/(workspace)/floor/_lib/floor-units';
import type { FloorPoint } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { useFigureWidth } from '@/app/(workspace)/floor/_features/floor-board/model/use-figure-width';

const X_LOW = 88.4;
const X_HIGH = 91.4;
const GRID: readonly number[] = Array.from({ length: Math.round((X_HIGH - X_LOW) / 0.02) + 1 }, (_, index) => X_LOW + index * 0.02);
/** 산 모양을 고르게 펴는 폭(기초금액 대비 %p)이다. 0.1 칸 하나보다 넓어야 칸 경계의 들쭉날쭉이 모양으로 읽히지 않는다. */
const BANDWIDTH = 0.12;
const STEP = 34;
const AMPLITUDE = 70;

function density(values: readonly number[]): number[] {
  const scale = 1 / (values.length * BANDWIDTH * Math.sqrt(2 * Math.PI));
  return GRID.map((at) => {
    let sum = 0;
    for (const value of values) {
      const z = (at - value) / BANDWIDTH;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum * scale;
  });
}

export function MonthsRidge({
  months,
  points,
  quantiles,
  place
}: {
  readonly months: readonly MonthBand[];
  readonly points: readonly FloorPoint[];
  readonly quantiles: readonly number[];
  readonly place: string;
}) {
  const [box, figureWidth] = useFigureWidth<HTMLDivElement>();
  if (months.length === 0) {
    return (
      <div ref={box}>
        <p className='text-muted-foreground'>이 기간에는 공고가 20건 넘은 달이 없어요.</p>
      </div>
    );
  }
  const left = figureWidth < 600 ? 64 : 96;
  const x = (value: number) => left + ((value - X_LOW) / (X_HIGH - X_LOW)) * (figureWidth - left - 12);
  const rule = density(quantiles);
  const peak = Math.max(...rule) * 1.6;
  const height = months.length * STEP + AMPLITUDE + 46;
  const path = (values: readonly number[], base: number) =>
    GRID.map((at, index) => `${index === 0 ? 'M' : 'L'} ${x(at).toFixed(1)} ${(base - (values[index]! / peak) * AMPLITUDE).toFixed(1)}`).join(' ');
  const baseY = AMPLITUDE + 10 + (months.length - 1) * STEP + 6;
  const ticks: number[] = [];
  for (let rate = 98.5; rate <= 101.01; rate += figureWidth < 600 ? 1 : 0.5) ticks.push(rate);
  return (
    <div ref={box} className='grid gap-2'>
      <svg viewBox={`0 0 ${figureWidth} ${height}`} role='img' aria-label={`${place} 달별 하한선 산 모양과 추첨 분포 모양`} className='block w-full'>
        {months.map((band, index) => {
          const base = AMPLITUDE + 10 + index * STEP;
          const curve = density(points.filter((point) => point.month === band.month).map((point) => point.floor));
          return (
            <g key={band.month}>
              <path
                d={`${path(curve, base)} L ${x(X_HIGH)} ${base} L ${x(X_LOW)} ${base} Z`}
                style={{ fill: 'var(--chart-3)', fillOpacity: 0.22, stroke: 'var(--chart-3)', strokeWidth: 1.5 }}
              />
              <path d={path(rule, base)} style={{ fill: 'none', stroke: 'var(--muted-foreground)', strokeWidth: 1.2, strokeDasharray: '4 3' }} />
              <text x={left - 10} y={base - 2} textAnchor='end' className='fill-foreground text-[12px] font-semibold'>
                {monthLabel(band.month)}
              </text>
              <text x={left - 10} y={base + 12} textAnchor='end' className='fill-muted-foreground text-[11px]'>
                {band.count}건
              </text>
            </g>
          );
        })}
        {ticks.map((rate) => (
          <g key={rate}>
            <text x={x(basePercentOf(rate))} y={baseY + 18} textAnchor='middle' className='fill-foreground text-[12px] font-semibold'>
              사정률 {rate.toFixed(1)}
            </text>
            <text x={x(basePercentOf(rate))} y={baseY + 33} textAnchor='middle' className='fill-muted-foreground text-[11px]'>
              {basePercentOf(rate).toFixed(2)}%
            </text>
          </g>
        ))}
      </svg>
      <p className='text-muted-foreground'>색칠한 산이 그 달 실제, 점선이 추첨 분포로 계산한 모양이에요.</p>
    </div>
  );
}
