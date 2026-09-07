/** @module 책임: 공고 resource의 404 Problem과 열린 공고 목록의 cursor 400 Problem을 화면이 다룰 수 있는 의미로 변환한다. */
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

class OpenAuctionCursorInvalidError extends Error {
  readonly name = 'OpenAuctionCursorInvalidError';

  constructor(cause: unknown) {
    super('요청한 커서가 지금 열린 공고 목록에 없습니다. 목록이 갱신됐을 수 있습니다.', { cause });
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

/**
 * 서버는 사라진 cursor와 그 밖의 query 오류를 같은 400 VALIDATION_ERROR로 닫는다. 요청에 cursor가
 * 실렸을 때만 cursor 문제로 좁히고, 나머지 400은 원래 Problem 그대로 올려 보낸다.
 */
export function mapOpenAuctionListError(
  request: ContractRequest,
  error: unknown,
  input: { readonly hasCursor: boolean }
): unknown {
  if (input.hasCursor && request.isProblem(error) && error.status === 400 && error.code === 'VALIDATION_ERROR') {
    return new OpenAuctionCursorInvalidError(error);
  }
  return error;
}

export function isAuctionNotFoundError(error: unknown): error is AuctionNotFoundError {
  return error instanceof AuctionNotFoundError;
}

export function isOpenAuctionCursorInvalidError(error: unknown): error is OpenAuctionCursorInvalidError {
  return error instanceof OpenAuctionCursorInvalidError;
}
