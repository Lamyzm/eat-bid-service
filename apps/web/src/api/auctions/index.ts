/** @module 책임: browser consumer가 사용하는 공고 조회·열린 공고 목록 조회와 TanStack Query 공개 표면을 제공한다. */
import type {
  AuctionV1Response,
  OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';

import { browserRequest } from '../_transport/browser-request';
import { getAuctionWith } from './get-auction';
import { listOpenAuctionsWith, type OpenAuctionListInput } from './list-open-auctions';
import { createAuctionQueries } from './queries';

export type {
  AuctionV1Response,
  OpenAuction,
  OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';
export type { OpenAuctionListInput } from './list-open-auctions';

export function getAuction(input: {
  readonly auctionId: string;
  readonly signal?: AbortSignal;
}): Promise<AuctionV1Response> {
  return getAuctionWith(browserRequest, input);
}

export function listOpenAuctions(
  input: OpenAuctionListInput & { readonly signal?: AbortSignal }
): Promise<OpenAuctionListV1Response> {
  return listOpenAuctionsWith(browserRequest, input);
}

export const auctionQueries = createAuctionQueries(browserRequest);
