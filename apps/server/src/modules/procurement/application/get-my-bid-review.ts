/**
 * @module 책임: 요청자 워크스페이스의 내 사업자가 넣은 공고를 달마다 모으고, 고른 달의 공고마다 그날 하한·낙찰·낸 값과 방법별 추천
 * 값(장부, 없으면 다시 계산)을 대조해 요약하는 복기 use case와 그 record를 소유한다.
 *
 * 방법 값의 출처를 섞지 않는다(PDR-0008 결정 7, ADR 0068). 장부에 마감 전에 내보낸 값이 있으면 그것을 쓰고, 없으면 지금 규칙을 그
 * 달 자료에 다시 돌린 값을 "다시 계산"으로 붙인다. 아침 갱신은 화면을 연 시각마다 달라지므로 다시 계산할 때는 근거 성적과 같은
 * 시각(마감 10분 전)을 결정 시각으로 둔다.
 */
import { Temporal, type Clock } from "@eatbid/domain";
import { Effect } from "effect";

import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { BID_POSITION_RULE } from "../domain/bid-position-rule";
import { KST_TIME_ZONE, kstMonthFirstDayText, shiftKstMonth, type KstMonth } from "../domain/kst-month";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { BidReviewMonthRecord, BidReviewReader } from "./bid-review-reader";
import type { DecideMarketPick } from "./decide-market-pick";
import type { DecideMorningHabitPick } from "./decide-morning-habit-pick";
import { ProcurementDependencyUnavailable } from "./failures";
import { recomputedMorningHabit } from "./review-morning-habit";
import {
  ledgerFor,
  ratioText,
  reviewRound,
  summaryOf,
  type ReviewRoundRecord,
  type ReviewSummaryKey,
  type ReviewSummaryRecord,
} from "./review-round";

export type {
  ReviewMethodValues,
  ReviewOwnVerdict,
  ReviewRoundRecord,
  ReviewSummaryKey,
  ReviewSummaryRecord,
} from "./review-round";

export interface MyBidReviewRecord {
  readonly asOf: Temporal.Instant;
  readonly months: readonly BidReviewMonthRecord[];
  readonly selected: {
    readonly month: string;
    readonly marketPick: {
      readonly version: string;
      readonly window: { readonly fromMonth: string; readonly throughMonth: string };
      readonly ratios: readonly string[] | null;
      readonly marketRounds: number | null;
    };
    readonly nationalRuleVersion: string;
    readonly plannedDistribution: { readonly version: string; readonly sourceRounds: number };
    readonly unplannedRounds: number;
    readonly summaries: readonly ReviewSummaryRecord[];
    readonly rounds: readonly ReviewRoundRecord[];
  } | null;
}

const SUMMARY_ORDER: readonly ReviewSummaryKey[] = ["own", "market-pick", "national-rule", "morning-habit"];

function monthStart(month: string): Temporal.Instant {
  return Temporal.PlainDate.from(kstMonthFirstDayText(month as KstMonth)).toZonedDateTime(KST_TIME_ZONE).toInstant();
}

/**
 * 달 목록·회차·장부는 한 읽기 스냅샷에서 읽는다. 맞춤 다시 계산은 그 달 기준 직전 석 달 창으로 따로 고른다 — 오늘 화면과 같은 결정
 * 코드를 그 달로 돌린 것이다.
 */
export class GetMyBidReview {
  constructor(
    private readonly snapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly reader: BidReviewReader,
    private readonly decideMarketPick: DecideMarketPick,
    private readonly decideMorningHabit: DecideMorningHabitPick,
    private readonly clock: Clock,
  ) {}

  execute(input: { readonly workspaceId: bigint; readonly month: string | null }): Effect.Effect<MyBidReviewRecord, ProcurementDependencyUnavailable> {
    return Effect.tryPromise({
      try: () => this.read(input),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    });
  }

  private async read(input: { readonly workspaceId: bigint; readonly month: string | null }): Promise<MyBidReviewRecord> {
    const asOf = this.clock.now();
    const facts = await this.snapshot.run(async (snapshot) => {
      const businesses = await this.businesses.list(snapshot, input.workspaceId);
      const supplierPartyIds = businesses.flatMap((business) =>
        business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
      const months = await this.reader.listMonths(snapshot, { supplierPartyIds });
      const month = input.month ?? months.at(-1)?.month ?? null;
      if (month === null) return { months, month: null, rounds: [], ledger: [] };
      const rounds = await this.reader.findRounds(snapshot, {
        supplierPartyIds,
        openedFrom: monthStart(month),
        openedBefore: monthStart(shiftKstMonth(month as KstMonth, 1)),
      });
      const ledger = await this.reader.findLedger(snapshot, {
        workspaceId: input.workspaceId,
        auctionAttemptIds: rounds.map((round) => round.auctionAttemptId),
      });
      return { months, month, rounds, ledger };
    });
    if (facts.month === null) return { asOf, months: facts.months, selected: null };
    // 장부에 마감 전 아침 갱신 값이 있는 공고는 다시 고르지 않는다. 두 결정은 서로 기대지 않아 함께 읽는다.
    const [decision, habits] = await Promise.all([
      this.decideMarketPick.decide({ workspaceId: input.workspaceId, month: facts.month as KstMonth }),
      recomputedMorningHabit({
        decide: this.decideMorningHabit,
        workspaceId: input.workspaceId,
        rounds: facts.rounds.filter((round) => ledgerFor(
          facts.ledger.filter((row) => row.auctionAttemptId === round.auctionAttemptId), "morning-habit", round.deadlineAt,
        ) === null),
      }),
    ]);
    const reviewed = facts.rounds.map((round) => reviewRound(round, facts.ledger, decision, habits.get(round.auctionAttemptId) ?? null));
    const rounds = reviewed.filter((round): round is ReviewRoundRecord => round !== null);
    return {
      asOf,
      months: facts.months,
      selected: {
        month: facts.month,
        marketPick: {
          version: decision.method.version,
          window: { fromMonth: decision.window.fromMonth, throughMonth: decision.window.throughMonth },
          ratios: decision.kind === "picked" ? decision.pick.multiples.map(ratioText) : null,
          marketRounds: decision.marketRounds,
        },
        nationalRuleVersion: BID_POSITION_RULE.version,
        plannedDistribution: { version: PLANNED_RATIO_DISTRIBUTION.version, sourceRounds: PLANNED_RATIO_DISTRIBUTION.sourceRounds },
        unplannedRounds: reviewed.length - rounds.length,
        summaries: SUMMARY_ORDER.map((key) => summaryOf(key, rounds)),
        rounds,
      },
    };
  }
}
