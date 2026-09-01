/** @module 책임: browser consumer가 사용하는 공고 조회와 TanStack Query 공개 표면을 제공한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { browserRequest } from '../_transport/browser-request';
import { getAuctionWith } from './get-auction';
import { createAuctionQueries } from './queries';

export type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

export function getAuction(input: {
  readonly auctionId: string;
  readonly signal?: AbortSignal;
}): Promise<AuctionV1Response> {
  return getAuctionWith(browserRequest, input);
}

export const auctionQueries = createAuctionQueries(browserRequest);
