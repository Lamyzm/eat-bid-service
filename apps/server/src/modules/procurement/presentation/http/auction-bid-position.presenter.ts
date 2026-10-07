/** @module 책임: 추천 투찰가 application record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type AuctionBidPositionV1Response } from "@eatbid/contracts";
import type { PercentagePoints } from "@eatbid/domain";
import { z } from "zod";
import { baseRelativeBidRateWire, bidRateWire, bigintText, instantText } from "../../../../platform/http/wire";
import type { AuctionBidPositionRecord } from "../../application/find-auction-bid-position";

function percentagePointsWire(value: PercentagePoints) {
  return { value, unit: "percentage-points" as const };
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
      ? { state: "not-applicable", reason: result.reason }
      : {
        state: "applicable",
        band: result.band,
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
  };
}
