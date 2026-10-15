/** @module 책임: 하한선 자리로 들어가는 입구 한 줄(범위·건수와 링크)을 오늘 투찰·복기·공고 상세에서 같은 모양으로 그린다. */
import Link from 'next/link';

import type { FloorEntryView } from './floor-entry';

export function FloorEntryLine({ view, className = '' }: { readonly view: FloorEntryView; readonly className?: string }) {
  return (
    <p data-slot='floor-entry' className={`rounded-xl bg-muted/70 px-3.5 py-2.5 text-[14px] leading-relaxed break-keep text-muted-foreground ${className}`}>
      {view.lead}
      {view.strong === null ? null : <b className='font-bold text-foreground'>{view.strong}</b>}
      {view.rest}{' '}
      <Link href={view.href} className='ml-1.5 font-bold whitespace-nowrap text-primary hover:underline'>
        {view.linkText}
      </Link>
    </p>
  );
}
