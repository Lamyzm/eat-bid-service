/**
 * @module 책임: 오늘 투찰 URL의 품목 조건을 nuqs parser로 읽고 계약이 받는 품목 원자만 남긴다.
 *
 * 품목은 오늘 화면과 같은 이름(`items`, 쉼표 구분)이라 같은 조건을 즐겨찾기한 주소가 두 화면에서 같은 뜻이다. 지역은 URL에 없다 —
 * 서버가 저장된 관심 지역을 읽는다.
 */
import { AUCTION_ITEM_ATOMS } from '@eatbid/contracts/api/v1/auctions';
import { parseAsArrayOf, parseAsString } from 'nuqs/server';

export const workSearchParsers = {
  items: parseAsArrayOf(parseAsString, ','),
  itemUnknown: parseAsString
};

type ItemAtom = (typeof AUCTION_ITEM_ATOMS)[number];

const isItemAtom = (value: string): value is ItemAtom => (AUCTION_ITEM_ATOMS as readonly string[]).includes(value);

/** 어휘 밖 값은 버린다. 그대로 보내면 서버가 400으로 화면 전체를 실패로 만든다 — 손으로 고친 주소 하나가 화면을 막지 않게 한다. */
export function workItemsOf(search: { readonly items: readonly string[] | null; readonly itemUnknown: string | null }): {
  readonly items: readonly ItemAtom[] | undefined;
  readonly itemUnknown: 'include' | undefined;
} {
  const items = search.items?.filter(isItemAtom) ?? [];
  return {
    items: items.length === 0 ? undefined : items,
    itemUnknown: search.itemUnknown === 'include' ? 'include' : undefined
  };
}
