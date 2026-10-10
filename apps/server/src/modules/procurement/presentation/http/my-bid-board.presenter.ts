/** @module 책임: 오늘 투찰 application record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type BidBoardMarketPickWire, type BidBoardRowWire, type MyBidBoardV1Response } from "@eatbid/contracts";
import { z } from "zod";

import { bidRateWire, bigintText, instantText } from "../../../../platform/http/wire";
import type { MarketPickDecision } from "../../application/decide-market-pick";
import type { MyBidBoardRecord, MyBidBoardRowRecord } from "../../application/get-my-bid-board";
import { BID_POSITION_RULE } from "../../domain/bid-position-rule";
import { marketPositionWire, ruleResultWire } from "./auction-bid-position.presenter";

function marketPickHeadWire(decision: MarketPickDecision): BidBoardMarketPickWire {
  const { method, window } = decision;
  return {
    version: method.version,
    windowMonths: method.windowMonths,
    minimumRounds: method.minimumRounds,
    window: { fromMonth: window.fromMonth, throughMonth: window.throughMonth },
    state: decision.kind,
    reasons: decision.kind === "not-applicable" ? [...decision.reasons] : [],
    marketRounds: decision.marketRounds,
    linkedBusinesses: decision.kind === "picked" ? decision.linkedBusinesses : 0,
    evidence: method.evidence.map((entry) => ({ ...entry })),
  };
}

function rowWire(row: MyBidBoardRowRecord): BidBoardRowWire {
  const { auction, market } = row;
  return {
    auctionId: bigintText(auction.auctionAttemptId),
    closesAt: instantText(auction.closesAt),
    organizationLabel: auction.organization?.label ?? null,
    title: auction.title,
    itemLabel: auction.itemLabel,
    displayBidNo: auction.displayBidNo,
    baseAmount: auction.baseAmount === null ? null : z.encode(moneyCodec, auction.baseAmount),
    floorRate: bidRateWire(auction.floorRate),
    bidCount: auction.bidCount,
    observedAt: instantText(auction.observedAt),
    rule: row.rule === null ? null : ruleResultWire(row.rule),
    market: market === null
      ? null
      : market.result.state === "not-applicable"
        ? { state: "not-applicable", reasons: [...market.result.reasons] }
        : {
          state: "applicable",
          positions: market.result.positions.map(marketPositionWire),
          single: marketPositionWire(market.result.single),
          spares: market.spares.map((spare) => ({ ...marketPositionWire(spare), order: spare.order })),
        },
  };
}

export function toMyBidBoardResponse(record: MyBidBoardRecord): MyBidBoardV1Response {
  if (record.state === "unconfirmed") {
    return { regionPreference: "unconfirmed", asOf: instantText(record.asOf), rows: [] };
  }
  return {
    regionPreference: "confirmed",
    asOf: instantText(record.asOf),
    closesBeforeDate: record.closesBeforeDate,
    rule: {
      version: BID_POSITION_RULE.version,
      trainedThrough: BID_POSITION_RULE.trainedThrough,
      validatedFrom: BID_POSITION_RULE.validatedFrom,
      validatedThrough: BID_POSITION_RULE.validatedThrough,
    },
    marketPick: marketPickHeadWire(record.decision),
    rows: record.rows.map(rowWire),
    truncated: record.truncated,
  };
}
