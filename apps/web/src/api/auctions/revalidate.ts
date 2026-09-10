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
 *
 * **지금은 지울 대상이 없다.** `server.ts`의 `getAuctionFromServer`가 EAT-165로 `use cache`를 버려서
 * `auctionReadCacheTags`로 태그를 거는 `use cache` 항목이 더는 생기지 않는다(ADR 0032 §14). 이 함수는
 * `app/internal/cache/revalidate/route.ts`(dataplane push 수신 endpoint)가 여전히 부르므로 호출
 * 자체는 계속되지만 `revalidateTag`가 지울 항목이 없어 사실상 no-op이다. 걷어내지 않는 이유는 캐시가
 * 다시 필요해질 때(§14) 이 자리를 그대로 쓰기 위해서이고, route의 공개 계약을 같은 변경에서 지우면
 * dataplane 배포 순서 문제가 생기기 때문이다.
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

/**
 * 열린 공고 목록 항목이 여럿(필터 조합마다)이어도 지우는 신호는 `open_auction_snapshot` build 전환
 * 하나다. **지금은 지울 대상이 없다** — 위 `revalidateAuctionCache` 주석과 같은 이유(EAT-165, ADR 0032
 * §14)로 `listOpenAuctionsFromServer`가 `use cache`를 버려 이 태그를 거는 항목이 없다.
 */
export function revalidateOpenAuctionSnapshotCache(): void {
  revalidateTag(martCacheTag('open_auction_snapshot'), REVALIDATE_IMMEDIATELY);
}
