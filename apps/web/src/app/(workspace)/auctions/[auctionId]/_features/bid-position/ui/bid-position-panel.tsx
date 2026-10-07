/** @module 책임: 운영자에게 공고 회차의 추천 투찰가 금액을 근거·보정 상태와 함께 보이는 패널을 렌더링한다. */
import type { ReactNode } from 'react';

import type { BidPositionView } from '../model/present-bid-position';

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

export function BidPositionPanel({ view }: { readonly view: BidPositionView }) {
  if (view.kind === 'unavailable')
    return (
      <PanelFrame>
        <p role='status' className='mt-2 text-sm text-muted-foreground'>
          추천 투찰가를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.
        </p>
      </PanelFrame>
    );
  if (view.kind === 'not-applicable')
    return (
      <PanelFrame>
        <p className='mt-2 text-xs text-muted-foreground'>{view.inputs}</p>
        <p className='mt-3 text-sm'>{view.reason}</p>
        {view.timingNote === null ? null : (
          <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>{view.timingNote}</p>
        )}
        <p className='mt-3 text-xs text-muted-foreground'>{view.rule}</p>
      </PanelFrame>
    );
  return (
    <PanelFrame>
      <p className='mt-2 text-xs text-muted-foreground'>
        {view.inputs} · {view.band}
      </p>
      {view.timingNote === null ? null : (
        <p role='note' className='mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed'>
          {view.timingNote}
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
    </PanelFrame>
  );
}
