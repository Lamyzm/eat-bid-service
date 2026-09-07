/** @module 책임: 공고 조회와 열린 공고 목록 캐시 항목에 걸 태그 집합을 계약 어휘에서 파생한다. */
import {
  ALL_AUCTIONS_CACHE_TAG,
  auctionCacheTag,
  martCacheTag,
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

/**
 * 열린 공고 목록은 두 mart를 읽는다. 행은 `open_auction_snapshot`, 기관 요약은 `org_round_summary`
 * build 전환이 신선도를 좌우하므로 어느 한쪽이 전환돼도 항목이 지워져야 한다(ADR 0036).
 */
export function openAuctionsReadCacheTags(): readonly CacheTag[] {
  return [martCacheTag('open_auction_snapshot'), martCacheTag('org_round_summary')];
}
