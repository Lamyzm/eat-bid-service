/** @module 책임: 오늘 투찰의 품목 조건을 주소(`items`)에 켜고 끄는 버튼 줄을 그린다. 고른 조건이 곧 즐겨찾기할 주소다. */
'use client';
import { AUCTION_ITEM_ATOMS } from '@eatbid/contracts/api/v1/auctions';
import { useQueryState } from 'nuqs';
import { useTransition } from 'react';

import { workSearchParsers } from '@/app/(workspace)/work/_lib/work-search';

/**
 * 조건의 진실 원천은 주소다. 버튼은 주소를 바꾸고 서버 조회를 다시 부른다(`shallow: false`). 아무것도 고르지 않으면 품목으로
 * 좁히지 않는다 — 관심 지역 공고 전부다.
 */
export function ItemChips() {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useQueryState(
    'items',
    workSearchParsers.items.withOptions({ shallow: false, history: 'replace', scroll: false, startTransition })
  );
  const chosen = new Set(items ?? []);
  function toggle(atom: string) {
    const next = new Set(chosen);
    if (next.has(atom)) next.delete(atom);
    else next.add(atom);
    void setItems(next.size === 0 ? null : AUCTION_ITEM_ATOMS.filter((value) => next.has(value)));
  }
  return (
    <div role='group' aria-label='품목' aria-busy={pending} className='mt-4 flex flex-wrap items-center gap-1.5'>
      {AUCTION_ITEM_ATOMS.map((atom) => (
        <button
          key={atom}
          type='button'
          aria-pressed={chosen.has(atom)}
          onClick={() => toggle(atom)}
          className='rounded-full border border-border px-3 py-1 text-[13px] font-semibold text-muted-foreground aria-[pressed=true]:border-primary aria-[pressed=true]:bg-primary aria-[pressed=true]:text-primary-foreground'
        >
          {atom}
        </button>
      ))}
      <span className='ml-1 text-[12px] text-muted-foreground/70'>{chosen.size === 0 ? '품목 전부' : '고른 품목만'}</span>
    </div>
  );
}
