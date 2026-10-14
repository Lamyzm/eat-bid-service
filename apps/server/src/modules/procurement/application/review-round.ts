/**
 * @module 책임: 개찰된 공고 하나의 사실과 장부·다시 고른 방법 값으로 복기 한 줄(그날 하한·1등 자리 끝·낙찰, 낸 값과 방법 값의 판정·
 * 기대)을 세우고, 한 달의 줄을 방법별 성적으로 세는 계산을 소유한다. 읽기와 결정 순서는 복기 use case가 가진다.
 *
 * 방법 값의 출처를 섞지 않는다(PDR-0008 결정 7, ADR 0068). 장부에 마감 전에 내보낸 값이 있으면 그것을 쓰고, 없으면 지금 규칙을 그
 * 달 자료에 다시 돌린 값을 "다시 계산"으로 붙인다.
 */
import { bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";

import { BID_POSITION_RULE, positionBids } from "../domain/bid-position-rule";
import {
  baseRelativeRatio,
  bestCompetitorRate,
  classifyRatio,
  classifyRate,
  expectedWins,
  floorRatio,
  rateRatio,
  type ReviewRoundFacts,
  type ReviewVerdict,
} from "../domain/bid-review";
import { MARKET_POSITION_PICK } from "../domain/market-position-pick-table";
import { MORNING_HABIT_PICK } from "../domain/morning-habit-pick-table";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { BidDisplayMethod } from "./bid-display-ledger";
import type { BidReviewLedgerRecord, BidReviewRoundRecord } from "./bid-review-reader";
import type { MarketPickDecision } from "./decide-market-pick";

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
  readonly bestCompetitorRatio: string | null;
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
  readonly allAboveFirst: number;
  readonly expectedWins: number;
  readonly recomputedRounds: number;
}

const MARKET_FLOOR = MARKET_POSITION_PICK.floorRate;

/** 4자리 배수(`0.9849`)도 6자리 눈금(`0.984900`)으로 맞춘다. 판정은 같은 scale에서 한다. */
export const ratioText = (multiple: string) => {
  const [whole, fraction = ""] = multiple.split(".");
  return `${whole}.${fraction.padEnd(6, "0")}`;
};

/** 장부에서 마감 전에 마지막으로 내보낸 값을 고른다. 마감을 모르면 가장 나중 것이다. 마감 뒤에만 내보냈으면 대조하지 않는다. */
export function ledgerFor(
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
  habitRatios: readonly string[] | null,
): ReviewMethodValues[] {
  const methods: ReviewMethodValues[] = [];
  const fromLedger = (method: BidDisplayMethod) => {
    const row = ledgerFor(ledger, method, round.deadlineAt);
    return row === null ? null
      : valuesOf(facts, method, "ledger", row.methodVersion, row.baseRelativeRates.map((rate) => baseRelativeRatio(rate, row.floorRate)));
  };
  const habit = fromLedger("morning-habit")
    ?? (habitRatios === null ? null : valuesOf(facts, "morning-habit", "recomputed", MORNING_HABIT_PICK.version, habitRatios));
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

export function reviewRound(
  round: BidReviewRoundRecord,
  ledger: readonly BidReviewLedgerRecord[],
  decision: MarketPickDecision,
  habitRatios: readonly string[] | null,
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
  const best = bestCompetitorRate(facts);
  return {
    round,
    floorRatio: floorRatio(facts),
    bestCompetitorRatio: best === null ? null : rateRatio(facts, best),
    winner: round.award === null ? null : {
      label: round.award.label,
      ratio: rateRatio(facts, round.award.rate),
      mine: round.own.some((bid) => bid.supplierPartyId === round.award!.supplierPartyId),
    },
    own,
    ownExpectedWins: expectedWins(facts, own.map((bid) => bid.ratio), PLANNED_RATIO_DISTRIBUTION),
    methods: methodsOf(round, facts, ledger.filter((row) => row.auctionAttemptId === round.auctionAttemptId), decision, habitRatios),
  };
}

export function summaryOf(key: ReviewSummaryKey, rounds: readonly ReviewRoundRecord[]): ReviewSummaryRecord {
  let counted = 0;
  let first = 0;
  let allBelowFloor = 0;
  let allAboveFirst = 0;
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
    if (verdicts.every((verdict) => verdict === "above-first")) allAboveFirst += 1;
    if (key === "own") {
      expected += round.ownExpectedWins;
    } else {
      const values = round.methods.find((entry) => entry.method === key)!;
      expected += values.expectedWins;
      if (values.source === "recomputed") recomputed += 1;
    }
  }
  return { method: key, rounds: counted, first, allBelowFloor, allAboveFirst, expectedWins: expected, recomputedRounds: recomputed };
}
