/**
 * @module 책임: 운영자에게 공고 회차의 추천 투찰가를 내 시장 맞춤 금액과 전국 공식 금액으로 나눠, 각각의 근거와 함께 보이는 패널을
 * 렌더링한다.
 */
import type { ReactNode } from 'react';

import type { BidPositionView } from '../model/present-bid-position';
import type { MarketPickRow, MarketPickView } from '../model/present-market-pick';

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
    <div className='flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
      <span className='text-sm text-muted-foreground'>{row.label}</span>
      <span className='flex flex-wrap items-baseline gap-x-3'>
        <span className='text-xs text-muted-foreground tabular-nums'>{row.baseRelative}</span>
        <span className='text-lg font-semibold tabular-nums md:text-xl'>{row.amount}</span>
      </span>
    </div>
  );
}

/** 내 시장 맞춤 금액. 전국 공식과 근거의 모양이 달라 같은 목록에 섞지 않고 위에 따로 둔다. */
function MarketPickSection({ view }: { readonly view: MarketPickView }) {
  return (
    <section aria-labelledby='market-pick-title' className='mt-4'>
      <h3 id='market-pick-title' className='text-sm font-semibold'>
        {view.title}
      </h3>
      {view.kind === 'not-applicable' ? (
        <p className='mt-2 text-sm text-muted-foreground'>{view.reason}</p>
      ) : (
        <>
          <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>{view.basis}</p>
          <ol className='mt-3 space-y-2'>
            {view.rows.map((row) => (
              <li key={row.label} className='rounded-md border border-border px-3 py-2'>
                <AmountRow row={row} />
              </li>
            ))}
          </ol>
          {view.single === null ? null : (
            <div className='mt-2 rounded-md bg-muted/60 px-3 py-2'>
              <AmountRow row={view.single} />
            </div>
          )}
          {view.pairNote === null ? null : (
            <p className='mt-2 text-xs text-muted-foreground'>{view.pairNote}</p>
          )}
          <p className='mt-3 text-xs leading-relaxed text-muted-foreground tabular-nums'>
            {view.record}
          </p>
        </>
      )}
    </section>
  );
}

function NationalHeading() {
  return (
    <h3 id='national-rule-title' className='text-sm font-semibold'>
      전국 공식
    </h3>
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
        <MarketPickSection view={view.market} />
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
      <MarketPickSection view={view.market} />
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
                <span className='text-lg font-semibold tabular-nums md:text-xl'>{row.amount}</span>
              </div>
              <p className='mt-1 text-xs text-muted-foreground tabular-nums'>{row.baseRelative}</p>
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
