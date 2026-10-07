/** @module 책임: 공고 회차의 추천 투찰가를 공개 operation과 검증된 transport로 조회하고 운영자 권한 없음을 결과 값으로 돌려준다. */
import {
  auctionV1Operations,
  type AuctionBidPositionV1Response
} from '@eatbid/contracts/api/v1/auctions';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAuctionResourceError } from './auction-resource-error';

/**
 * 운영자 권한이 없다는 403은 실패가 아니라 "이 사람에게는 패널이 없다"는 상태다. 예외로 두면 호출자가 status
 * 숫자를 다시 세야 하고, 공고 화면 전체가 error 경계로 빠질 수 있다.
 */
export type AuctionBidPositionRead =
  | { readonly kind: 'position'; readonly response: AuctionBidPositionV1Response }
  | { readonly kind: 'forbidden' };

export async function getAuctionBidPositionWith(
  request: ContractRequest,
  input: { readonly auctionId: string; readonly signal?: AbortSignal }
): Promise<AuctionBidPositionRead> {
  const operation = auctionV1Operations.bidPosition;
  const path = operation.pathSchema.parse({ auctionId: input.auctionId });
  try {
    return { kind: 'position', response: await request({ operation, path, signal: input.signal }) };
  } catch (error) {
    if (request.isProblem(error) && error.status === 403) return { kind: 'forbidden' };
    throw mapAuctionResourceError(request, error, path.auctionId);
  }
}
