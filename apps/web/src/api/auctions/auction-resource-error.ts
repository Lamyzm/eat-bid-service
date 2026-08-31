import type { ContractRequest } from '../_transport/request-contract';

class AuctionNotFoundError extends Error {
  readonly name = 'AuctionNotFoundError';

  constructor(
    readonly auctionId: string,
    cause: unknown
  ) {
    super('공고를 찾을 수 없습니다.', { cause });
  }
}

export function mapAuctionResourceError(
  request: ContractRequest,
  error: unknown,
  auctionId: string
): unknown {
  if (request.isProblem(error) && error.status === 404 && error.code === 'AUCTION_NOT_FOUND') {
    return new AuctionNotFoundError(auctionId, error);
  }
  return error;
}

export function isAuctionNotFoundError(error: unknown): error is AuctionNotFoundError {
  return error instanceof AuctionNotFoundError;
}
