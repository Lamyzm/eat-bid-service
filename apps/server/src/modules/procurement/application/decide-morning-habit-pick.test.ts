import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { createUnitOfWork } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessRecord } from "../../account/application/account-repository";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { MORNING_HABIT_FIXTURE as FIXTURE } from "../domain/__fixtures__/morning-habit";
import { floorRelativeRatio, positionsOf } from "../domain/market-position-pick";
import { DecideMorningHabitPick, morningHabitPickFor } from "./decide-morning-habit-pick";
import type { HabitFirmBidRecord, HabitMarketRoundRecord, HabitWindow, MorningHabitReader } from "./morning-habit-reader";

const instant = (minute: number) => Temporal.Instant.fromEpochMilliseconds((FIXTURE.startEpochSeconds + minute * 60) * 1000);
const ratioOf = (value: number) => floorRelativeRatio(canonicalDecimal(value.toFixed(8), 8));
const within = (at: Temporal.Instant, window: HabitWindow) =>
  Temporal.Instant.compare(at, window.openedFrom) >= 0 && Temporal.Instant.compare(at, window.openedBefore) < 0;

const marketRecords: HabitMarketRoundRecord[] = FIXTURE.market.map(([opened, deadline, firms, ratios]) => ({
  openedAt: instant(opened),
  deadlineAt: instant(deadline),
  bids: firms.map((firm, index) => ({ supplierPartyId: BigInt(firm), ratio: ratioOf(ratios[index]!) })),
}));

const firmRecords: HabitFirmBidRecord[] = Object.entries(FIXTURE.histories).flatMap(([firm, bids]) =>
  bids.map(([opened, deadline, ratio]) => ({
    supplierPartyId: BigInt(firm), openedAt: instant(opened), deadlineAt: instant(deadline), ratio: ratioOf(ratio),
  })));

/** 운영 읽기처럼 창 안 것만 돌려준다. 물어본 창은 `asked`에 남긴다. */
function fixtureReader(asked: { market: HabitWindow[]; firms: (HabitWindow & { readonly supplierPartyIds: readonly bigint[] })[] }): MorningHabitReader {
  return {
    findMarketRounds: async (_snapshot, query) => {
      asked.market.push(query);
      return marketRecords.filter((round) => within(round.openedAt, query));
    },
    findFirmBids: async (_snapshot, query) => {
      asked.firms.push(query);
      return firmRecords.filter((bid) => within(bid.openedAt, query) && query.supplierPartyIds.includes(bid.supplierPartyId));
    },
  };
}

function business(supplierPartyId: bigint | null): RegisteredBusinessRecord {
  return {
    registeredBusinessId: supplierPartyId ?? 99n,
    businessNumber: "1234567890",
    registeredAt: Temporal.Instant.from("2026-01-02T00:00:00Z"),
    supplier: supplierPartyId === null ? { kind: "unobserved" } : { kind: "linked", supplierPartyId },
    location: null,
  };
}

const target = FIXTURE.expected[2]!;
const targetDeadline = instant(target.deadlineMinute);

function decider(options: {
  readonly businesses: readonly RegisteredBusinessRecord[];
  readonly reader?: MorningHabitReader;
  readonly now?: Temporal.Instant;
}) {
  const snapshot = createUnitOfWork({ transaction: (work) => work({ execute: async () => [] }) });
  const registered: RegisteredBusinessReader = { find: async () => ({ kind: "not-found" }), list: async () => options.businesses };
  const reader = options.reader ?? fixtureReader({ market: [], firms: [] });
  // 분석처럼 대상 공고 마감 10분 전에 본다.
  const now = options.now ?? targetDeadline.subtract({ seconds: 600 });
  return new DecideMorningHabitPick(snapshot, registered, reader, fixedClock(now));
}

const ninety = bidRate(canonicalDecimal("90.000", 3));
const tenMillion = krw(canonicalDecimal("10000000.00", 2));
const ours = [business(1n), business(2n)];

