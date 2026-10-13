import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import { createUnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessRecord } from "../../account/application/account-repository";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { auctionId } from "../domain/auction-id";
import { MARKET_PICK_FIXTURE } from "../domain/__fixtures__/market-position-pick";
import { floorRelativeRatio, type MarketRound } from "../domain/market-position-pick";
import type { AuctionRecord } from "./auction-reader";
import { DecideMorningHabitPick } from "./decide-morning-habit-pick";
import type { MorningHabitReader } from "./morning-habit-reader";
import { DecideMarketPick } from "./decide-market-pick";
import { FindAuctionBidPosition } from "./find-auction-bid-position";
import { NO_BID_DISPLAY_LEDGER, type BidDisplayLedger } from "./bid-display-ledger";
import type { MarketRoundQuery, MarketRoundReader } from "./market-round-reader";

const auction: AuctionRecord = {
  auctionId: auctionId(5_800_123n),
  revisionId: 9n,
  title: "김해 육류",
  status: "OPEN",
  displayBidNumber: null,
  announcedAt: Temporal.Instant.from("2026-10-08T00:00:00Z"),
  deadlineAt: Temporal.Instant.from("2026-10-13T01:00:00Z"),
  openedAt: null,
  baseAmount: krw(canonicalDecimal("10000000.00", 2)),
  plannedAmount: null,
  organization: null,
  terms: { floorRate: bidRate(canonicalDecimal("90.000", 3)), awardMethod: null },
  location: null,
  classification: null,
  participation: { latest: { bidCount: 52, observedAt: Temporal.Instant.from("2026-10-13T00:00:00Z") }, dayEarlier: null },
  latestObservation: { state: "reflected" },
  provenance: { sourceSystem: "eat", externalBidId: "5800123", observationId: 1n, normalizedRecordId: 2n, contentSha256: "a".repeat(64) },
};

function business(supplierPartyId: bigint | null): RegisteredBusinessRecord {
  return {
    registeredBusinessId: supplierPartyId ?? 99n,
    businessNumber: "1234567890",
    registeredAt: Temporal.Instant.from("2026-10-10T02:25:00Z"),
    supplier: supplierPartyId === null ? { kind: "unobserved" } : { kind: "linked", supplierPartyId },
    location: null,
  };
}

/** 고정 예제 24건을 세 번 이어 붙여 최소 공고 수(70)를 넘긴다. 같은 배치를 반복하므로 고르는 배수는 예제 정답과 같다. */
const rounds: MarketRound[] = [0, 1, 2].flatMap(() => MARKET_PICK_FIXTURE.rounds.map((ratios) => ({
  competitorRatios: ratios.map((ratio) => floorRelativeRatio(canonicalDecimal(ratio, 8))),
})));

function useCase(options: {
  readonly businesses: readonly RegisteredBusinessRecord[];
  readonly market?: MarketRoundReader;
  readonly floor?: string;
  readonly asked?: MarketRoundQuery[];
  readonly habit?: MorningHabitReader;
  readonly ledger?: BidDisplayLedger;
}) {
  const snapshot = createUnitOfWork({ transaction: (work) => work({ execute: async () => [] }) });
  const reader: RegisteredBusinessReader = {
    find: async () => ({ kind: "not-found" }),
    list: async () => options.businesses,
  };
  const market: MarketRoundReader = options.market ?? {
    findRounds: async (_snapshot, query) => { options.asked?.push(query); return rounds; },
  };
  const record: AuctionRecord = options.floor === undefined ? auction : {
    ...auction, terms: { floorRate: bidRate(canonicalDecimal(options.floor, 3)), awardMethod: null },
  };
  const clock = fixedClock(Temporal.Instant.from("2026-10-12T03:00:00Z"));
  const habitReader: MorningHabitReader = options.habit ?? { findMarketRounds: async () => [], findFirmBids: async () => [] };
  return new FindAuctionBidPosition(
    { findById: async () => record },
    new DecideMarketPick(snapshot, reader, market, clock),
    new DecideMorningHabitPick(snapshot, reader, habitReader, clock),
    clock,
    options.ledger ?? NO_BID_DISPLAY_LEDGER,
  );
}

const run = (target: FindAuctionBidPosition, includeMorningHabit = false) =>
  new EffectRunner().run(target.execute({ auctionId: auction.auctionId, workspaceId: 4n, includeMorningHabit }));

