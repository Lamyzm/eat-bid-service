/** @module 책임: 회차 명단 조회 use case와 그 실패 분류(없음·장애·무결성)를 소유한다. */
import { Effect } from "effect";
import { AuctionRosterIntegrityError, type AuctionRosterQuery, type AuctionRosterReader, type AuctionRosterRecord } from "./auction-roster-reader";
import { ProcurementDependencyUnavailable } from "./failures";
import { AuctionNotFound } from "./find-auction";

export class GetAuctionRoster {
  constructor(private readonly reader: AuctionRosterReader) {}
  /** 공개 응답이 아니라 내부 record를 돌려준다. wire 직렬화는 presentation의 presenter가 한다(ADR 0045 결정 1). */
  execute(query: AuctionRosterQuery): Effect.Effect<
    AuctionRosterRecord, AuctionNotFound | ProcurementDependencyUnavailable | AuctionRosterIntegrityError
  > {
    return Effect.tryPromise({
      try: () => this.reader.find(query),
      catch: (cause) => cause instanceof AuctionRosterIntegrityError
        ? cause : new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.flatMap((record) => record === null
      ? Effect.fail(new AuctionNotFound(query.auctionId))
      : Effect.succeed(record)));
  }
}
