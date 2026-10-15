/** @module 책임: 실제 한 달과 추첨만 돌려 만든 한 달을 나란히 그리고, 몰린 칸을 다음 공고에 대 본 적중을 섞은 값과 함께 말한다. */
'use client';
import { useMemo, useState } from 'react';

import { drawFloors, seededRandom } from '@/app/(workspace)/floor/_lib/floor-rule';
import { hottestBand } from '@/app/(workspace)/floor/_lib/floor-stats';
import { basePercentOf, rateText } from '@/entities/floor-line/floor-units';
import { useFigureWidth } from '@/app/(workspace)/floor/_features/floor-board/model/use-figure-width';
import type { ChanceView } from '../model/present-chance';

const X_LOW = 88.4;
const X_HIGH = 91.4;

function MonthStrip({
  label,
  values,
  width,
  figureWidth,
  top,
  rowHeight,
  color,
  seed
}: {
  readonly label: string;
  readonly values: readonly number[];
  readonly width: number;
  readonly figureWidth: number;
  readonly top: number;
  readonly rowHeight: number;
  readonly color: string;
  readonly seed: number;
}) {
  const narrow = figureWidth < 600;
  const x = (value: number) => 12 + ((Math.min(X_HIGH, Math.max(X_LOW, value)) - X_LOW) / (X_HIGH - X_LOW)) * (figureWidth - 24);
  const band = hottestBand(values, width);
  const jitter = seededRandom(seed);
  const dotsTop = narrow ? 26 : 12;
  const hot = `가장 많이 몰린 사정률 ${rateText(band.lo, 2)}~${rateText(band.lo + width, 2)} · ${band.inside}건(${Math.round((100 * band.inside) / values.length)}%)`;
  return (
    <g>
      <rect x={x(band.lo)} y={top + 6} width={x(band.lo + width) - x(band.lo)} height={rowHeight - 30} rx={3} style={{ fill: color, opacity: 0.2 }} />
      <text x={12} y={top} className='fill-foreground text-[14px] font-bold'>
        {label} · {values.length}건
      </text>
      <text
        x={narrow ? 12 : figureWidth - 12}
        y={narrow ? top + 16 : top}
        textAnchor={narrow ? 'start' : 'end'}
        className='fill-foreground text-[12px] font-semibold'
      >
        {hot}
      </text>
      {values.map((value, index) => (
        <circle
          key={index}
          cx={x(value)}
          cy={top + dotsTop + jitter() * (rowHeight - 30 - dotsTop)}
          r={narrow ? 3 : 4}
          style={{ fill: color, opacity: 0.85 }}
        />
      ))}
    </g>
  );
}

export function ChanceCard({ view, quantiles, width }: { readonly view: ChanceView; readonly quantiles: readonly number[]; readonly width: number }) {
  const [seed, setSeed] = useState(1);
  const [box, figureWidth] = useFigureWidth<HTMLDivElement>();
  const fake = useMemo(
    () => (view.sample === null ? [] : drawFloors(quantiles, view.sample.values.length, seededRandom(seed * 7919))),
    [quantiles, view.sample, seed]
  );
  const narrow = figureWidth < 600;
  const rowHeight = narrow ? 120 : 96;
  const baseY = rowHeight * 2 + 10;
  const ticks: number[] = [];
  for (let rate = 98.5; rate <= 101.01; rate += narrow ? 1 : 0.5) ticks.push(rate);
  const x = (value: number) => 12 + ((Math.min(X_HIGH, Math.max(X_LOW, value)) - X_LOW) / (X_HIGH - X_LOW)) * (figureWidth - 24);
  return (
    <section aria-labelledby='floor-chance-title' className='grid gap-3 rounded-2xl border border-border px-4 py-4'>
      <h2 id='floor-chance-title' className='text-[19px] font-bold tracking-[-0.02em]'>
        몰린 칸을 따라 넣으면 맞을까?
      </h2>
      <p className='text-muted-foreground'>{view.lede}</p>
      <div ref={box}>
        {view.sample === null ? null : (
          <svg
            viewBox={`0 0 ${figureWidth} ${rowHeight * 2 + 52}`}
            role='img'
            aria-label={`실제 ${view.sample.name} 공고 ${view.sample.values.length}건과 추첨만 돌려 만든 한 달의 하한선`}
            className='block w-full'
          >
            <MonthStrip
              label={`실제 ${view.sample.name}`}
              values={view.sample.values}
              width={width}
              figureWidth={figureWidth}
              top={18}
              rowHeight={rowHeight}
              color='var(--chart-3)'
              seed={3}
            />
            <MonthStrip
              label='추첨만 돌려 만든 한 달(예상 아님)'
              values={fake}
              width={width}
              figureWidth={figureWidth}
              top={rowHeight + 18}
              rowHeight={rowHeight}
              color='var(--muted-foreground)'
              seed={4}
            />
            <line x1={12} x2={figureWidth - 12} y1={baseY} y2={baseY} className='stroke-border' />
            {ticks.map((rate) => (
              <g key={rate}>
                <line x1={x(basePercentOf(rate))} x2={x(basePercentOf(rate))} y1={baseY} y2={baseY + 5} className='stroke-muted-foreground' />
                <text x={x(basePercentOf(rate))} y={baseY + 18} textAnchor='middle' className='fill-foreground text-[12px] font-semibold'>
                  사정률 {rate.toFixed(1)}
                </text>
                <text x={x(basePercentOf(rate))} y={baseY + 33} textAnchor='middle' className='fill-muted-foreground text-[11px]'>
                  {basePercentOf(rate).toFixed(2)}%
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {view.sample === null ? null : (
        <>
          <div className='flex flex-wrap gap-x-[18px] gap-y-1.5 text-[14px] text-muted-foreground'>
            <span className='inline-flex items-center gap-1.5'>
              <i aria-hidden className='inline-block size-3 rounded-full bg-chart-3' />
              실제 공고
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <i aria-hidden className='inline-block size-3 rounded-full bg-muted-foreground' />
              추첨만 돌려 만든 공고(예상 아님)
            </span>
          </div>
          <div>
            <button
              type='button'
              onClick={() => setSeed((current) => current + 1)}
              className='min-h-11 rounded-xl border border-border px-4 text-[14px] font-semibold'
            >
              다시 굴려 보기
            </button>
          </div>
        </>
      )}
      {/* 따라가기 결론을 "드문 달" 문장보다 앞에 둔다. 드문 달이라는 말만 먼저 읽히면 "이 달은 진짜 몰렸다"가 다음 달 예상으로 읽힌다(2026-10-15 리뷰). */}
      <div className='grid gap-2 rounded-2xl bg-muted px-4 py-3.5'>
        {view.lines.length > 0 ? (
          view.lines.map((line) => (
            <p key={line.text} className={line.big ? 'text-[17px] font-bold tracking-[-0.02em] text-balance' : undefined}>
              {line.text}
              {line.strong === null ? null : <em className='text-primary not-italic'>{line.strong}</em>}
              {line.rest}
            </p>
          ))
        ) : (
          <p>이 지역은 공고가 적어 따져 볼 수 없어요.</p>
        )}
        {view.rarity === null ? null : <p>{view.rarity}</p>}
      </div>
    </section>
  );
}
