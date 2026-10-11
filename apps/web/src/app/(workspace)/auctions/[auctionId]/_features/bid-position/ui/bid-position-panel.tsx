/**
 * @module 책임: 운영자에게 공고 회차의 추천 투찰가를 아침 갱신·내 시장 맞춤·전국 공식 금액으로 나눠, 각각의 근거와 함께 보이는
 * 패널을 렌더링한다.
 */
import type { ReactNode } from 'react';

import type { BidPositionView } from '../model/present-bid-position';
import type { MarketPickRecord } from '@/entities/market-pick-record/market-pick-record';
import { BidFigureLine } from '@/entities/bid-figure/bid-figure-line';
import { RecordBarList } from '@/entities/market-pick-record/record-bar-list';
import type { MarketPickRow, MarketPickView } from '../model/present-market-pick';
import type { MorningHabitView } from '../model/present-morning-habit';

const LEAD_ROW = 'rounded-md border border-primary/40 bg-primary/10 px-3 py-2';
const PLAIN_ROW = 'rounded-md border border-border px-3 py-2';

function PanelFrame({ children }: { readonly children: ReactNode }) {
  return (
    <section
      aria-labelledby='bid-position-title'
      className='mt-6 rounded-lg border border-border bg-card p-4 md:p-5'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h2 id='bid-position-title' className='text-base font-semibold'>
          추천 투찰가
        </h2>
        <span className='rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
          운영자 전용
        </span>
      </div>
      {children}
    </section>
  );
}

function AmountRow({ row }: { readonly row: MarketPickRow }) {
  return (
    <>
      <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <span className='text-sm text-muted-foreground'>{row.label}</span>
        <BidFigureLine label={row.label} figure={row.figure} showLabel={false} />
      </div>
      {row.note === null ? null : <p className='mt-0.5 text-xs text-muted-foreground'>{row.note}</p>}
    </>
  );
}

/**
 * 아침 갱신 금액. 오늘 먼저 개찰된 공고의 단골 자리로 다시 고른 값이라 결과가 더 나오면 바뀐다 — 반영 상태와 검증 전제를 금액
 * 바로 위아래에 둔다. 꺼진 공고는 한 줄 이유만 둔다(PDR-0008: 켜지면 이 칸이 근거가 가장 강한 방법이다).
 */
function MorningHabitSection({ view }: { readonly view: MorningHabitView }) {
  return (
    <section aria-labelledby='morning-habit-title' className='mt-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 id='morning-habit-title' className='text-sm font-semibold'>
          아침 갱신
        </h3>
        {view.kind === 'on' ? (
          <span className='rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'>켜짐</span>
        ) : null}
      </div>
      {view.kind === 'off' ? (
        <p className='mt-1 text-sm text-muted-foreground'>{view.status}</p>
      ) : (
        <>
          <p className='mt-1 text-xs leading-relaxed text-muted-foreground tabular-nums'>{view.status}</p>
          <ol className='mt-3 space-y-2'>
            {view.rows.map((row) => (
              <li key={row.label} className={LEAD_ROW}>
                <AmountRow row={row} />
              </li>
            ))}
          </ol>
          {view.single === null ? null : (
            <div className='mt-2 rounded-md border border-dashed border-border px-3 py-2'>
              <AmountRow row={view.single} />
            </div>
          )}
          <p role='note' className='mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed'>
            {view.premise}
          </p>
          <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>{view.evidence}</p>
        </>
      )}
    </section>
  );
}

/** 내 시장 맞춤 금액. 전국 공식과 근거의 모양이 달라 같은 목록에 섞지 않고 위에 따로 둔다. 아침 갱신이 켜지면 강조를 넘긴다. */
function MarketPickSection({ view, lead }: { readonly view: MarketPickView; readonly lead: boolean }) {
  return (
    <section aria-labelledby='market-pick-title' className='mt-4'>
      <h3 id='market-pick-title' className='text-sm font-semibold'>
        {view.title}
      </h3>
      {view.kind === 'not-applicable' ? (
        <p className='mt-2 text-sm'>{view.reason}</p>
      ) : (
        <>
          <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>{view.basis}</p>
          <ol className='mt-3 space-y-2'>
            {view.rows.map((row) => (
              <li key={row.label} className={lead ? LEAD_ROW : PLAIN_ROW}>
                <AmountRow row={row} />
              </li>
            ))}
          </ol>
          {view.single === null ? null : (
            <div className='mt-2 rounded-md border border-dashed border-border px-3 py-2'>
              <AmountRow row={view.single} />
            </div>
          )}
          {view.pairNote === null ? null : (
            <p className='mt-2 text-xs text-muted-foreground'>{view.pairNote}</p>
          )}
          <RecordBars record={view.record} />
        </>
      )}
    </section>
  );
}

