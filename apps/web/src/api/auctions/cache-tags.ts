/** @module 책임: 공고 조회 캐시 항목에 걸 태그 집합을 계약 어휘에서 파생한다. */
import {
  ALL_AUCTIONS_CACHE_TAG,
  auctionCacheTag,
  type CacheTag
} from '@eatbid/contracts/values/cache-tag';

/**
 * 공고 하나의 태그와 공고 전체 태그를 함께 건다. 발행은 어느 공고가 바뀌었는지 목록으로 알려주지
 * 않으므로(ADR 0036-4) 실제로 지워지는 것은 대개 `allAuctions` 쪽이고, `auction:<id>`는 정정 공고
 * 하나만 지우고 싶을 때 쓰는 자리다.
 */
export function auctionReadCacheTags(auctionId: string): readonly CacheTag[] {
  return [auctionCacheTag(auctionId), ALL_AUCTIONS_CACHE_TAG];
}
