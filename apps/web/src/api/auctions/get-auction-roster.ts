/** @module 책임: 선택 회차와 revision의 명단을 공개 operation과 검증된 transport로 조회한다. */
import { auctionV1Operations, type AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import type { ContractRequest } from '../_transport/request-contract';
import { mapAuctionResourceError } from './auction-resource-error';

export interface AuctionRosterInput {
  readonly auctionId: string;
  readonly revisionId?: string;
  readonly signal?: AbortSignal;
}
export async function getAuctionRosterWith(request: ContractRequest, input: AuctionRosterInput): Promise<AuctionRosterV1Response> {
  const operation = auctionV1Operations.roster;
  const path = operation.pathSchema.parse({ auctionId: input.auctionId });
  const query = operation.querySchema.parse({ revisionId: input.revisionId });
  try {
    return await request({ operation, path, query, signal: input.signal });
  } catch (error) {
    throw mapAuctionResourceError(request, error, path.auctionId);
  }
}
