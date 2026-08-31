import 'server-only';

import { auctionV1Operations, type AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { serverRequest } from '../_transport/server-request.server';
import { isAuctionNotFoundError } from './auction-resource-error';
import { getAuctionWith } from './get-auction';

export function parseAuctionId(auctionId: string): string {
  return auctionV1Operations.find.pathSchema.parse({ auctionId }).auctionId;
}

export function getAuctionFromServer(input: {
  readonly auctionId: string;
  readonly signal?: AbortSignal;
}): Promise<AuctionV1Response> {
  return getAuctionWith(serverRequest, input);
}

export { isAuctionNotFoundError };
