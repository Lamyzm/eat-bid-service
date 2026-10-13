import { describe, expect, test } from "bun:test";
import { fixedClock, Temporal } from "@eatbid/domain";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { MARKET_POSITION_PICK } from "../domain/market-position-pick-table";
import type { BidReviewLedgerRecord, BidReviewReader, BidReviewRoundRecord } from "./bid-review-reader";
import type { DecideMarketPick, MarketPickDecision } from "./decide-market-pick";
import { GetMyBidReview } from "./get-my-bid-review";

const businesses = {
  find: async () => ({ kind: "not-found" }),
  list: async () => [101n, 102n].map((id) => ({ supplier: { kind: "linked", supplierPartyId: id } })),
} as unknown as RegisteredBusinessReader;

const picked: MarketPickDecision = {
  kind: "picked",
  method: MARKET_POSITION_PICK,
  window: { fromMonth: "2026-06", throughMonth: "2026-08", currentMonth: "2026-09" },
  pick: { multiples: ["0.9849", "0.9894"], inSampleExpectedWins: 0 },
  single: { multiples: ["0.9849"], inSampleExpectedWins: 0 },
  spares: [],
  marketRounds: 164,
  linkedBusinesses: 2,
} as unknown as MarketPickDecision;

function round(overrides: Partial<BidReviewRoundRecord> & { readonly auctionAttemptId: bigint }): BidReviewRoundRecord {
  return {
    openedAt: Temporal.Instant.from("2026-09-16T01:00:00Z"),
    deadlineAt: Temporal.Instant.from("2026-09-16T00:00:00Z"),
    displayBidNo: "E260909-658847-0",
    title: "2026년 10월 진영대창초등학교 급식용 식재료 축산물 소액수의 견적제출 공고",
    organizationLabel: "진영대창초등학교",
    itemLabel: "육류",
    // 예정가격 9,850,000원 — 그날 하한 0.985000. 맞춤 1번(0.9849)은 하한 미달, 2번(0.9894)은 1등 자리다.
    baseAmount: "10000000.00",
    plannedAmount: "9850000.00",
    floorRate: "90.000",
    bidderCount: 5,
    competitorRates: ["89.000", "90.500", "91.000"],
    own: [
      { supplierPartyId: 101n, label: "(주)오뚜기축산", rate: "90.200" },
      { supplierPartyId: 102n, label: "신성유통", rate: "89.900" },
    ],
    award: { supplierPartyId: 101n, label: "(주)오뚜기축산", rate: "90.200" },
    ...overrides,
  };
}

function useCase(options: {
  readonly rounds: readonly BidReviewRoundRecord[];
  readonly ledger?: readonly BidReviewLedgerRecord[];
  readonly months?: Awaited<ReturnType<BidReviewReader["listMonths"]>>;
  readonly asked?: string[];
}) {
  const reader: BidReviewReader = {
    listMonths: async () => options.months ?? [{ month: "2026-08", rounds: 1, bids: 2, wins: 0 }, { month: "2026-09", rounds: 2, bids: 4, wins: 1 }],
    findRounds: async (_snapshot, input) => {
      options.asked?.push(input.openedFrom.toString());
      return options.rounds;
    },
    findLedger: async () => options.ledger ?? [],
  };
  const decide = { decide: async () => picked } as unknown as DecideMarketPick;
  const snapshot = { run: async <A>(work: (snapshot: never) => Promise<A>) => work(undefined as never) };
  return new GetMyBidReview(snapshot, businesses, reader, decide, fixedClock(Temporal.Instant.from("2026-10-14T00:00:00Z")));
}

const run = (target: GetMyBidReview, month: string | null = "2026-09") =>
  new EffectRunner().run(target.execute({ workspaceId: 4n, month }));

