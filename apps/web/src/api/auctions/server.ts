/** @module 책임: RSC에서만 쓰는 공고 ID 검증과 세션 쿠키를 실어 나르는 공고·열린 공고 목록 조회를 예상된 실패까지 결과 값으로 돌려주는 표면을 제공한다. */
import 'server-only';

import {
  auctionV1Operations,
  type AuctionV1Response,
  type OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { isAuctionNotFoundError, isOpenAuctionCursorInvalidError } from './auction-resource-error';
import { getAuctionWith } from './get-auction';
import { listOpenAuctionsWith, type OpenAuctionListInput } from './list-open-auctions';

export function parseAuctionId(auctionId: string): string {
  return auctionV1Operations.find.pathSchema.parse({ auctionId }).auctionId;
}

/**
 * 없는 공고는 예외가 아니라 결과다. 이 union은 원래 `use cache` 경계를 넘는 예외가 Flight로 옮겨지며
 * class 정체성을 잃는 문제(호출자가 `instanceof`로 404를 가려낼 수 없는 문제)를 피하려고 생겼다. 지금은
 * `use cache`를 쓰지 않지만(아래 주석) 호출부(`_lib/load-auction-page.ts`)가 이미 이 결과 값 계약을
 * 소비하므로 형태를 그대로 유지한다.
 */
export type AuctionRead =
  | { readonly kind: 'auction'; readonly response: AuctionV1Response }
  | { readonly kind: 'not-found' };

/**
 * 이 조회는 `ProviderSessionGuard`가 걸린 제품 데이터 읽기다(ADR 0032 §12). `use cache` 경계 안에서는
 * 요청 쿠키를 읽을 수 없어(ADR 0028 §4) 게이트 앞에 익명으로 닿아 항상 401을 받는다 — 2026-09-10
 * EAT-138이 게이트를 올린 뒤 EAT-165로 드러난 장애가 이 함수였다. 그래서 `use cache`·`cacheTag`·
 * `cacheLife`를 모두 떼고 쿠키를 그대로 실어 나르는 `privateServerRequest`로 세션을 전달한다(ADR 0032
 * §14). `cache-tags.ts`의 태그 함수와 `revalidate.ts`는 걷어내지 않았으니 그 파일에서 "왜 안 불리는지"를
 * 확인할 수 있다.
 */
export async function getAuctionFromServer(input: { readonly auctionId: string }): Promise<AuctionRead> {
  try {
    return { kind: 'auction', response: await getAuctionWith(privateServerRequest, input) };
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
 * 열린 공고 목록도 같은 이유로 `use cache`를 쓰지 않는다(위 `getAuctionFromServer` 주석, EAT-165). 목록
 * 멤버십은 서버 clock의 `asOf`에 걸려 있어 캐시가 있었어도 유계 수명 안에서만 유효했다. 화면은 응답의
 * `meta.asOf`를 그대로 보여 준다.
 */
export async function listOpenAuctionsFromServer(input: OpenAuctionListInput): Promise<OpenAuctionListRead> {
  try {
    return { kind: 'page', response: await listOpenAuctionsWith(privateServerRequest, input) };
  } catch (error) {
    if (isOpenAuctionCursorInvalidError(error)) return { kind: 'cursor-not-found' };
    throw error;
  }
}

export { revalidateAuctionCache, revalidateOpenAuctionSnapshotCache } from './revalidate';