describe("내 시장 맞춤 금액 use case", () => {
  test("등록 사업자가 둘이면 두 장 금액과 한 장 금액을 따로 고르고, 창은 직전 3개월 KST 달이다", async () => {
    const asked: MarketRoundQuery[] = [];
    const result = await run(useCase({ businesses: [business(101n), business(102n)], asked }));
    expect(result.marketPick.window).toEqual({ fromMonth: "2026-07", throughMonth: "2026-09" });
    expect(asked[0]?.supplierPartyIds).toEqual([101n, 102n]);
    expect(asked[0]?.openedFrom.toString()).toBe("2026-06-30T15:00:00Z");
    expect(asked[0]?.openedBefore.toString()).toBe("2026-09-30T15:00:00Z");
    const pick = result.marketPick.result;
    if (pick.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(pick.marketRounds).toBe(72);
    // 고정 예제 정답 두 장 0.9934·0.9960, 한 장 0.9936 → 10,000,000 × 0.9 × 배수
    expect(pick.positions.map((position) => position.amount.amount)).toEqual(["8940600.00", "8964000.00"]);
    expect(pick.single.amount.amount).toBe("8942400.00");
    // 전국 규칙은 그대로 함께 낸다.
    expect(result.result.state).toBe("applicable");
  });

  test("등록 사업자가 하나면 한 장 금액만 낸다", async () => {
    const result = await run(useCase({ businesses: [business(101n), business(null)] }));
    const pick = result.marketPick.result;
    if (pick.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(pick.linkedBusinesses).toBe(1);
    expect(pick.positions).toHaveLength(1);
    expect(pick.positions[0]!.amount.amount).toBe(pick.single.amount.amount);
  });

  test("원본에서 관측된 등록 사업자가 없거나 하한율이 90이 아니면 시장을 읽지 않고 이유를 낸다", async () => {
    const asked: MarketRoundQuery[] = [];
    const none = await run(useCase({ businesses: [business(null)], asked }));
    expect(none.marketPick.result).toEqual({ state: "not-applicable", reasons: ["no-linked-business"], marketRounds: null });
    const floor88 = await run(useCase({ businesses: [business(101n)], floor: "88.000", asked }));
    expect(floor88.marketPick.result).toEqual({ state: "not-applicable", reasons: ["floor-rate-outside-market-pick"], marketRounds: null });
    expect(asked).toHaveLength(0);
  });

  test("창 안 공고가 최소 공고 수보다 적으면 금액 대신 공고 수와 이유를 낸다", async () => {
    const few: MarketRoundReader = { findRounds: async () => rounds.slice(0, 69) };
    const result = await run(useCase({ businesses: [business(101n), business(102n)], market: few }));
    expect(result.marketPick.result).toEqual({ state: "not-applicable", reasons: ["market-rounds-below-minimum"], marketRounds: 69 });
  });

  test("시장 조회가 실패해도 전국 규칙은 그대로 내고 맞춤 금액만 계산하지 못했다고 한다", async () => {
    const broken: MarketRoundReader = { findRounds: async () => { throw new Error("private connection failure"); } };
    const result = await run(useCase({ businesses: [business(101n), business(102n)], market: broken }));
    expect(result.marketPick.result).toEqual({ state: "not-applicable", reasons: ["market-data-unavailable"], marketRounds: null });
    expect(result.result.state).toBe("applicable");
  });
});

describe("공고 상세 아침 갱신 use case", () => {
  test("요청하지 않으면 아침 갱신 시장을 읽지 않고 그 칸을 비운다", async () => {
    let read = 0;
    const habit: MorningHabitReader = { findMarketRounds: async () => { read += 1; return []; }, findFirmBids: async () => [] };
    const record = await run(useCase({ businesses: [business(101n)], habit }));
    expect(record.morningHabit).toBeNull();
    expect(read).toBe(0);
  });

  test("요청하면 결정 시각과 방법 판을 함께 싣고, 시장 공고가 모자라면 그 이유로 닫는다", async () => {
    const record = await run(useCase({ businesses: [business(101n)] }), true);
    expect(record.morningHabit?.decidedAt.toString()).toBe("2026-10-12T03:00:00Z");
    expect(record.morningHabit?.method.version).toBe("2026-10-11");
    expect(record.morningHabit?.result).toEqual({ state: "not-applicable", reasons: ["market-rounds-below-minimum"], coverage: null });
  });
});

describe("공고 상세 화면 장부", () => {
  test("상세가 내보낸 맞춤·전국 공식 금액을 공고 번호와 함께 장부에 남기고, 88% 공고는 전국 공식만 남긴다", async () => {
    const recorded: Parameters<BidDisplayLedger["record"]>[0][] = [];
    const ledger: BidDisplayLedger = { record: async (input) => { recorded.push(input); } };
    await run(useCase({ businesses: [business(101n), business(102n)], ledger }));
    await run(useCase({ businesses: [business(101n), business(102n)], floor: "88.000", ledger }));
    const [ninety, eightyEight] = recorded;
    expect(ninety!.workspaceId).toBe(4n);
    expect(ninety!.servedAt.toString()).toBe("2026-10-12T03:00:00Z");
    expect(ninety!.entries.map((entry) => [entry.auctionAttemptId, entry.method])).toEqual([
      [auction.auctionId, "market-pick"],
      [auction.auctionId, "national-rule"],
    ]);
    expect(eightyEight!.entries.map((entry) => entry.method)).toEqual(["national-rule"]);
    expect(eightyEight!.entries[0]!.floorRate).toBe("88.000");
  });
});