describe("내 투찰 복기", () => {
  test("달을 고르지 않으면 내 공고가 있는 가장 최근 달을 KST 달 경계로 읽는다", async () => {
    const asked: string[] = [];
    const record = await run(useCase({ rounds: [round({ auctionAttemptId: 1n })], asked }), null);
    expect(record.selected?.month).toBe("2026-09");
    expect(asked).toEqual(["2026-08-31T15:00:00Z"]);
  });

  test("낸 값·낙찰·하한을 같은 눈금에 놓고, 낙찰한 업체는 won, 다른 업체는 자리로 가린다", async () => {
    const record = await run(useCase({ rounds: [round({ auctionAttemptId: 1n })] }));
    const [only] = record.selected!.rounds;
    expect(only!.floorRatio).toBe("0.985000");
    expect(only!.winner).toEqual({ label: "(주)오뚜기축산", ratio: "0.987189", mine: true });
    expect(only!.own.map((bid) => [bid.label, bid.verdict])).toEqual([["(주)오뚜기축산", "won"], ["신성유통", "below-floor"]]);
  });

  test("장부가 없던 달은 맞춤·전국 공식을 다시 계산한 값으로 붙이고 아침 갱신은 비운다", async () => {
    const record = await run(useCase({ rounds: [round({ auctionAttemptId: 1n })] }));
    const methods = record.selected!.rounds[0]!.methods;
    expect(methods.map((values) => [values.method, values.source])).toEqual([["market-pick", "recomputed"], ["national-rule", "recomputed"]]);
    expect(methods[0]!.positions).toEqual([{ ratio: "0.984900", verdict: "below-floor" }, { ratio: "0.989400", verdict: "first" }]);
    expect(record.selected!.marketPick).toEqual({
      version: MARKET_POSITION_PICK.version,
      window: { fromMonth: "2026-06", throughMonth: "2026-08" },
      ratios: ["0.984900", "0.989400"],
      marketRounds: 164,
    });
  });

  test("장부에 마감 전에 내보낸 값이 있으면 다시 계산하지 않고 마감 전 마지막 값을 쓴다 — 마감 뒤에 내보낸 값은 대조하지 않는다", async () => {
    const at = (iso: string) => Temporal.Instant.from(iso);
    const ledger: BidReviewLedgerRecord[] = [
      { auctionAttemptId: 1n, method: "market-pick", methodVersion: "2026-09-01", floorRate: "90.000", baseRelativeRates: ["88.5000", "89.1000"], firstServedAt: at("2026-09-15T12:00:00Z") },
      { auctionAttemptId: 1n, method: "market-pick", methodVersion: "2026-09-01", floorRate: "90.000", baseRelativeRates: ["88.6410", "89.0280"], firstServedAt: at("2026-09-15T23:50:00Z") },
      { auctionAttemptId: 1n, method: "market-pick", methodVersion: "2026-09-01", floorRate: "90.000", baseRelativeRates: ["80.0000"], firstServedAt: at("2026-09-16T00:30:00Z") },
      { auctionAttemptId: 1n, method: "morning-habit", methodVersion: "2026-10-11", floorRate: "90.000", baseRelativeRates: ["88.9000"], firstServedAt: at("2026-09-15T23:40:00Z") },
    ];
    const record = await run(useCase({ rounds: [round({ auctionAttemptId: 1n })], ledger }));
    const methods = record.selected!.rounds[0]!.methods;
    expect(methods.map((values) => [values.method, values.source, values.version])).toEqual([
      ["morning-habit", "ledger", "2026-10-11"],
      ["market-pick", "ledger", "2026-09-01"],
      ["national-rule", "recomputed", "2026-10-10"],
    ]);
    expect(methods[1]!.positions.map((position) => position.ratio)).toEqual(["0.984900", "0.989200"]);
  });

  test("예정가격이 관측되지 않은 회차는 대조에서 빼고 그 수를 따로 말한다", async () => {
    const record = await run(useCase({ rounds: [round({ auctionAttemptId: 1n }), round({ auctionAttemptId: 2n, plannedAmount: null })] }));
    expect(record.selected!.rounds).toHaveLength(1);
    expect(record.selected!.unplannedRounds).toBe(1);
  });

  test("달 요약은 방법마다 1등 자리·둘 다 하한 미달·기대와 다시 계산한 공고 수를 센다", async () => {
    const record = await run(useCase({ rounds: [round({ auctionAttemptId: 1n })] }));
    const byMethod = Object.fromEntries(record.selected!.summaries.map((summary) => [summary.method, summary]));
    expect(byMethod.own).toMatchObject({ rounds: 1, first: 1, allBelowFloor: 0, recomputedRounds: 0 });
    expect(byMethod["market-pick"]).toMatchObject({ rounds: 1, first: 1, allBelowFloor: 0, recomputedRounds: 1 });
    expect(byMethod["morning-habit"]).toMatchObject({ rounds: 0, first: 0 });
  });

  test("내 공고가 하나도 없으면 고른 달이 없다", async () => {
    const record = await run(useCase({ rounds: [], months: [] }), null);
    expect(record.selected).toBeNull();
    expect(record.months).toEqual([]);
  });
});
