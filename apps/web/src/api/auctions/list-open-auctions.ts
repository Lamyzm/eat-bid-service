/** @module 책임: 열린 공고 목록 query를 listOpenAuctions operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  auctionV1Operations,
  type OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';

import type { ContractRequest } from '../_transport/request-contract';
import { mapOpenAuctionListError } from './auction-resource-error';

export type OpenAuctionListInput = {
  readonly sido?: string;
  /** 고른 시도 **안의** 시군구다. 시도 없이 보내면 어느 시도 안인지 말하지 않아 서버가 400으로 답한다. */
  readonly sigungu?: readonly string[];
  readonly regionUnknown?: 'include';
  /** 워크스페이스가 확인한 참가제한지역 code value id 목록이다. 비면 필터를 걸지 않는다. */
  readonly eligibilityArea?: readonly string[];
  readonly items?: readonly string[];
  readonly itemUnknown?: 'include';
  /** 제목·기관 이름·공고번호 안의 부분일치 검색어다. 다른 축 안에서만 찾는다. */
  readonly q?: string;
  readonly bidState?: 'none';
  readonly closesWithinHours?: number;
  /** KST 달력일 축 둘이다. 계약이 시간 창과 마감 달력일을 함께 받지 않으므로 호출자가 하나만 넘긴다. */
  readonly closesOn?: string;
  readonly announcedOn?: string;
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export async function listOpenAuctionsWith(
  request: ContractRequest,
  input: OpenAuctionListInput & { readonly signal?: AbortSignal }
): Promise<OpenAuctionListV1Response> {
  const query = auctionV1Operations.listOpen.querySchema.parse({
    sido: input.sido,
    sigungu: input.sigungu,
    regionUnknown: input.regionUnknown,
    eligibilityArea: input.eligibilityArea,
    items: input.items,
    itemUnknown: input.itemUnknown,
    q: input.q,
    bidState: input.bidState,
    closesWithinHours: input.closesWithinHours,
    closesOn: input.closesOn,
    announcedOn: input.announcedOn,
    baseAmountMin: input.baseAmountMin,
    baseAmountMax: input.baseAmountMax,
    cursor: input.cursor,
    limit: input.limit
  });
  try {
    return await request({
      operation: auctionV1Operations.listOpen,
      path: {},
      query,
      signal: input.signal
    });
  } catch (error) {
    throw mapOpenAuctionListError(request, error, { hasCursor: query.cursor !== undefined });
  }
}