describe("아침 습관 맞춤 결정", () => {
  test("결정 시각 전 시장으로 단골을 정해 분석 엔진과 같은 두 장·한 장 자리를 고른다", async () => {
    const decision = await decider({ businesses: ours }).decide({ workspaceId: 4n });
    if (decision.kind !== "ready") throw new Error("골라야 한다");
    expect(decision.regulars).toBe(FIXTURE.regulars.length);
    const applied = morningHabitPickFor(decision, {
      baseAmount: tenMillion, floorRate: ninety, deadlineAt: targetDeadline, competitorCount: target.competitorCount,
    });
    if (applied.state !== "applicable") throw new Error("켜져야 한다");
    expect(applied.positions).toEqual(positionsOf(tenMillion, ninety, target.pair));
    expect(applied.single).toEqual(positionsOf(tenMillion, ninety, [target.single])[0]!);
    expect(applied.coverage).toBe(canonicalDecimal(target.coverage.toFixed(6), 6) as never);
    expect(applied.sameDayRegulars).toBe(target.regulars.filter((view) => view.kind !== "earlier").length);
  });

  test("시장은 단골 창과 유지 확률 창 가운데 넓은 쪽만큼, 단골 이력은 30일 더 앞에서부터 읽는다", async () => {
    const asked = { market: [] as HabitWindow[], firms: [] as (HabitWindow & { readonly supplierPartyIds: readonly bigint[] })[] };
    const now = Temporal.Instant.from("2026-05-07T01:50:00Z");
    await decider({ businesses: ours, reader: fixtureReader(asked), now }).decide({ workspaceId: 4n });
    expect(asked.market[0]?.openedFrom.toString()).toBe(now.subtract({ hours: 180 * 24, seconds: 1200 }).toString());
    expect(asked.market[0]?.openedBefore.toString()).toBe(now.toString());
    expect(asked.firms[0]?.openedFrom.toString()).toBe(now.subtract({ hours: 210 * 24, seconds: 1200 }).toString());
    expect(asked.firms[0]?.supplierPartyIds).toEqual(FIXTURE.regulars.map((firm) => BigInt(firm)));
  });

  test("등록 사업자가 하나면 두 장 대신 한 장 자리를 1번으로 쓴다", async () => {
    const decision = await decider({ businesses: [business(1n), business(null)] }).decide({ workspaceId: 4n });
    const applied = morningHabitPickFor(decision, {
      baseAmount: tenMillion, floorRate: ninety, deadlineAt: targetDeadline, competitorCount: target.competitorCount,
    });
    if (applied.state !== "applicable") throw new Error("켜져야 한다");
    expect(applied.positions).toEqual([applied.single]);
  });

  test("오늘 자리가 보인 단골 몫이 0.3보다 적은 공고는 그 몫과 함께 닫는다", async () => {
    const decision = await decider({ businesses: ours }).decide({ workspaceId: 4n });
    // 다음 날 마감 공고는 아직 그날 결과가 하나도 없다.
    const tomorrow = targetDeadline.add({ hours: 24 });
    expect(morningHabitPickFor(decision, { baseAmount: tenMillion, floorRate: ninety, deadlineAt: tomorrow, competitorCount: 9 }))
      .toEqual({ state: "not-applicable", reasons: ["same-day-coverage-below-threshold"], coverage: canonicalDecimal("0.000000", 6) as never });
  });

  test("마감이 지났거나 참여 수·하한율·마감을 모르는 공고는 그 이유로 닫는다", async () => {
    const decision = await decider({ businesses: ours }).decide({ workspaceId: 4n });
    const base = { baseAmount: tenMillion, floorRate: ninety, deadlineAt: targetDeadline, competitorCount: 9 } as const;
    const reasons = (auction: Parameters<typeof morningHabitPickFor>[1]) => morningHabitPickFor(decision, auction);
    expect(reasons({ ...base, deadlineAt: decision.decidedAt })).toMatchObject({ reasons: ["deadline-passed"] });
    expect(reasons({ ...base, competitorCount: null })).toMatchObject({ reasons: ["participation-unobserved"] });
    expect(reasons({ ...base, deadlineAt: null })).toMatchObject({ reasons: ["deadline-unobserved"] });
    expect(reasons({ ...base, floorRate: null })).toMatchObject({ reasons: ["floor-rate-unobserved"] });
    expect(reasons({ ...base, floorRate: bidRate(canonicalDecimal("88.000", 3)) })).toMatchObject({ reasons: ["floor-rate-outside-habit-pick"] });
  });

  test("관측된 사업자가 없거나 시장 공고가 30건보다 적으면 이력을 읽지 않고 닫는다", async () => {
    const asked = { market: [] as HabitWindow[], firms: [] as (HabitWindow & { readonly supplierPartyIds: readonly bigint[] })[] };
    const none = await decider({ businesses: [business(null)], reader: fixtureReader(asked) }).decide({ workspaceId: 4n });
    expect(none).toMatchObject({ kind: "not-applicable", reasons: ["no-linked-business"], marketRounds: null });
    expect(asked.market).toHaveLength(0);
    const early = instant(FIXTURE.market[20]![1]);
    const few = await decider({ businesses: ours, reader: fixtureReader(asked), now: early }).decide({ workspaceId: 4n });
    expect(few).toMatchObject({ kind: "not-applicable", reasons: ["market-rounds-below-minimum"] });
    expect(asked.firms).toHaveLength(0);
  });

  test("시장 조회가 실패하면 예외 대신 계산하지 못했다는 결정으로 닫는다", async () => {
    const broken: MorningHabitReader = {
      findMarketRounds: async () => { throw new Error("private connection failure"); },
      findFirmBids: async () => [],
    };
    expect(await decider({ businesses: ours, reader: broken }).decide({ workspaceId: 4n }))
      .toMatchObject({ kind: "not-applicable", reasons: ["market-data-unavailable"], marketRounds: null });
  });
});
