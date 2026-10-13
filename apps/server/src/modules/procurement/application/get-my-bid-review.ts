/**
 * @module 책임: 요청자 워크스페이스의 내 사업자가 넣은 공고를 달마다 모으고, 고른 달의 공고마다 그날 하한·낙찰·낸 값과 방법별 추천
 * 값(장부, 없으면 다시 계산)을 대조해 요약하는 복기 use case와 그 record를 소유한다.
 *
 * 방법 값의 출처를 섞지 않는다(PDR-0008 결정 7, ADR 0068). 장부에 마감 전에 내보낸 값이 있으면 그것을 쓰고, 없으면 지금 규칙을 그
 * 달 자료에 다시 돌린 값을 "다시 계산"으로 붙인다. 아침 갱신은 화면을 연 시각마다 달라 다시 계산하지 않는다.
 */
import { bidRate, canonicalDecimal, krw, Temporal, type Clock } from "@eatbid/domain";
import { Effect } from "effect";

import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { BID_POSITION_RULE, positionBids } from "../domain/bid-position-rule";
import {
  baseRelativeRatio,
  classifyRatio,
  classifyRate,
  expectedWins,
  floorRatio,
  rateRatio,
  type ReviewRoundFacts,
  type ReviewVerdict,
} from "../domain/bid-review";
import { KST_TIME_ZONE, kstMonthFirstDayText, shiftKstMonth, type KstMonth } from "../domain/kst-month";
import { MARKET_POSITION_PICK } from "../domain/market-position-pick-table";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { BidDisplayMethod } from "./bid-display-ledger";
import type { BidReviewLedgerRecord, BidReviewMonthRecord, BidReviewReader, BidReviewRoundRecord } from "./bid-review-reader";
import type { DecideMarketPick, MarketPickDecision } from "./decide-market-pick";
import { ProcurementDependencyUnavailable } from "./failures";

export type ReviewOwnVerdict = ReviewVerdict | "won";

export interface ReviewMethodValues {
  readonly method: BidDisplayMethod;
  readonly source: "ledger" | "recomputed";
  readonly version: string;
  readonly positions: readonly { readonly ratio: string; readonly verdict: ReviewVerdict }[];
  readonly expectedWins: number;
}

export interface ReviewRoundRecord {
  readonly round: BidReviewRoundRecord;
  readonly floorRatio: string;
  readonly winner: { readonly label: string | null; readonly ratio: string; readonly mine: boolean } | null;
  readonly own: readonly { readonly label: string | null; readonly ratio: string; readonly verdict: ReviewOwnVerdict }[];
  readonly ownExpectedWins: number;
  readonly methods: readonly ReviewMethodValues[];
}

export type ReviewSummaryKey = "own" | BidDisplayMethod;

export interface ReviewSummaryRecord {
  readonly method: ReviewSummaryKey;
  readonly rounds: number;
  readonly first: number;
  readonly allBelowFloor: number;
  readonly allAboveWinner: number;
  readonly expectedWins: number;
  readonly recomputedRounds: number;
}

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
    readonly unplannedRounds: number;
    readonly summaries: readonly ReviewSummaryRecord[];
    readonly rounds: readonly ReviewRoundRecord[];
  } | null;
}

const MARKET_FLOOR = MARKET_POSITION_PICK.floorRate;
const SUMMARY_ORDER: readonly ReviewSummaryKey[] = ["own", "market-pick", "national-rule", "morning-habit"];

function monthStart(month: string): Temporal.Instant {
  return Temporal.PlainDate.from(kstMonthFirstDayText(month as KstMonth)).toZonedDateTime(KST_TIME_ZONE).toInstant();
}

/** 4자리 배수(`0.9849`)도 6자리 눈금(`0.984900`)으로 맞춘다. 판정은 같은 scale에서 한다. */
const ratioText = (multiple: string) => {
  const [whole, fraction = ""] = multiple.split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
};

/** 장부에서 마감 전에 마지막으로 내보낸 값을 고른다. 마감을 모르면 가장 나중 것이다. 마감 뒤에만 내보냈으면 대조하지 않는다. */
function ledgerFor(
  rows: readonly BidReviewLedgerRecord[],
  method: BidDisplayMethod,
  deadlineAt: Temporal.Instant | null,
): BidReviewLedgerRecord | null {
  let chosen: BidReviewLedgerRecord | null = null;
  for (const row of rows) {
    if (row.method !== method) continue;
    if (deadlineAt !== null && Temporal.Instant.compare(row.firstServedAt, deadlineAt) > 0) continue;
    if (chosen === null || Temporal.Instant.compare(row.firstServedAt, chosen.firstServedAt) >= 0) chosen = row;
  }
  return chosen;
}

function valuesOf(
  facts: ReviewRoundFacts,
  method: BidDisplayMethod,
  source: "ledger" | "recomputed",
  version: string,
  ratios: readonly string[],
): ReviewMethodValues {
  return {
    method,
    source,
    version,
    positions: ratios.map((ratio) => ({ ratio, verdict: classifyRatio(facts, ratio) })),
    expectedWins: expectedWins(facts, ratios, PLANNED_RATIO_DISTRIBUTION),
  };
}