/** 같은 공고에 네 방법을 대어 본 낙찰 수. 길이와 순서는 표시 모델이 정하고 여기서는 그리기만 한다. */
function RecordBars({ record }: { readonly record: MarketPickRecord }) {
  return (
    <figure className='mt-4'>
      <figcaption className='text-xs text-muted-foreground'>{record.title}</figcaption>
      <div className='mt-2'>
        <RecordBarList bars={record.bars} />
      </div>
      <p className='mt-2 text-xs text-muted-foreground'>{record.note}</p>
    </figure>
  );
}

function NationalHeading() {
  return (
    <h3 id='national-rule-title' className='text-sm font-semibold'>
      전국 공식
    </h3>
  );
}

/** 아침 갱신을 맨 위에, 그 아래 이번 달 맞춤을 둔다. 둘 사이는 선으로 나눈다. */
function HabitThenMarket({ view }: { readonly view: Exclude<BidPositionView, { kind: 'unavailable' }> }) {
  const habitOn = view.habit?.kind === 'on';
  return (
    <>
      {view.habit === null ? null : <MorningHabitSection view={view.habit} />}
      <div className={view.habit === null ? '' : 'mt-5 border-t border-border pt-1'}>
        <MarketPickSection view={view.market} lead={!habitOn} />
      </div>
    </>
  );
}

export function BidPositionPanel({ view }: { readonly view: BidPositionView }) {
  if (view.kind === 'unavailable')
    return (
      <PanelFrame>
        <p role='status' className='mt-2 text-sm text-muted-foreground'>
          추천 투찰가를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.
        </p>
      </PanelFrame>
    );
  if (view.kind === 'not-applicable')
    return (
      <PanelFrame>
        <HabitThenMarket view={view} />
        <section aria-labelledby='national-rule-title' className='mt-5 border-t border-border pt-4'>
          <NationalHeading />
          <p className='mt-2 text-xs text-muted-foreground'>{view.inputs}</p>
          <p className='mt-3 text-sm'>{view.reason}</p>
          <p className='mt-3 text-xs text-muted-foreground'>{view.rule}</p>
        </section>
      </PanelFrame>
    );
  return (
    <PanelFrame>
      <HabitThenMarket view={view} />
      <section aria-labelledby='national-rule-title' className='mt-5 border-t border-border pt-4'>
        <NationalHeading />
        <p className='mt-2 text-xs text-muted-foreground'>
          {view.inputs} · {view.band}
        </p>
        {view.basisNote === null ? null : (
          <p role='note' className='mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed'>
            {view.basisNote}
          </p>
        )}
        {view.weakNote === null ? null : (
          <p
            role='note'
            className='mt-2 rounded-md border border-border px-3 py-2 text-xs font-medium leading-relaxed'
          >
            {view.weakNote}
          </p>
        )}
        <ol className='mt-4 space-y-3'>
          {view.rows.map((row) => (
            <li key={row.label} className='rounded-md border border-border px-3 py-2'>
              <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
                <span className='text-sm text-muted-foreground'>{row.label}</span>
                <BidFigureLine label={row.label} figure={row.figure} showLabel={false} />
              </div>
              <p className='mt-1 text-xs leading-relaxed text-muted-foreground tabular-nums'>
                {row.evidence}
              </p>
            </li>
          ))}
        </ol>
        <p className='mt-3 text-xs leading-relaxed'>{view.calibration}</p>
        <p className='mt-2 text-xs text-muted-foreground'>{view.rule}</p>
      </section>
    </PanelFrame>
  );
}
