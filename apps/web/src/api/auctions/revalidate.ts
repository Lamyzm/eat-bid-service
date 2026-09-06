/** @module 책임: 공고 조회 캐시 항목을 발행 범위에 맞춰 무효화한다. */
import 'server-only';

import {
  ALL_AUCTIONS_CACHE_TAG,
  auctionCacheTag
} from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/**
 * `revalidateTag` 호출은 이 resource에서 이 함수만 한다(ADR 0028-4). 호출자는 태그 문자열이 아니라
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