function methodsOf(
  round: BidReviewRoundRecord,
  facts: ReviewRoundFacts,
  ledger: readonly BidReviewLedgerRecord[],
  decision: MarketPickDecision,
): ReviewMethodValues[] {
  const methods: ReviewMethodValues[] = [];
  const fromLedger = (method: BidDisplayMethod) => {
    const row = ledgerFor(ledger, method, round.deadlineAt);
    return row === null ? null
      : valuesOf(facts, method, "ledger", row.methodVersion, row.baseRelativeRates.map((rate) => baseRelativeRatio(rate, row.floorRate)));
  };
  const habit = fromLedger("morning-habit");
  if (habit !== null) methods.push(habit);
  const market = fromLedger("market-pick")
    ?? (round.floorRate === MARKET_FLOOR && decision.kind === "picked"
      ? valuesOf(facts, "market-pick", "recomputed", decision.method.version, decision.pick.multiples.map(ratioText))
      : null);
  if (market !== null) methods.push(market);
  const rule = fromLedger("national-rule") ?? recomputedRule(round, facts);
  if (rule !== null) methods.push(rule);
  return methods;
}

/** 장부 이전의 전국 공식은 최종 명단 수로 대역을 고른다 — 그때 화면이 본 참여 수는 남아 있지 않다. */
function recomputedRule(round: BidReviewRoundRecord, facts: ReviewRoundFacts): ReviewMethodValues | null {
  const observedAt = round.deadlineAt ?? round.openedAt;
  const result = positionBids({
    baseAmount: krw(canonicalDecimal(round.baseAmount, 2)),
    floorRate: bidRate(canonicalDecimal(round.floorRate, 3)),
    participation: { bidCount: round.bidderCount, observedAt },
    deadlineAt: observedAt,
  });
  if (result.state !== "applicable") return null;
  const ratios = result.positions.slice(0, 2).map((position) => baseRelativeRatio(position.baseRelativeRate, round.floorRate));
  return ratios.length === 0 ? null : valuesOf(facts, "national-rule", "recomputed", BID_POSITION_RULE.version, ratios);
}

function reviewRound(
  round: BidReviewRoundRecord,
  ledger: readonly BidReviewLedgerRecord[],
  decision: MarketPickDecision,
): ReviewRoundRecord | null {
  if (round.plannedAmount === null) return null;
  const facts: ReviewRoundFacts = {
    baseAmount: round.baseAmount,
    plannedAmount: round.plannedAmount,
    floorRate: round.floorRate,
    competitorRates: round.competitorRates,
  };
  const winnerParty = round.award?.supplierPartyId ?? null;
  const own = round.own.map((bid) => {
    const verdict: ReviewOwnVerdict = winnerParty !== null && bid.supplierPartyId === winnerParty ? "won" : classifyRate(facts, bid.rate);
    return { label: bid.label, ratio: rateRatio(facts, bid.rate), verdict };
  });
  return {
    round,
    floorRatio: floorRatio(facts),
    winner: round.award === null ? null : {
      label: round.award.label,
      ratio: rateRatio(facts, round.award.rate),
      mine: round.own.some((bid) => bid.supplierPartyId === round.award!.supplierPartyId),
    },
    own,
    ownExpectedWins: expectedWins(facts, own.map((bid) => bid.ratio), PLANNED_RATIO_DISTRIBUTION),
    methods: methodsOf(round, facts, ledger.filter((row) => row.auctionAttemptId === round.auctionAttemptId), decision),
  };
}

function summaryOf(key: ReviewSummaryKey, rounds: readonly ReviewRoundRecord[]): ReviewSummaryRecord {
  let counted = 0;
  let first = 0;
  let allBelowFloor = 0;
  let allAboveWinner = 0;
  let expected = 0;
  let recomputed = 0;
  for (const round of rounds) {
    const verdicts: readonly string[] = key === "own"
      ? round.own.map((bid) => bid.verdict)
      : round.methods.find((values) => values.method === key)?.positions.map((position) => position.verdict) ?? [];
    if (verdicts.length === 0) continue;
    counted += 1;
    if (verdicts.some((verdict) => verdict === "first" || verdict === "won")) first += 1;
    if (verdicts.every((verdict) => verdict === "below-floor")) allBelowFloor += 1;
    if (verdicts.every((verdict) => verdict === "above-winner")) allAboveWinner += 1;
    if (key === "own") {
      expected += round.ownExpectedWins;
    } else {
      const values = round.methods.find((entry) => entry.method === key)!;
      expected += values.expectedWins;
      if (values.source === "recomputed") recomputed += 1;
    }
  }
  return { method: key, rounds: counted, first, allBelowFloor, allAboveWinner, expectedWins: expected, recomputedRounds: recomputed };
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
    const decision = await this.decideMarketPick.decide({ workspaceId: input.workspaceId, month: facts.month as KstMonth });
    const reviewed = facts.rounds.map((round) => reviewRound(round, facts.ledger, decision));
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
        unplannedRounds: reviewed.length - rounds.length,
        summaries: SUMMARY_ORDER.map((key) => summaryOf(key, rounds)),
        rounds,
      },
    };
  }
}
