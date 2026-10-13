/** @module 책임: 복기 record를 공개 응답 wire로 옮긴다. 비율은 복기 눈금 하나(기초금액 대비 배율)로, 기대 낙찰은 소수 넷째 자리로 싣는다. */
import type { MyBidReviewV1Response } from "@eatbid/contracts";

import { bigintText, instantText } from "../../../../platform/http/wire";
import type { MyBidReviewRecord, ReviewRoundRecord } from "../../application/get-my-bid-review";

type Selected = NonNullable<MyBidReviewV1Response["selected"]>;

const ratio = (value: string) => ({ value, unit: "ratio" as const });
const decimal = (value: number) => value.toFixed(4);

function roundWire(record: ReviewRoundRecord): Selected["rounds"][number] {
  const { round } = record;
  return {
    auctionId: bigintText(round.auctionAttemptId),
    openedAt: instantText(round.openedAt),
    displayBidNo: round.displayBidNo,
    title: round.title,
    organizationLabel: round.organizationLabel,
    itemLabel: round.itemLabel,
    baseAmount: { amount: round.baseAmount, currency: "KRW" },
    floorRate: { value: round.floorRate, unit: "percentage-points" },
    bidderCount: round.bidderCount,
    floorRatio: ratio(record.floorRatio),
    winner: record.winner === null ? null : { label: record.winner.label, ratio: ratio(record.winner.ratio), mine: record.winner.mine },
    own: record.own.map((bid) => ({ label: bid.label, ratio: ratio(bid.ratio), verdict: bid.verdict })),
    ownExpectedWins: decimal(record.ownExpectedWins),
    methods: record.methods.map((values) => ({
      method: values.method,
      source: values.source,
      version: values.version,
      positions: values.positions.map((position) => ({ ratio: ratio(position.ratio), verdict: position.verdict })),
      expectedWins: decimal(values.expectedWins),
    })),
  };
}

export function toMyBidReviewResponse(record: MyBidReviewRecord): MyBidReviewV1Response {
  const { selected } = record;
  return {
    asOf: instantText(record.asOf),
    months: record.months.map((month) => ({ ...month })),
    selected: selected === null ? null : {
      month: selected.month,
      marketPick: {
        version: selected.marketPick.version,
        window: { ...selected.marketPick.window },
        ratios: selected.marketPick.ratios === null ? null : selected.marketPick.ratios.map(ratio),
        marketRounds: selected.marketPick.marketRounds,
      },
      nationalRuleVersion: selected.nationalRuleVersion,
      unplannedRounds: selected.unplannedRounds,
      summaries: selected.summaries.map((summary) => ({ ...summary, expectedWins: summary.expectedWins.toFixed(1) })),
      rounds: selected.rounds.map(roundWire),
    },
  };
}
