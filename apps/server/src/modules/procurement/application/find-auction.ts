/** @module 책임: 공고 한 건 조회 use case와 그 예상 실패 분류를 소유한다. */
import { Effect } from "effect";
import type { AuctionReader, AuctionRecord } from "./auction-reader";
import { ProcurementDependencyUnavailable } from "./failures";
import type { AuctionId } from "../domain/auction-id";
import { auctionIdToString } from "../domain/auction-id";

export interface FindAuctionInput {
  readonly auctionId: AuctionId;
}

export class AuctionNotFound extends Error {
  readonly code = "AUCTION_NOT_FOUND" as const;

  constructor(readonly auctionId: AuctionId) {
    super(`Auction ${auctionIdToString(auctionId)} was not found`);
    this.name = "AuctionNotFound";
  }
}

/**
 * 공고 한 건 조회에만 쓰는 자원 이름 실패다. 모듈 공통 실패의 하위형이라 controller가 어느 쪽으로
 * 잡아도 같은 503이며, 다른 use case는 이 이름을 빌리지 않고 모듈 공통 실패를 던진다(ADR 0045 결정 5).
 */
export class AuctionDependencyUnavailable extends ProcurementDependencyUnavailable {
  constructor(cause: unknown) {
    super(cause);
    this.name = "AuctionDependencyUnavailable";
  }
}

export class FindAuction {
  constructor(private readonly reader: AuctionReader) {}

  /** 공개 응답이 아니라 내부 record를 돌려준다. wire 직렬화는 presentation의 presenter가 한다(ADR 0045 결정 1). */
  execute(input: FindAuctionInput): Effect.Effect<
    AuctionRecord,
    AuctionNotFound | AuctionDependencyUnavailable,
    never
  > {
    // "없음"과 의존성 장애를 타입이 있는 실패 채널로 분리해 HTTP 계층이 결함과 혼동하지 않게 한다.
    return Effect.tryPromise({
      try: () => this.reader.findById(input.auctionId),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((record) => record === null
        ? Effect.fail(new AuctionNotFound(input.auctionId))
        : Effect.succeed(record)),
    );
  }
}
