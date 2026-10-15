/** @module 책임: 하한선 자리 맨 위 요약 네 줄(건수·범위·범위의 한계·이번 달 개찰)을 그린다. */
import type { FloorSummaryView } from '../model/present-summary';

export function FloorSummary({ view }: { readonly view: FloorSummaryView }) {
  return (
    <section aria-label='요약' className='grid max-w-[78ch] gap-1.5'>
      <p className='text-[14px] font-semibold text-muted-foreground'>{view.headline}</p>
      {view.range === null ? null : (
        <p className='text-[19px] leading-snug font-bold tracking-[-0.02em] text-balance'>
          {view.range.lead}
          <b className='text-primary'>{view.range.strong}</b>
          {view.range.rest}
        </p>
      )}
      {view.caution === null ? null : <p className='text-[15px] font-semibold text-foreground'>{view.caution}</p>}
      <p className='text-[14px] text-muted-foreground'>{view.thisMonth}</p>
    </section>
  );
}
