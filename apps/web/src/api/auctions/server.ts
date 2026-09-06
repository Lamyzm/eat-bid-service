/** @module 책임: RSC에서만 쓰는 공고 ID 검증·캐시된 조회·not-found 판별 표면을 제공한다. */
import 'server-only';

import { auctionV1Operations, type AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';
import { cacheLife, cacheTag } from 'next/cache';

import { READ_CACHE_LIFE } from '@/shared/lib/read-cache-life';

import { serverRequest } from '../_transport/server-request.server';
import { isAuctionNotFoundError } from './auction-resource-error';
import { auctionReadCacheTags } from './cache-tags';
import { getAuctionWith } from './get-auction';

export function parseAuctionId(auctionId: string): string {
  return auctionV1Operations.find.pathSchema.parse({ auctionId }).auctionId;
}

/**
 * 캐시 경계다. `use cache`의 인자는 직렬화 가능해야 하므로 `signal`은 여기서 받지 않는다. 취소 가능한
 * 조회가 필요한 호출자는 transport 독립 `getAuctionWith`를 그대로 쓴다.
 *
 * 오류는 캐시되지 않는다. 아직 발행되지 않은 공고를 열면 매번 Nest에 닿고, 발행되는 순간 무효화 없이
 * 보이게 된다. 이것은 의도된 성질이다.
 */
export async function getAuctionFromServer(input: {
  readonly auctionId: string;
}): Promise<AuctionV1Response> {
  'use cache';
  cacheTag(...auctionReadCacheTags(input.auctionId));
  cacheLife(READ_CACHE_LIFE);
  return await getAuctionWith(serverRequest, input);
}

export { isAuctionNotFoundError };
export { revalidateAuctionCache } from './revalidate';
