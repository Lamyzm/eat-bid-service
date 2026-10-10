/** @module 책임: 추천 투찰가 application record(전국 규칙과 내 시장 맞춤 금액)를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type AuctionBidPositionV1Response } from "@eatbid/contracts";
import type { PercentagePoints } from "@eatbid/domain";
import { z } from "zod";
import { baseRelativeBidRateWire, bidRateWire, bigintText, instantText } from "../../../../platform/http/wire";
import type { AuctionBidPositionRecord, MarketPickRecord } from "../../application/find-auction-bid-position";
import type { MarketPickPosition } from "../../domain/market-position-pick";

function percentagePointsWire(value: PercentagePoints) {
  return { value, unit: "percentage-points" as const };
}

function marketPositionWire(position: MarketPickPosition) {
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

export function toAuctionBidPositionResponse(record: AuctionBidPositionRecord): AuctionBidPositionV1Response {
  const { result } = record;
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
    result: result.state === "not-applicable"
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
      },
    marketPick: marketPickWire(record.marketPick),
  };
}
