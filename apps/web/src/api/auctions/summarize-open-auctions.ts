/** @module 책임: 열린 공고 요약 query를 summarizeOpen operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  auctionV1Operations,
  type OpenAuctionSummaryV1Response
} from '@eatbid/contracts/api/v1/auctions';

import type { ContractRequest } from '../_transport/request-contract';

/**
 * 목록 입력과 필터 atom을 공유하되 `cursor`·`limit`이 없다. 요약은 페이지가 아니라 조건을 만족하는
 * 전체를 세므로 목록 입력을 그대로 넘기면 cursor가 세는 범위를 조용히 바꾼다.
 */
export type OpenAuctionSummaryInput = {
  readonly sido?: string;
  readonly sigungu?: readonly string[];
  readonly eligibilityArea?: readonly string[];
  readonly items?: readonly string[];
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
  readonly calendarFrom: string;
  readonly calendarTo: string;
};

export async function summarizeOpenAuctionsWith(
  request: ContractRequest,
  input: OpenAuctionSummaryInput & { readonly signal?: AbortSignal }
): Promise<OpenAuctionSummaryV1Response> {
  const query = auctionV1Operations.summarizeOpen.querySchema.parse({
    sido: input.sido,
    sigungu: input.sigungu,
    eligibilityArea: input.eligibilityArea,
    items: input.items,
    baseAmountMin: input.baseAmountMin,
    baseAmountMax: input.baseAmountMax,
    calendarFrom: input.calendarFrom,
    calendarTo: input.calendarTo
  });
  return await request({
    operation: auctionV1Operations.summarizeOpen,
    path: {},
    query,
    signal: input.signal
  });
}
