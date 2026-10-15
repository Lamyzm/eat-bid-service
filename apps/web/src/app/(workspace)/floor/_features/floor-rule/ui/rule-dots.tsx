/** @module 책임: 하한선이 떨어지는 자리를 점 20개로 쌓아 그리고, 넣을 값과 이번 달 실제 하한선을 같은 눈금에 겹친다. */
'use client';
import { twentyDots } from '@/app/(workspace)/floor/_lib/floor-rule';
import { basePercentOf, manText, organizationLabel, rateText } from '@/entities/floor-line/floor-units';
import type { FloorData, FloorPoint } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { useFigureWidth } from '@/app/(workspace)/floor/_features/floor-board/model/use-figure-width';

const X_LOW = 88.4;
const X_HIGH = 91.4;
const BIN = 0.2;
/** 이번 달 하한선에 이름을 붙이는 최근 공고 수다. 더 붙이면 이름끼리 겹쳐 하나도 안 읽힌다. */
const LABELED = 3;

export function RuleDots({
  data,
  current,
  value
}: {
  readonly data: FloorData;
  readonly current: readonly FloorPoint[];
  /** 넣을 값(기초금액 대비 %)이다. 아직 못 읽었으면 null이다. */
  readonly value: number | null;
}) {
  const [box, figureWidth] = useFigureWidth<HTMLDivElement>();
  const narrow = figureWidth < 600;
  const radius = narrow ? 9 : 14;
  const top = 64 + (Math.min(current.length, LABELED) - 1) * 16;
  const x = (at: number) => 16 + ((Math.min(X_HIGH, Math.max(X_LOW, at)) - X_LOW) / (X_HIGH - X_LOW)) * (figureWidth - 32);
  const dots = twentyDots(data.quantiles);
  const stacks = new Map<number, number[]>();
  for (const dot of dots) {
    const bin = Math.floor((dot - X_LOW) / BIN);
    stacks.set(bin, [...(stacks.get(bin) ?? []), dot]);
  }
  const tallest = Math.max(...[...stacks.values()].map((stack) => stack.length));
  const baseY = top + tallest * radius * 2 + 8;
  const height = baseY + 64;
  const ticks: number[] = [];
  for (let rate = 98.5; rate <= 101.01; rate += narrow ? 1 : 0.5) ticks.push(rate);
  const labeled = current.slice(-LABELED).toReversed();
  const middle = `${rateText(dots[5]!, 1)}~${rateText(dots[14]!, 1)}`;
  return (
    <div ref={box}>
      <svg
        viewBox={`0 0 ${figureWidth} ${height}`}
        role='img'
        aria-label={`20번 개찰하면 하한선은 사정률 ${middle}에 10번 떨어져요`}
        className='block w-full'
      >
        {[...stacks.entries()].map(([bin, stack]) =>
          stack.map((dot, index) => (
            <circle
              key={`${bin}-${index}`}
              cx={x(X_LOW + (bin + 0.5) * BIN)}
              cy={baseY - radius - index * radius * 2}
              r={radius - 1.5}
              style={{ fill: value !== null && dot > value ? 'color-mix(in oklab, var(--muted-foreground) 35%, transparent)' : 'var(--primary)' }}
            />
          ))
        )}
        <line x1={16} x2={figureWidth - 16} y1={baseY} y2={baseY} className='stroke-border' />
        {ticks.map((rate) => (
          <g key={rate}>
            <text x={x(basePercentOf(rate))} y={baseY + 20} textAnchor='middle' className='fill-foreground text-[12px] font-semibold'>
              사정률 {rate.toFixed(1)}
            </text>
            <text x={x(basePercentOf(rate))} y={baseY + 36} textAnchor='middle' className='fill-muted-foreground text-[11px]'>
              {basePercentOf(rate).toFixed(2)}%
            </text>
            <text x={x(basePercentOf(rate))} y={baseY + 52} textAnchor='middle' className='fill-muted-foreground text-[11px]'>
              1억이면 {manText((100_000_000 * basePercentOf(rate)) / 100)}
            </text>
          </g>
        ))}
        {current.map((point) => (
          <line key={point.attemptId} x1={x(point.floor)} x2={x(point.floor)} y1={22} y2={baseY} style={{ stroke: 'var(--chart-3)', strokeWidth: 2.5 }} />
        ))}
        {labeled.map((point, index) => {
          const right = x(point.floor) < figureWidth * 0.6;
          return (
            <text
              key={point.attemptId}
              x={x(point.floor) + (right ? 6 : -6)}
              y={16 + index * 16}
              textAnchor={right ? 'start' : 'end'}
              className='fill-foreground text-[12px] font-bold'
            >
              {point.date.slice(5)} {organizationLabel(data.organizations, point.organization)} 사정률 {rateText(point.floor, 3)}
            </text>
          );
        })}
        {value === null || value < X_LOW || value > X_HIGH ? null : (
          <g>
            <line x1={x(value)} x2={x(value)} y1={top - 24} y2={baseY + 4} className='stroke-foreground' style={{ strokeWidth: 2.5, strokeDasharray: '6 4' }} />
            <text
              x={x(value) + (x(value) < figureWidth * 0.6 ? 6 : -6)}
              y={top - 26}
              textAnchor={x(value) < figureWidth * 0.6 ? 'start' : 'end'}
              className='fill-foreground text-[12px] font-bold'
            >
              넣는 값 사정률 {rateText(value, 3)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
