/**
 * @module 책임: 공고 한 건의 관측값으로 전국 추천 투찰가 규칙을 적용하고, 요청자 워크스페이스의 이번 달 맞춤·아침 갱신 결정을
 * 그 공고의 금액으로 바꾸는 use case와 그 내부 record를 소유한다.
 */
import { Effect } from "effect";
import { Temporal, type BidRate, type Money } from "@eatbid/domain";

import { BID_POSITION_RULE, positionBids, type BidPositionResult, type BidPositionRuleTable } from "../domain/bid-position-rule";
import type { AuctionId } from "../domain/auction-id";
import type { KstMonth } from "../domain/kst-month";
import type { MarketPickResult } from "../domain/market-position-pick";
import type { MarketPositionPickMethod } from "../domain/market-position-pick-table";
import type { AuctionReader, ParticipationObservationRecord } from "./auction-reader";
import { marketPickFor, type DecideMarketPick } from "./decide-market-pick";
import {
  habitCompetitorCount,
  morningHabitPickFor,
  type DecideMorningHabitPick,
  type MorningHabitPickResult,
} from "./decide-morning-habit-pick";
import type { MorningHabitMethod } from "../domain/morning-habit-pick-table";
import { AuctionDependencyUnavailable, AuctionNotFound } from "./find-auction";

export interface MarketPickRecord {
  readonly method: MarketPositionPickMethod;
  /** 고르는 데 쓴 개찰 달 `[fromMonth, throughMonth]`다. 요청한 달은 아직 끝나지 않아 넣지 않는다. */
  readonly window: { readonly fromMonth: KstMonth; readonly throughMonth: KstMonth };
  readonly result: MarketPickResult;
}

export interface MorningHabitRecord {
  readonly method: MorningHabitMethod;
  readonly decidedAt: Temporal.Instant;
  readonly result: MorningHabitPickResult;
}

export interface AuctionBidPositionRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly baseAmount: Money;
  readonly floorRate: BidRate | null;
  readonly participation: ParticipationObservationRecord | null;
  readonly deadlineAt: Temporal.Instant | null;
  readonly rule: BidPositionRuleTable;
  readonly result: BidPositionResult;
  readonly marketPick: MarketPickRecord;
  /** 요청이 아침 갱신을 고르지 않았으면 `null`이다. */
  readonly morningHabit: MorningHabitRecord | null;
}

/**
 * 공고 조회 port를 그대로 쓴다. 규칙이 쓰는 값(기초금액·하한율·목록 참여 수)이 공고 응답이 이미 싣는 관측이라
 * 새 질의를 만들면 같은 사실을 두 경로로 읽게 된다. 참여 수는 최신 관측이다 — 규칙의 조건은 마감 1시간 전
 * 참여 수이므로, 관측이 그보다 이르면 도메인의 보정표가 마감 1시간 전 참여 수를 추정하고 그 사실을 결과에 남긴다.
 *
 * 이번 달 맞춤은 `DecideMarketPick`이 고르고 여기서는 이 공고의 금액으로만 바꾼다. 결정은 실패해도 던지지 않으므로 맞춤 장애가
 * 전국 규칙까지 503으로 만들지 않는다.
 */
export class FindAuctionBidPosition {
  constructor(
    private readonly reader: AuctionReader,
    private readonly decideMarketPick: DecideMarketPick,
    private readonly decideMorningHabit: DecideMorningHabitPick,
  ) {}

  execute(input: {
    readonly auctionId: AuctionId;
    readonly workspaceId: bigint;
    readonly includeMorningHabit: boolean;
  }): Effect.Effect<
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
        // 두 결정은 서로 기다릴 이유가 없어 함께 읽는다. 둘 다 실패를 던지지 않고 결정으로 닫는다.
        const decisions = Promise.all([
          this.decideMarketPick.decide({ workspaceId: input.workspaceId, floorRate }),
          input.includeMorningHabit
            ? this.decideMorningHabit.decide({ workspaceId: input.workspaceId, floorRate })
            : Promise.resolve(null),
        ]);
        return Effect.promise(() => decisions)
          .pipe(Effect.map(([decision, habit]): AuctionBidPositionRecord => ({
            auctionId: auction.auctionId,
            revisionId: auction.revisionId,
            baseAmount: auction.baseAmount,
            floorRate,
            participation,
            deadlineAt: auction.deadlineAt,
            rule: BID_POSITION_RULE,
            result: positionBids({ baseAmount: auction.baseAmount, floorRate, participation, deadlineAt: auction.deadlineAt }),
            marketPick: {
              method: decision.method,
              window: { fromMonth: decision.window.fromMonth, throughMonth: decision.window.throughMonth },
              result: marketPickFor(decision, { baseAmount: auction.baseAmount, floorRate }),
            },
            morningHabit: habit === null ? null : {
              method: habit.method,
              decidedAt: habit.decidedAt,
              result: morningHabitPickFor(habit, {
                baseAmount: auction.baseAmount,
                floorRate,
                deadlineAt: auction.deadlineAt,
                competitorCount: habitCompetitorCount({ floorRate, deadlineAt: auction.deadlineAt, participation }),
              }),
            },
          })));
      }),
    );
  }
}
