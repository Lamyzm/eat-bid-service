import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { createUnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessRecord } from "../../account/application/account-repository";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { MORNING_HABIT_FIXTURE as FIXTURE } from "../domain/__fixtures__/morning-habit";
import { baseRelativeRatio } from "../domain/bid-review";
import { floorRelativeRatio, positionsOf } from "../domain/market-position-pick";
import { MORNING_HABIT_PICK } from "../domain/morning-habit-pick-table";
import type { BidReviewRoundRecord } from "./bid-review-reader";
import { DecideMorningHabitPick } from "./decide-morning-habit-pick";
import type { HabitWindow, MorningHabitReader } from "./morning-habit-reader";
import { recomputedMorningHabit } from "./review-morning-habit";

const instant = (minute: number) => Temporal.Instant.fromEpochMilliseconds((FIXTURE.startEpochSeconds + minute * 60) * 1000);
const ratioOf = (value: number) => floorRelativeRatio(canonicalDecimal(value.toFixed(8), 8));
const within = (at: Temporal.Instant, window: HabitWindow) =>
  Temporal.Instant.compare(at, window.openedFrom) >= 0 && Temporal.Instant.compare(at, window.openedBefore) < 0;

function reader(asked: { market: number; firms: number }): MorningHabitReader {
  return {
    findMarketRounds: async (_snapshot, query) => {
      asked.market += 1;
      return FIXTURE.market
        .map(([opened, deadline, firms, ratios]) => ({
          openedAt: instant(opened),
          deadlineAt: instant(deadline),
          bids: firms.map((firm, index) => ({ supplierPartyId: BigInt(firm), ratio: ratioOf(ratios[index]!) })),
        }))
        .filter((round) => within(round.openedAt, query));
    },
    findFirmBids: async (_snapshot, query) => {
      asked.firms += 1;
      return Object.entries(FIXTURE.histories)
        .flatMap(([firm, bids]) => bids.map(([opened, deadline, ratio]) => ({
          supplierPartyId: BigInt(firm), openedAt: instant(opened), deadlineAt: instant(deadline), ratio: ratioOf(ratio),
        })))
        .filter((bid) => within(bid.openedAt, query) && query.supplierPartyIds.includes(bid.supplierPartyId));
    },
  };
}

const linked = (supplierPartyId: bigint): RegisteredBusinessRecord => ({
  registeredBusinessId: supplierPartyId,
  businessNumber: "1234567890",
  registeredAt: Temporal.Instant.from("2026-01-02T00:00:00Z"),
  supplier: { kind: "linked", supplierPartyId },
  location: null,
});

function decider(asked: { market: number; firms: number }) {
  const snapshot = createUnitOfWork({ transaction: (work) => work({ execute: async () => [] }) });
  const registered: RegisteredBusinessReader = { find: async () => ({ kind: "not-found" }), list: async () => [linked(1n), linked(2n)] };
  // 화면의 "지금"은 쓰지 않는다 — 복기는 공고마다 마감 10분 전을 결정 시각으로 넘긴다.
  return new DecideMorningHabitPick(snapshot, registered, reader(asked), fixedClock(Temporal.Instant.from("2030-01-01T00:00:00Z")));
}

function round(id: bigint, overrides: Partial<BidReviewRoundRecord>): BidReviewRoundRecord {
  return {
    auctionAttemptId: id,
    openedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    deadlineAt: null,
    displayBidNo: null,
    title: null,
    organizationLabel: null,
    itemLabel: null,
    baseAmount: "10000000.00",
    plannedAmount: "9900000.00",
    floorRate: "90.000",
    bidderCount: 7,
    competitorRates: [],
    own: [],
    award: null,
    ...overrides,
  };
}

describe("복기 아침 갱신 다시 고르기", () => {
  test("하한율 90% 공고를 마감 10분 전 결정으로 분석 엔진과 같은 두 자리로 다시 고르고, 그때 켜지지 않은 공고는 비운다", async () => {
    const asked = { market: 0, firms: 0 };
    const rounds = FIXTURE.expected.map((entry, index) =>
      round(BigInt(index + 1), { deadlineAt: instant(entry.deadlineMinute), bidderCount: entry.competitorCount }));
    const picks = await recomputedMorningHabit({ decide: decider(asked), workspaceId: 4n, rounds });
    const ninety = bidRate(canonicalDecimal("90.000", 3));
    const tenMillion = krw(canonicalDecimal("10000000.00", 2));
    for (const [index, entry] of FIXTURE.expected.entries()) {
      const expected = entry.coverage >= MORNING_HABIT_PICK.coverageThreshold
        ? positionsOf(tenMillion, ninety, entry.pair).map((position) => baseRelativeRatio(position.baseRelativeRate, "90.000"))
        : undefined;
      expect(picks.get(BigInt(index + 1))).toEqual(expected);
    }
    // 마감 시각이 다섯이라도 시장·이력은 한 번씩만 읽는다.
    expect(asked).toEqual({ market: 1, firms: 1 });
  });

  test("하한율이 다르거나 마감·예정가격을 모르는 공고는 고르러 가지 않는다", async () => {
    const asked = { market: 0, firms: 0 };
    const deadlineAt = instant(FIXTURE.expected[2]!.deadlineMinute);
    const picks = await recomputedMorningHabit({
      decide: decider(asked),
      workspaceId: 4n,
      rounds: [
        round(1n, { deadlineAt, floorRate: "88.000" }),
        round(2n, { deadlineAt: null }),
        round(3n, { deadlineAt, plannedAmount: null }),
      ],
    });
    expect(picks.size).toBe(0);
    expect(asked).toEqual({ market: 0, firms: 0 });
  });
});
