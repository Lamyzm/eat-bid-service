/** @module 책임: 추천 투찰가 application record(전국 규칙·내 시장 맞춤·아침 갱신 금액)를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  moneyCodec,
  type AuctionBidPositionV1Response,
  type MorningHabitCellWire,
  type MorningHabitMethodWire,
} from "@eatbid/contracts";
import type { PercentagePoints, Temporal } from "@eatbid/domain";
import { z } from "zod";
import { baseRelativeBidRateWire, bidRateWire, bigintText, instantText } from "../../../../platform/http/wire";
import type { MorningHabitPickResult } from "../../application/decide-morning-habit-pick";
import type { AuctionBidPositionRecord, MarketPickRecord, MorningHabitRecord } from "../../application/find-auction-bid-position";
import type { MorningHabitMethod } from "../../domain/morning-habit-pick-table";
import type { BidPositionResult } from "../../domain/bid-position-rule";
import type { MarketPickPosition } from "../../domain/market-position-pick";

function percentagePointsWire(value: PercentagePoints) {
  return { value, unit: "percentage-points" as const };
}

export function marketPositionWire(position: MarketPickPosition) {
  return {
    order: position.order,
    amount: z.encode(moneyCodec, position.amount),
    baseRelativeRate: baseRelativeBidRateWire(position.baseRelativeRate),
  };
}

function marketPickWire(record: MarketPickRecord): AuctionBidPositionV1Response["marketPick"] {
  const { method, window, result } = record;
  return {
    version: method.version,
    windowMonths: method.windowMonths,
    minimumRounds: method.minimumRounds,
    window: { fromMonth: window.fromMonth, throughMonth: window.throughMonth },
    result: result.state === "not-applicable"
      ? { state: "not-applicable", reasons: [...result.reasons], marketRounds: result.marketRounds }
      : {
        state: "applicable",
        marketRounds: result.marketRounds,
        linkedBusinesses: result.linkedBusinesses,
        positions: result.positions.map(marketPositionWire),
        single: marketPositionWire(result.single),
        evidence: method.evidence.map((entry) => ({ ...entry })),
      },
  };
}

/** 아침 갱신의 방법 판·근거·결정 시각이다. 공고 상세와 오늘 투찰 머리가 같은 변환을 쓴다. */
export function morningHabitMethodWire(method: MorningHabitMethod, decidedAt: Temporal.Instant): MorningHabitMethodWire {
  return {
    version: method.version,
    decidedAt: instantText(decidedAt)!,
    coverageThreshold: { value: method.coverageThreshold.toFixed(6), unit: "ratio" },
    validatedLeadMinutes: method.validatedLeadMinutes,
    evidence: method.evidence.map((entry) => ({ ...entry })),
  };
}

/** 공고 하나의 아침 갱신 결과다. 공고 상세와 오늘 투찰 행이 같은 변환을 쓴다. */
export function morningHabitCellWire(result: MorningHabitPickResult): MorningHabitCellWire {
  if (result.state === "not-applicable") {
    return {
      state: "not-applicable",
      reasons: [...result.reasons],
      coverage: result.coverage === null ? null : { value: result.coverage, unit: "ratio" },
    };
  }
  return {
    state: "applicable",
    coverage: { value: result.coverage, unit: "ratio" },
    regulars: result.regulars,
    sameDayRegulars: result.sameDayRegulars,
    latestSameDayOpenedAt: instantText(result.latestSameDayOpenedAt),
    competitorCount: result.competitorCount,
    positions: result.positions.map(marketPositionWire),
    single: marketPositionWire(result.single),
  };
}

function morningHabitWire(record: MorningHabitRecord): NonNullable<AuctionBidPositionV1Response["morningHabit"]> {
  return { ...morningHabitMethodWire(record.method, record.decidedAt), result: morningHabitCellWire(record.result) };
}

/** 전국 규칙 결과를 공개 형태로 바꾼다. 공고 상세와 오늘 투찰이 같은 변환을 쓴다. */
export function ruleResultWire(result: BidPositionResult): AuctionBidPositionV1Response["result"] {
  return result.state === "not-applicable"
    ? { state: "not-applicable", reasons: [...result.reasons] }
    : {
      state: "applicable",
      band: { minBidCount: result.band.minBidCount, maxBidCount: result.band.maxBidCount },
      bidCountBasis: result.bidCountBasis.kind === "observed"
        ? { kind: "observed", bidCount: result.bidCountBasis.bidCount }
        : {
          kind: "estimated",
          observedBidCount: result.bidCountBasis.observedBidCount,
          hoursBeforeDeadline: result.bidCountBasis.hoursBeforeDeadline,
          estimatedBidCount: result.bidCountBasis.estimatedBidCount,
        },
      evidence: result.evidence,
      selection: result.selection,
      validationRounds: result.validationRounds,
      holdout: result.holdout === null ? null : {
        month: result.holdout.month,
        rounds: result.holdout.rounds,
        tickets: result.holdout.tickets,
        wins: result.holdout.wins,
        lotteryExpectedWins: result.holdout.lotteryExpectedWins,
      },
      positions: result.positions.map((position) => ({
        order: position.order,
        amount: z.encode(moneyCodec, position.amount),
        baseRelativeRate: baseRelativeBidRateWire(position.baseRelativeRate),
        cumulativeWinRate: percentagePointsWire(position.cumulativeWinRate),
        cumulativeLotteryWinRate: percentagePointsWire(position.cumulativeLotteryWinRate),
        cumulativeValidationWins: position.cumulativeValidationWins,
      })),
    };
}

export function toAuctionBidPositionResponse(record: AuctionBidPositionRecord): AuctionBidPositionV1Response {
  return {
    auctionId: bigintText(record.auctionId),
    revisionId: bigintText(record.revisionId),
    baseAmount: z.encode(moneyCodec, record.baseAmount),
    floorRate: bidRateWire(record.floorRate),
    participation: record.participation === null
      ? null
      : { bidCount: record.participation.bidCount, observedAt: instantText(record.participation.observedAt) },
    deadlineAt: instantText(record.deadlineAt),
    rule: {
      version: record.rule.version,
      trainedThrough: record.rule.trainedThrough,
      validatedFrom: record.rule.validatedFrom,
      validatedThrough: record.rule.validatedThrough,
    },
    result: ruleResultWire(record.result),
    marketPick: marketPickWire(record.marketPick),
    // 요청하지 않았으면 key 자체를 싣지 않는다 — 옛 web의 strict 응답 검증이 모르는 key로 응답을 거부하지 않게 한다.
    ...(record.morningHabit === null ? {} : { morningHabit: morningHabitWire(record.morningHabit) }),
  };
}
