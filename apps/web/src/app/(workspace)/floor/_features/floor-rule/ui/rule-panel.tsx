/** @module 책임: "넣을 값 따져 보기"(점 20개 그림과 넣을 값의 하한 미달 확률)를 묶는다. */
'use client';
import { useId, useState } from 'react';

import type { FloorPeriod } from '@/entities/floor-line/floor-period';
import { assessmentRate, countText } from '@/entities/floor-line/floor-units';
import type { FloorData } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { presentTry, tryValueBasePercent, type TryUnit } from '../model/present-try';
import { RuleDots } from './rule-dots';

const SEGMENT = 'min-h-11 px-4 text-[14px] font-semibold text-muted-foreground aria-pressed:bg-foreground aria-pressed:text-background';

export function RulePanel({ data, period }: { readonly data: FloorData; readonly period: FloorPeriod }) {
  const id = useId();
  const [unit, setUnit] = useState<TryUnit>('rate');
  // 빈칸에서 시작한다. 미리 채운 값은 이 화면이 권하는 값으로 읽힌다(2026-10-15 리뷰, apps/web/AGENTS 기본값 금지).
  const [text, setText] = useState('');
  const value = tryValueBasePercent(text, unit);
  const current = data.points.filter((point) => point.month === period.currentMonth);
  const view = value === null ? null : presentTry({ basePercent: value, quantiles: data.quantiles, points: data.points, place: data.region.place, rounds: data.provenance.ruleSourceRounds });
  const switchUnit = (next: TryUnit) => {
    // 단위를 바꿔도 같은 값을 가리키게 칸의 숫자를 옮겨 적는다.
    if (value !== null) setText((next === 'rate' ? assessmentRate(value) : value).toFixed(3));
    setUnit(next);
  };
  return (
    <div className='grid gap-4'>
      <p className='max-w-[66ch] text-muted-foreground'>
        eaT는 공고마다 기초금액 ±3% 안에서 예비가격 15개를 만들고, 그중 4개의 평균으로 예정가격을 정해요. 하한선은 그 90%예요. 아래 점
        20개는 이 추첨이 하한선을 어디에 떨어뜨리는지 20번으로 줄여 보인 거예요. 전국 공고 {countText(data.provenance.ruleSourceRounds)}건으로
        확인한 모양이에요.
      </p>
      <RuleDots data={data} current={current} value={value} />
      <div className='flex flex-wrap gap-x-[18px] gap-y-1.5 text-[14px] text-muted-foreground'>
        <span className='inline-flex items-center gap-1.5'>
          <i aria-hidden className='inline-block size-3 rounded-full bg-primary' />
          하한선이 넣는 값보다 아래(유효)
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <i aria-hidden className='inline-block size-3 rounded-full bg-muted-foreground/35' />
          하한선이 넣는 값보다 위(하한 미달)
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <i aria-hidden className='inline-block h-3.5 w-1 rounded-sm bg-chart-3' />
          이번 달 개찰 끝난 공고의 하한선(공고마다 달라요)
        </span>
      </div>
      <section aria-labelledby={`${id}-title`} className='grid gap-3 rounded-2xl border border-border px-4 py-4'>
        <h2 id={`${id}-title`} className='text-[19px] font-bold tracking-[-0.02em]'>
          이 값으로 넣으면
        </h2>
        <div className='flex flex-wrap items-center gap-3'>
          <div role='group' aria-label='넣는 숫자' className='inline-flex overflow-hidden rounded-xl border border-border'>
            <button type='button' aria-pressed={unit === 'rate'} onClick={() => switchUnit('rate')} className={SEGMENT}>
              사정률
            </button>
            <button type='button' aria-pressed={unit === 'base'} onClick={() => switchUnit('base')} className={SEGMENT}>
              기초금액 대비 %
            </button>
          </div>
          <label htmlFor={`${id}-value`} className='sr-only'>
            넣을 값({unit === 'rate' ? '사정률' : '기초금액 대비 %'})
          </label>
          <input
            id={`${id}-value`}
            type='number'
            inputMode='decimal'
            step='0.001'
            placeholder={unit === 'rate' ? '예: 100.000' : '예: 90.000'}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className='min-h-11 w-40 rounded-xl border border-input bg-background px-3 text-[17px] font-semibold tabular-nums'
          />
        </div>
        <div aria-live='polite' className='grid gap-2 rounded-2xl bg-muted px-4 py-3.5'>
          {view === null ? (
            <p>{unit === 'rate' ? '따져 볼 사정률을 넣어 보세요. 그 값으로 넣으면 하한 미달이 몇 번 나는지 보여 드려요.' : '따져 볼 기초금액 대비 %를 넣어 보세요. 그 값으로 넣으면 하한 미달이 몇 번 나는지 보여 드려요.'}</p>
          ) : (
            <>
              <p className='text-[17px] font-bold tracking-[-0.02em] text-balance'>
                {view.lead}
                <em className='text-primary not-italic'>{view.strong}</em>
                이에요.
              </p>
              <p>{view.detail}</p>
              <p>하한 위라고 낙찰은 아니에요. 하한선과 이 값 사이에 다른 업체가 없어야 따요.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

