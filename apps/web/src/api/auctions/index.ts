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
