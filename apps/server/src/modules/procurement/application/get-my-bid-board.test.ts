import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, fixedClock, krw, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import { createUnitOfWork } from "../../../platform/database/unit-of-work";
import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import type { RegisteredBusinessRecord } from "../../account/application/account-repository";
import type { RegionPreferenceRecord, RegionPreferenceRepository } from "../../account/application/region-preference-repository";
import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import { MARKET_PICK_FIXTURE } from "../domain/__fixtures__/market-position-pick";
import { floorRelativeRatio, type MarketRound } from "../domain/market-position-pick";
import { DecideMorningHabitPick } from "./decide-morning-habit-pick";
import type { MorningHabitReader } from "./morning-habit-reader";
import { DecideMarketPick } from "./decide-market-pick";
import { GetMyBidBoard } from "./get-my-bid-board";
import { NO_BID_DISPLAY_LEDGER, QuietBidDisplayLedger, type BidDisplayLedger } from "./bid-display-ledger";
import type { MarketRoundReader } from "./market-round-reader";
import type { OpenAuctionQuery, OpenAuctionReader, OpenAuctionRecord } from "./open-auction-reader";

const principal = {
  principalId: 4n,
  workspace: { workspaceId: 4n, name: "내 워크스페이스", role: "owner" },
} as unknown as ResolvedPrincipal;

const rounds: MarketRound[] = [0, 1, 2].flatMap(() => MARKET_PICK_FIXTURE.rounds.map((ratios) => ({
  competitorRatios: ratios.map((ratio) => floorRelativeRatio(canonicalDecimal(ratio, 8))),
})));

const linked = (supplierPartyId: bigint): RegisteredBusinessRecord => ({
  registeredBusinessId: supplierPartyId,
  businessNumber: "1234567890",
  registeredAt: Temporal.Instant.from("2026-10-10T02:25:00Z"),
  supplier: { kind: "linked", supplierPartyId },
  location: null,
});

function auction(overrides: Partial<OpenAuctionRecord> & { readonly auctionAttemptId: bigint }): OpenAuctionRecord {
  return {
    organization: { organizationId: 1n, label: "주촌초등학교", type: "school" },
    itemLabel: "육류 , 가금류",
    title: "(주촌초등학교) 2026년 11월 식재료(육류) 구입 소액수의 공고",
    displayBidNo: "G2026-1013",
    soloBidMethod: null,
    changeKind: null,
    floorRate: bidRate(canonicalDecimal("90.000", 3)),
    region: null,
    eligibilityAreas: null,
    termsRevisionId: 9n,
    closesAt: Temporal.Instant.from("2026-10-13T01:00:00Z"),
    baseAmount: krw(canonicalDecimal("10000000.00", 2)),
    bidCount: 52,
    observedAt: Temporal.Instant.from("2026-10-12T14:40:00Z"),
    sourceLastChangedAt: null,
    orgSummary: null,
    ...overrides,
  };
}

