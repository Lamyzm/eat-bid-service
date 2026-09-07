/** @module 책임: RSC에서만 쓰는 공고 ID 검증과 `use cache` 경계 안의 공고·열린 공고 목록 조회를 예상된 실패까지 결과 값으로 돌려주는 표면을 제공한다. */
import 'server-only';

import {
  auctionV1Operations,
  type AuctionV1Response,
  type OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';
import { cacheLife, cacheTag } from 'next/cache';

import { READ_CACHE_LIFE } from '@/shared/lib/read-cache-life';

import { serverRequest } from '../_transport/server-request.server';
import { isAuctionNotFoundError, isOpenAuctionCursorInvalidError } from './auction-resource-error';
import { auctionReadCacheTags, openAuctionsReadCacheTags } from './cache-tags';
import { getAuctionWith } from './get-auction';
import { listOpenAuctionsWith, type OpenAuctionListInput } from './list-open-auctions';

export function parseAuctionId(auctionId: string): string {
  return auctionV1Operations.find.pathSchema.parse({ auctionId }).auctionId;
}

/**
 * 없는 공고는 예외가 아니라 결과다. `use cache` 경계를 넘는 예외는 Flight로 옮겨지며 class 정체성을 잃어
 * 호출자가 `instanceof`로 404를 가려낼 수 없고, 그러면 `notFound()` 대신 error 경계가 뜬다. 캐시 함수는
 * 예상된 실패를 값으로 돌려준다.
 */
export type AuctionRead =
  | { readonly kind: 'auction'; readonly response: AuctionV1Response }
  | { readonly kind: 'not-found' };

/**
 * 캐시 경계다. `use cache`의 인자는 직렬화 가능해야 하므로 `signal`은 여기서 받지 않는다. 취소 가능한
 * 조회가 필요한 호출자는 transport 독립 `getAuctionWith`를 그대로 쓴다.
 *
 * `not-found`도 하나의 결과라 캐시된다. 아직 발행되지 않은 공고를 열면 그 항목은 `READ_CACHE_LIFE`
 * 동안 없음으로 남고, 발행 push(`revalidateAuctionCache`)가 같은 태그를 지우는 순간 다시 보인다.
 * 그 밖의 실패는 캐시되지 않고 그대로 올라가 route error 경계가 받는다.
 */
export async function getAuctionFromServer(input: { readonly auctionId: string }): Promise<AuctionRead> {
  'use cache';
  cacheTag(...auctionReadCacheTags(input.auctionId));
  cacheLife(READ_CACHE_LIFE);
  try {
    return { kind: 'auction', response: await getAuctionWith(serverRequest, input) };
  } catch (error) {
    if (isAuctionNotFoundError(error)) return { kind: 'not-found' };
    throw error;
  }
}

/** 사라진 cursor도 같은 이유로 결과 값이다. */
export type OpenAuctionListRead =
  | { readonly kind: 'page'; readonly response: OpenAuctionListV1Response }
  | { readonly kind: 'cursor-not-found' };

/**
 * 열린 공고 목록의 캐시 경계다. 필터 조합이 그대로 캐시 키가 된다. 목록 멤버십은 서버 clock의
 * `asOf`에 걸려 있어 같은 build에서도 시간이 지나면 답이 달라지므로, 이 항목은 build 전환 push뿐
 * 아니라 `READ_CACHE_LIFE`의 유계 수명으로도 늙는다. 화면은 응답의 `meta.asOf`를 그대로 보여 준다.
 */
export async function listOpenAuctionsFromServer(input: OpenAuctionListInput): Promise<OpenAuctionListRead> {
  'use cache';
  cacheTag(...openAuctionsReadCacheTags());
  cacheLife(READ_CACHE_LIFE);
  try {
    return { kind: 'page', response: await listOpenAuctionsWith(serverRequest, input) };
  } catch (error) {
    if (isOpenAuctionCursorInvalidError(error)) return { kind: 'cursor-not-found' };
    throw error;
  }
}

export { revalidateAuctionCache, revalidateOpenAuctionSnapshotCache } from './revalidate';
