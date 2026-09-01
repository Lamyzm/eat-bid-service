/** @module 책임: 공고 식별자를 operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import { auctionV1Operations, type AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAuctionResourceError } from './auction-resource-error';

export async function getAuctionWith(
  request: ContractRequest,
  input: { readonly auctionId: string; readonly signal?: AbortSignal }
): Promise<AuctionV1Response> {
  const path = auctionV1Operations.find.pathSchema.parse({ auctionId: input.auctionId });
  try {
    return await request({
      operation: auctionV1Operations.find,
      path,
      signal: input.signal
    });
  } catch (error) {
    throw mapAuctionResourceError(request, error, path.auctionId);
  }
}
