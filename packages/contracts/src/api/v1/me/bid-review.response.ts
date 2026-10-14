/** @module 책임: 내 투찰 복기 한 장의 공개 응답(달 목록과 고른 달의 공고별 사실·방법별 값 대조와 요약)을 소유한다. */
import { z } from "zod";

import { kstMonthTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { canonicalDecimalTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema, reservePriceRatioWireSchema } from "../../../values/rate";

/**
 * 복기의 눈금은 하나다 — 금액 ÷ (기초금액 × 하한율). 화면 사정률은 이 값의 100배이고, 그날 하한(예정가격 ÷ 기초금액)도 같은
 * 눈금에 놓인다. 그래서 우리 값·낸 값·낙찰·하한을 모두 기초금액 대비 배율(`ReservePriceRatio`)로 싣는다.
 */
const reviewRatioSchema = reservePriceRatioWireSchema;

export const bidReviewMethodSchema = z.enum(["market-pick", "national-rule", "morning-habit"]).meta({ id: "BidReviewMethod" });

/**
 * 그날 실제로 뽑힌 예정가격으로 가린 자리다. `first`는 하한 이상이면서 다른 업체의 가장 낮은 유효 투찰보다 낮은 자리다 — 우리가
 * 들어가면 예정가격 추첨이 달라지므로 "낙찰"이 아니라 "자리"다. `above-first`는 그 투찰 이상이라는 뜻이며 실제 낙찰과 견준 것이
 * 아니다(우리가 낙찰했거나 가장 낮은 투찰이 심사에서 빠진 공고는 둘이 다르다).
 */
export const bidReviewVerdictSchema = z.enum(["below-floor", "first", "above-first"]).meta({ id: "BidReviewVerdict" });

/** 실제 낸 값은 낙찰을 따로 가린다. 두 업체가 둘 다 1등 자리면 더 낮은 쪽이 낙찰이고 다른 쪽은 자리로 남는다. */
export const bidReviewOwnVerdictSchema = z.enum(["won", "below-floor", "first", "above-first"]).meta({ id: "BidReviewOwnVerdict" });

export const bidReviewMonthSchema = z.strictObject({
  month: kstMonthTextSchema,
  rounds: nonNegativeCountSchema,
  bids: nonNegativeCountSchema,
  wins: nonNegativeCountSchema,
}).meta({ id: "BidReviewMonth" });

export const bidReviewPositionSchema = z.strictObject({
  ratio: reviewRatioSchema,
  verdict: bidReviewVerdictSchema,
}).meta({ id: "BidReviewPosition" });

/**
 * 한 공고에 대한 한 방법의 1번·2번이다. `ledger`는 그때 화면에 내보낸 값(마감 전 마지막, ADR 0068)이고 `recomputed`는 장부가
 * 없던 때라 지금 규칙을 그 달 자료로 다시 돌린 값이다(PDR-0008 결정 7). 둘을 섞어 부르지 않는다.
 */
export const bidReviewMethodValuesSchema = z.strictObject({
  method: bidReviewMethodSchema,
  source: z.enum(["ledger", "recomputed"]),
  version: z.string().min(1).max(32),
  positions: z.array(bidReviewPositionSchema).min(1).max(2),
  // 예정가격 추첨을 평균한 이 공고의 낙찰 확률 합이다(두 장이면 두 자리 합).
  expectedWins: canonicalDecimalTextSchema,
}).meta({ id: "BidReviewMethodValues" });

export const bidReviewOwnBidSchema = z.strictObject({
  label: z.string().min(1).max(200).nullable(),
  ratio: reviewRatioSchema,
  verdict: bidReviewOwnVerdictSchema,
}).meta({ id: "BidReviewOwnBid" });

export const bidReviewRoundSchema = z.strictObject({
  auctionId: positiveBigintTextSchema,
  openedAt: instantTextSchema,
  displayBidNo: z.string().min(1).max(64).nullable(),
  title: z.string().min(1).max(500).nullable(),
  organizationLabel: z.string().min(1).max(200).nullable(),
  itemLabel: z.string().min(1).max(200).nullable(),
  baseAmount: moneyWireSchema,
  floorRate: bidRateWireSchema,
  bidderCount: nonNegativeCountSchema,
  /** 그날 하한이다 — 예정가격 ÷ 기초금액. 이보다 낮게 넣은 투찰은 무효다. */
  floorRatio: reviewRatioSchema,
  /**
   * 다른 업체의 가장 낮은 유효 투찰이다. 1등 자리는 하한부터 이 값 바로 아래까지이고, 낙찰(`winner`)과 다를 수 있어 따로 싣는다.
   * 다른 업체의 유효 투찰이 없었으면 null이며 그때는 하한 이상이 모두 1등 자리다.
   */
  bestCompetitorRatio: reviewRatioSchema.nullable(),
  /** 유효 투찰이 하나도 없었으면 null이다. */
  winner: z.strictObject({
    label: z.string().min(1).max(200).nullable(),
    ratio: reviewRatioSchema,
    mine: z.boolean(),
  }).nullable(),
  own: z.array(bidReviewOwnBidSchema).min(1),
  ownExpectedWins: canonicalDecimalTextSchema,
  methods: z.array(bidReviewMethodValuesSchema).max(3),
}).meta({ id: "BidReviewRound" });

/** 방법 하나의 한 달 성적이다. `own`은 실제 낸 값이며 `first`에 낙찰을 포함한다. */
export const bidReviewSummarySchema = z.strictObject({
  method: z.enum(["own", "market-pick", "national-rule", "morning-habit"]),
  rounds: nonNegativeCountSchema,
  first: nonNegativeCountSchema,
  allBelowFloor: nonNegativeCountSchema,
  allAboveFirst: nonNegativeCountSchema,
  expectedWins: canonicalDecimalTextSchema,
  recomputedRounds: nonNegativeCountSchema,
}).meta({ id: "BidReviewSummary" });

export const myBidReviewV1ResponseSchema = z.strictObject({
  asOf: instantTextSchema,
  /** 내 사업자가 넣은 공고가 있는 달이다. 오래된 달부터다. */
  months: z.array(bidReviewMonthSchema),
  /** 고른 달이다. 내 사업자가 넣은 공고가 하나도 없으면 null이다. */
  selected: z.strictObject({
    month: kstMonthTextSchema,
    /** 이 달 공고에 다시 계산한 맞춤의 판·창이다. 창 안 공고가 모자라 고르지 못했으면 `ratios`가 null이다. */
    marketPick: z.strictObject({
      version: z.string().min(1).max(32),
      window: z.strictObject({ fromMonth: kstMonthTextSchema, throughMonth: kstMonthTextSchema }),
      ratios: z.array(reviewRatioSchema).min(1).max(2).nullable(),
      marketRounds: nonNegativeCountSchema.nullable(),
    }),
    nationalRuleVersion: z.string().min(1).max(32),
    /** 추첨 평균 기대를 셀 때 적분한 예정가격 분포의 판과 그 분포를 만든 공고 수다. */
    plannedDistribution: z.strictObject({ version: z.string().min(1).max(32), sourceRounds: nonNegativeCountSchema }),
    /** 예정가격이 관측되지 않아 대조하지 못한 공고 수다. 빼고 말하지 않는다. */
    unplannedRounds: nonNegativeCountSchema,
    summaries: z.array(bidReviewSummarySchema),
    rounds: z.array(bidReviewRoundSchema).max(1000),
  }).nullable(),
}).meta({ id: "MyBidReviewV1Response" });

export type MyBidReviewV1Response = z.output<typeof myBidReviewV1ResponseSchema>;
export type BidReviewRoundWire = z.output<typeof bidReviewRoundSchema>;
