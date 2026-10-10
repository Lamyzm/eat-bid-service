/** @module 책임: 공고 한 건의 관측값으로 추천 투찰가 규칙을 적용하는 use case와 그 내부 record를 소유한다. */
import { Effect } from "effect";
import type { BidRate, Money, Temporal } from "@eatbid/domain";

import { BID_POSITION_RULE, positionBids, type BidPositionResult, type BidPositionRuleTable } from "../domain/bid-position-rule";
import type { AuctionId } from "../domain/auction-id";
import type { AuctionReader, ParticipationObservationRecord } from "./auction-reader";
import { AuctionDependencyUnavailable, AuctionNotFound } from "./find-auction";

export interface AuctionBidPositionRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly baseAmount: Money;
  readonly floorRate: BidRate | null;
  readonly participation: ParticipationObservationRecord | null;
  readonly deadlineAt: Temporal.Instant | null;
  readonly rule: BidPositionRuleTable;
  readonly result: BidPositionResult;
}

/**
 * 공고 조회 port를 그대로 쓴다. 규칙이 쓰는 값(기초금액·하한율·목록 참여 수)이 공고 응답이 이미 싣는 관측이라
 * 새 질의를 만들면 같은 사실을 두 경로로 읽게 된다. 참여 수는 최신 관측이다 — 규칙의 조건은 마감 1시간 전
 * 참여 수이므로, 관측이 그보다 이르면 도메인의 보정표가 마감 1시간 전 참여 수를 추정하고 그 사실을 결과에 남긴다.
 */
export class FindAuctionBidPosition {
  constructor(private readonly reader: AuctionReader) {}

  execute(input: { readonly auctionId: AuctionId }): Effect.Effect<
    AuctionBidPositionRecord,
    AuctionNotFound | AuctionDependencyUnavailable,
    never
  > {
    return Effect.tryPromise({
      try: () => this.reader.findById(input.auctionId),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((auction) => {
        if (auction === null) return Effect.fail(new AuctionNotFound(input.auctionId));
        const floorRate = auction.terms?.floorRate ?? null;
        const participation = auction.participation?.latest ?? null;
        return Effect.succeed({
          auctionId: auction.auctionId,
          revisionId: auction.revisionId,
          baseAmount: auction.baseAmount,
          floorRate,
          participation,
          deadlineAt: auction.deadlineAt,
          rule: BID_POSITION_RULE,
          result: positionBids({ baseAmount: auction.baseAmount, floorRate, participation, deadlineAt: auction.deadlineAt }),
        });
      }),
    );
  }
}