const confirmed: RegionPreferenceRecord = {
  areas: [{ codeValueId: 15653n, code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" }],
  confirmedAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
};

function board(options: {
  readonly preference?: RegionPreferenceRecord;
  readonly auctions?: readonly OpenAuctionRecord[];
  /** 여러 쪽으로 나뉜 목록이다. 쪽 번호를 cursor로 쓴다. 주면 `auctions`를 무시한다. */
  readonly pages?: readonly (readonly OpenAuctionRecord[])[];
  readonly market?: MarketRoundReader;
  readonly habit?: MorningHabitReader;
  readonly ledger?: BidDisplayLedger;
  readonly asked?: OpenAuctionQuery[];
  readonly now?: string;
}) {
  const clock = fixedClock(Temporal.Instant.from(options.now ?? "2026-10-12T14:50:00Z"));
  const pages = options.pages ?? [options.auctions ?? []];
  const reader: OpenAuctionReader = {
    listOpen: async (query) => {
      options.asked?.push(query);
      const index = query.cursor === null ? 0 : Number(query.cursor);
      const auctions = pages[index] ?? [];
      return {
        kind: "page",
        page: {
          auctions,
          nextCursor: index + 1 < pages.length ? BigInt(index + 1) : null,
          sampleCount: auctions.length,
          eligibilityMatchedCount: auctions.length,
          eligibilityUnobservedCount: 0,
          snapshotLineage: null,
          orgSummaryLineage: null,
        },
      };
    },
  };
  const regions = { readPreference: async () => options.preference ?? confirmed } as unknown as RegionPreferenceRepository;
  const businesses: RegisteredBusinessReader = { find: async () => ({ kind: "not-found" }), list: async () => [linked(101n), linked(102n)] };
  const snapshot = createUnitOfWork({ transaction: (work) => work({ execute: async () => [] }) });
  const market = options.market ?? { findRounds: async () => rounds };
  const decide = new DecideMarketPick(snapshot, businesses, market, clock);
  const habitReader: MorningHabitReader = options.habit ?? { findMarketRounds: async () => [], findFirmBids: async () => [] };
  const habit = new DecideMorningHabitPick(snapshot, businesses, habitReader, clock);
  return new GetMyBidBoard(reader, regions, decide, habit, clock, options.ledger ?? NO_BID_DISPLAY_LEDGER);
}

const run = (
  subject: GetMyBidBoard,
  items: Parameters<GetMyBidBoard["execute"]>[0]["itemAtoms"] = null,
  includeMorningHabit = false,
) => new EffectRunner().run(subject.execute({ principal, itemAtoms: items, includeUnknownItem: false, includeMorningHabit }));

describe("오늘 투찰 한 장 use case", () => {
  test("관심 지역을 확인하지 않았으면 공고를 읽지 않고 unconfirmed로 답한다", async () => {
    const asked: OpenAuctionQuery[] = [];
    const result = await run(board({ preference: { areas: [], confirmedAt: null }, asked }));
    expect(result.state).toBe("unconfirmed");
    expect(asked).toHaveLength(0);
  });

  test("KST 23:50에 부르면 모레 0시 전 마감까지 고른다 — 남은 24시간 10분을 올림해 25시간을 묻는다", async () => {
    const asked: OpenAuctionQuery[] = [];
    const result = await run(board({ asked }), ["육류", "가금류"]);
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(asked[0]!.closesWithinHours).toBe(25);
    expect(asked[0]!.eligibilityAreaCodeValueIds).toEqual([15653n]);
    expect(asked[0]!.itemAtoms).toEqual(["육류", "가금류"]);
    expect(asked[0]!.limit).toBe(200);
    expect(result.closesBeforeDate).toBe("2026-10-14");
  });

  test("하한율 90·88 공고만 남기고, 모레 0시 이후 마감과 마감 미관측 공고는 뺀다", async () => {
    const result = await run(board({
      auctions: [
        auction({ auctionAttemptId: 1n }),
        auction({ auctionAttemptId: 2n, floorRate: bidRate(canonicalDecimal("88.000", 3)) }),
        auction({ auctionAttemptId: 3n, floorRate: bidRate(canonicalDecimal("87.500", 3)) }),
        auction({ auctionAttemptId: 4n, closesAt: Temporal.Instant.from("2026-10-13T15:00:00Z") }),
        auction({ auctionAttemptId: 5n, closesAt: null }),
      ],
    }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(result.rows.map((row) => row.auction.auctionAttemptId)).toEqual([1n, 2n]);
  });

  test("하한율 90 공고는 맞춤 두 장·한 장·예비 셋과 전국 공식을 함께 내고, 88 공고는 맞춤 밖이다", async () => {
    const result = await run(board({
      auctions: [auction({ auctionAttemptId: 1n }), auction({ auctionAttemptId: 2n, floorRate: bidRate(canonicalDecimal("88.000", 3)) })],
    }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    const [ninety, eightyEight] = result.rows;
    if (ninety?.market?.result.state !== "applicable") throw new Error("맞춤이 나와야 한다");
    expect(ninety.market.result.positions.map((position) => position.amount.amount)).toEqual(["8940600.00", "8964000.00"]);
    expect(ninety.market.spares.map((spare) => spare.order)).toEqual([3, 4, 5]);
    expect(ninety.rule?.state).toBe("applicable");
    expect(eightyEight?.market?.result).toEqual({ state: "not-applicable", reasons: ["floor-rate-outside-market-pick"], marketRounds: null });
    expect(result.decision.kind).toBe("picked");
  });

  test("하한율이 아직 관측되지 않은 공고도 행으로 남기고 두 방법 모두 하한율 미확인이라고 말한다", async () => {
    // 하한율은 상세 수집에서만 온다. 상세 수집이 밀린 날 행을 빼면 바로 그 공고들이 흔적 없이 사라진다.
    const result = await run(board({ auctions: [auction({ auctionAttemptId: 1n, floorRate: null })] }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(result.rows.map((row) => row.auction.auctionAttemptId)).toEqual([1n]);
    expect(result.rows[0]!.rule).toMatchObject({ state: "not-applicable", reasons: ["floor-rate-unobserved"] });
    expect(result.rows[0]!.market?.result).toMatchObject({ state: "not-applicable", reasons: ["floor-rate-unobserved"] });
  });

  test("목록이 한 쪽을 넘으면 다음 쪽을 끝까지 따라 읽고 잘리지 않았다고 말한다", async () => {
    const asked: OpenAuctionQuery[] = [];
    const result = await run(board({
      asked,
      pages: [[auction({ auctionAttemptId: 1n })], [auction({ auctionAttemptId: 2n })], [auction({ auctionAttemptId: 3n })]],
    }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(asked.map((query) => query.cursor)).toEqual([null, 1n, 2n]);
    expect(result.rows.map((row) => row.auction.auctionAttemptId)).toEqual([1n, 2n, 3n]);
    expect(result.truncated).toBe(false);
  });

  test("다섯 쪽을 읽고도 남으면 거기서 멈추고 잘렸다고 말한다", async () => {
    // 성수기 이틀·넓은 관심 지역이 겹치면 늦게 마감하는 공고부터 빠진다. 빠졌다는 사실은 화면이 말해야 한다.
    const asked: OpenAuctionQuery[] = [];
    const pages = Array.from({ length: 7 }, (_, index) => [auction({ auctionAttemptId: BigInt(index + 1) })]);
    const result = await run(board({ asked, pages }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(asked).toHaveLength(5);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  test("기초금액이 없는 공고는 행을 남기고 두 방법을 null로 둔다", async () => {
    const result = await run(board({ auctions: [auction({ auctionAttemptId: 1n, baseAmount: null })] }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(result.rows[0]).toMatchObject({ rule: null, market: null });
  });

  test("맞춤 시장 조회가 실패해도 전국 공식 금액은 그대로 내고 맞춤 칸만 계산하지 못했다고 한다", async () => {
    const broken: MarketRoundReader = { findRounds: async () => { throw new Error("private connection failure"); } };
    const result = await run(board({ auctions: [auction({ auctionAttemptId: 1n })], market: broken }));
    if (result.state !== "confirmed") throw new Error("확인된 지역이어야 한다");
    expect(result.rows[0]!.market?.result).toEqual({ state: "not-applicable", reasons: ["market-data-unavailable"], marketRounds: null });
    expect(result.rows[0]!.market?.spares).toEqual([]);
    expect(result.rows[0]!.rule?.state).toBe("applicable");
  });
});

describe("오늘 투찰 아침 갱신", () => {
  test("요청하지 않으면 결정과 행의 아침 갱신 칸이 모두 비어 있다", async () => {
    const record = await run(board({ auctions: [auction({ auctionAttemptId: 1n })] }));
    if (record.state !== "confirmed") throw new Error("확인된 관심 지역이어야 한다");
    expect(record.habit).toBeNull();
    expect(record.rows.map((row) => row.morningHabit)).toEqual([null]);
  });

  test("요청하면 결정을 한 번 내리고 행마다 공고 금액으로 바꾼다", async () => {
    let read = 0;
    const habit: MorningHabitReader = { findMarketRounds: async () => { read += 1; return []; }, findFirmBids: async () => [] };
    const record = await run(board({ auctions: [auction({ auctionAttemptId: 1n }), auction({ auctionAttemptId: 2n })], habit }), null, true);
    if (record.state !== "confirmed") throw new Error("확인된 관심 지역이어야 한다");
    expect(read).toBe(1);
    expect(record.habit?.kind).toBe("not-applicable");
    expect(record.rows.map((row) => row.morningHabit?.state)).toEqual(["not-applicable", "not-applicable"]);
  });
});

describe("오늘 투찰 화면 장부", () => {
  test("화면에 금액을 보인 하한율 90 행만 장부에 남기고, 금액 없이 직접 판단만 다는 88 행은 남기지 않는다", async () => {
    const recorded: Parameters<BidDisplayLedger["record"]>[0][] = [];
    const ledger: BidDisplayLedger = { record: async (input) => { recorded.push(input); } };
    await run(board({
      auctions: [auction({ auctionAttemptId: 1n }), auction({ auctionAttemptId: 2n, floorRate: bidRate(canonicalDecimal("88.000", 3)) })],
      ledger,
    }));
    expect(recorded).toHaveLength(1);
    const entries = recorded[0]!.entries;
    expect(recorded[0]!.workspaceId).toBe(4n);
    expect(entries.map((entry) => [entry.auctionAttemptId, entry.method])).toEqual([[1n, "market-pick"], [1n, "national-rule"]]);
    const market = entries.find((entry) => entry.method === "market-pick")!;
    // 화면의 기초금액 대비 % 그대로다. 사정률은 이 값을 하한율로 나눈 것이다(ADR 0066).
    expect(market.baseRelativeRates).toEqual(["89.4060", "89.6400"]);
    expect(market.floorRate).toBe("90.000");
    expect(market.basisPeriod).toMatch(/^\d{4}-\d{2}~\d{4}-\d{2}$/);
    expect(entries.find((entry) => entry.method === "national-rule")?.singleBaseRelativeRate).toBeNull();
  });

  test("장부가 실패해도 오늘 투찰 응답은 그대로 나간다", async () => {
    const failures: unknown[] = [];
    const ledger = new QuietBidDisplayLedger({ record: async () => { throw new Error("장부 표가 없다"); } }, (error) => failures.push(error));
    const record = await run(board({ auctions: [auction({ auctionAttemptId: 1n })], ledger }));
    expect(record.state).toBe("confirmed");
    expect(failures).toHaveLength(1);
  });
});
