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
import { DecideMarketPick } from "./decide-market-pick";
import { GetMyBidBoard } from "./get-my-bid-board";
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
  readonly market?: MarketRoundReader;
  readonly asked?: OpenAuctionQuery[];
  readonly now?: string;
}) {
  const clock = fixedClock(Temporal.Instant.from(options.now ?? "2026-10-12T14:50:00Z"));
  const reader: OpenAuctionReader = {
    listOpen: async (query) => {
      options.asked?.push(query);
      return {
        kind: "page",
        page: {
          auctions: options.auctions ?? [],
          nextCursor: null,
          sampleCount: options.auctions?.length ?? 0,
          eligibilityMatchedCount: options.auctions?.length ?? 0,
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
  return new GetMyBidBoard(reader, regions, decide, clock);
}

const run = (subject: GetMyBidBoard, items: Parameters<GetMyBidBoard["execute"]>[0]["itemAtoms"] = null) =>
  new EffectRunner().run(subject.execute({ principal, itemAtoms: items, includeUnknownItem: false }));

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
