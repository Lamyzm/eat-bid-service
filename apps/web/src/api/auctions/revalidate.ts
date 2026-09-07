/** @module 책임: 공고 조회와 열린 공고 목록 캐시 항목을 발행·mart build 전환 범위에 맞춰 무효화한다. */
import 'server-only';

import {
  ALL_AUCTIONS_CACHE_TAG,
  auctionCacheTag,
  martCacheTag
} from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/**
 * `revalidateTag` 호출은 이 resource에서 이 파일만 한다(ADR 0028-4). 호출자는 태그 문자열이 아니라
 * 발행 범위를 넘기며, 그 범위를 태그로 옮기는 규칙은 읽는 쪽 태그를 만든 어휘와 같은 것을 쓴다.
 */
export function revalidateAuctionCache(scope: {
  readonly auctionIds?: readonly string[];
  readonly allAuctions?: boolean;
}): void {
  if (scope.allAuctions === true) revalidateTag(ALL_AUCTIONS_CACHE_TAG, REVALIDATE_IMMEDIATELY);
  for (const auctionId of scope.auctionIds ?? []) {
    revalidateTag(auctionCacheTag(auctionId), REVALIDATE_IMMEDIATELY);
  }
}

/** 열린 공고 목록 항목이 여럿(필터 조합마다)이어도 지우는 신호는 `open_auction_snapshot` build 전환 하나다. */
export function revalidateOpenAuctionSnapshotCache(): void {
  revalidateTag(martCacheTag('open_auction_snapshot'), REVALIDATE_IMMEDIATELY);
}
