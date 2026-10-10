import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { createUnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessRecord } from "../../account/application/account-repository";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { MARKET_PICK_FIXTURE } from "../domain/__fixtures__/market-position-pick";
import { floorRelativeRatio, type MarketRound } from "../domain/market-position-pick";
import { DecideMarketPick, marketPickFor } from "./decide-market-pick";
import type { MarketRoundQuery, MarketRoundReader } from "./market-round-reader";

function business(supplierPartyId: bigint | null): RegisteredBusinessRecord {
  return {
    registeredBusinessId: supplierPartyId ?? 99n,
    businessNumber: "1234567890",
    registeredAt: Temporal.Instant.from("2026-10-10T02:25:00Z"),
    supplier: supplierPartyId === null ? { kind: "unobserved" } : { kind: "linked", supplierPartyId },
    location: null,
  };
}

/** 고정 예제 24건을 세 번 이어 붙여 최소 공고 수(70)를 넘긴다. */
const rounds: MarketRound[] = [0, 1, 2].flatMap(() => MARKET_PICK_FIXTURE.rounds.map((ratios) => ({
  competitorRatios: ratios.map((ratio) => floorRelativeRatio(canonicalDecimal(ratio, 8))),
})));

function decider(options: {
  readonly businesses: readonly RegisteredBusinessRecord[];
  readonly market?: MarketRoundReader;
  readonly asked?: MarketRoundQuery[];
}) {
  const snapshot = createUnitOfWork({ transaction: (work) => work({ execute: async () => [] }) });
  const reader: RegisteredBusinessReader = { find: async () => ({ kind: "not-found" }), list: async () => options.businesses };
  const market: MarketRoundReader = options.market ?? {
    findRounds: async (_snapshot, query) => { options.asked?.push(query); return rounds; },
  };
  return new DecideMarketPick(snapshot, reader, market, fixedClock(Temporal.Instant.from("2026-10-12T03:00:00Z")));
}

const ninety = bidRate(canonicalDecimal("90.000", 3));
const tenMillion = krw(canonicalDecimal("10000000.00", 2));

describe("이번 달 맞춤 배수 결정", () => {
  test("등록 사업자가 둘이면 두 장·한 장 배수와 예비 셋을 고르고 창은 직전 3개월 KST 달이다", async () => {
    const asked: MarketRoundQuery[] = [];
    const decision = await decider({ businesses: [business(101n), business(102n)], asked }).decide({ workspaceId: 4n });
    if (decision.kind !== "picked") throw new Error("골라야 한다");
    expect(decision.window).toEqual({ fromMonth: "2026-07", throughMonth: "2026-09", currentMonth: "2026-10" });
    expect(asked[0]?.openedFrom.toString()).toBe("2026-06-30T15:00:00Z");
    expect(asked[0]?.openedBefore.toString()).toBe("2026-09-30T15:00:00Z");
    expect(decision.pick.multiples).toEqual(["0.9934", "0.9960"]);
    expect(decision.single.multiples).toEqual(["0.9936"]);
    expect(decision.spares).toHaveLength(3);
    expect(decision.marketRounds).toBe(72);
    expect(decision.linkedBusinesses).toBe(2);
  });

  test("배수는 한 번 고르고 공고마다 금액만 바꾼다 — 하한율 88 공고는 맞춤 밖이다", async () => {
    const decision = await decider({ businesses: [business(101n), business(102n)] }).decide({ workspaceId: 4n });
    const applied = marketPickFor(decision, { baseAmount: tenMillion, floorRate: ninety });
    if (applied.state !== "applicable") throw new Error("적용 대상이어야 한다");
    expect(applied.positions.map((position) => position.amount.amount)).toEqual(["8940600.00", "8964000.00"]);
    expect(applied.single.amount.amount).toBe("8942400.00");
    expect(marketPickFor(decision, { baseAmount: tenMillion, floorRate: bidRate(canonicalDecimal("88.000", 3)) }))
      .toEqual({ state: "not-applicable", reasons: ["floor-rate-outside-market-pick"], marketRounds: null });
    expect(marketPickFor(decision, { baseAmount: tenMillion, floorRate: null }))
      .toEqual({ state: "not-applicable", reasons: ["floor-rate-unobserved"], marketRounds: null });
  });

  test("등록 사업자가 하나면 두 장 대신 한 장 배수를 1번으로 쓴다", async () => {
    const decision = await decider({ businesses: [business(101n), business(null)] }).decide({ workspaceId: 4n });
    if (decision.kind !== "picked") throw new Error("골라야 한다");
    expect(decision.pick.multiples).toEqual(decision.single.multiples);
    expect(decision.linkedBusinesses).toBe(1);
  });

  test("관측된 등록 사업자가 없으면 시장을 읽지 않고, 창 공고가 70건 미만이면 공고 수와 함께 닫는다", async () => {
    const asked: MarketRoundQuery[] = [];
    const none = await decider({ businesses: [business(null)], asked }).decide({ workspaceId: 4n });
    expect(none).toMatchObject({ kind: "not-applicable", reasons: ["no-linked-business"], marketRounds: null });
    expect(asked).toHaveLength(0);
    const few = await decider({ businesses: [business(101n)], market: { findRounds: async () => rounds.slice(0, 69) } })
      .decide({ workspaceId: 4n });
    expect(few).toMatchObject({ kind: "not-applicable", reasons: ["market-rounds-below-minimum"], marketRounds: 69 });
    expect(marketPickFor(few, { baseAmount: tenMillion, floorRate: ninety }))
      .toEqual({ state: "not-applicable", reasons: ["market-rounds-below-minimum"], marketRounds: 69 });
  });

  test("공고 하나의 하한율을 넘기면 맞춤 밖 하한율이나 미관측일 때 시장을 읽지 않고 닫는다", async () => {
    const asked: MarketRoundQuery[] = [];
    const subject = decider({ businesses: [business(101n)], asked });
    expect(await subject.decide({ workspaceId: 4n, floorRate: bidRate(canonicalDecimal("88.000", 3)) }))
      .toMatchObject({ kind: "not-applicable", reasons: ["floor-rate-outside-market-pick"], marketRounds: null });
    expect(await subject.decide({ workspaceId: 4n, floorRate: null }))
      .toMatchObject({ kind: "not-applicable", reasons: ["floor-rate-unobserved"], marketRounds: null });
    expect(asked).toHaveLength(0);
  });

  test("시장 조회가 실패하면 예외 대신 계산하지 못했다는 결정으로 닫는다", async () => {
    const broken: MarketRoundReader = { findRounds: async () => { throw new Error("private connection failure"); } };
    const decision = await decider({ businesses: [business(101n)], market: broken }).decide({ workspaceId: 4n });
    expect(decision).toMatchObject({ kind: "not-applicable", reasons: ["market-data-unavailable"], marketRounds: null });
  });
});
