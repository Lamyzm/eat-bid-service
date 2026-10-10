import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { myBidBoardQuerySchema, myBidBoardV1Operations } from "./bid-board.operations";
import { myBidBoardV1ResponseSchema } from "./bid-board.response";

const position = (order: number, amount: string, rate: string) => ({
  order,
  amount: { amount, currency: "KRW" },
  baseRelativeRate: { value: rate, unit: "percentage-points" },
});

function boardFixture() {
  return {
    regionPreference: "confirmed",
    asOf: "2026-10-12T00:47:00Z",
    closesBeforeDate: "2026-10-14",
    rule: { version: "2026-10-10", trainedThrough: "2025-12", validatedFrom: "2026-01", validatedThrough: "2026-08" },
    marketPick: {
      version: "2026-10-10",
      windowMonths: 3,
      minimumRounds: 70,
      window: { fromMonth: "2026-07", throughMonth: "2026-09" },
      state: "picked",
      reasons: [],
      marketRounds: 164,
      linkedBusinesses: 2,
      evidence: [{
        from: "2025-01", through: "2025-12", rounds: 681,
        expectedWins: "39.6", ruleExpectedWins: "34.7", currentExpectedWins: "22.4", lotteryExpectedWins: "26.6",
      }],
    },
    rows: [{
      auctionId: "2797346",
      closesAt: "2026-10-13T01:00:00Z",
      organizationLabel: "주촌초등학교",
      title: "(주촌초등학교) 2026년 11월 식재료(육류) 구입 소액수의 공고",
      itemLabel: "육류 , 가금류",
      displayBidNo: "G2026-1013",
      baseAmount: { amount: "8756540.00", currency: "KRW" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      bidCount: 12,
      observedAt: "2026-10-12T00:40:00Z",
      rule: {
        state: "not-applicable",
        reasons: ["participation-below-rule"],
      },
      market: {
        state: "applicable",
        positions: [position(1, "7761885.00", "88.6410"), position(2, "7795773.00", "89.0280")],
        single: position(1, "7761885.00", "88.6410"),
        spares: [position(3, "7753218.00", "88.5420"), position(4, "7770552.00", "88.7400"), position(5, "7779218.00", "88.8390")],
      },
    }],
  };
}

describe("오늘 투찰 공개 계약", () => {
  test("공고 행은 전국 공식과 맞춤 금액을 따로 싣고 왕복한다", () => {
    expect(myBidBoardV1ResponseSchema.parse(boardFixture())).toEqual(boardFixture());
  });

  test("기초금액이 관측되지 않은 행은 두 방법 모두 null로 싣는다", () => {
    const board = boardFixture();
    const row = { ...board.rows[0]!, baseAmount: null, rule: null, market: null };
    expect(myBidBoardV1ResponseSchema.safeParse({ ...board, rows: [row] }).success).toBe(true);
  });

  test("관심 지역을 확인하지 않았으면 행 없이 그 사실만 싣는다", () => {
    const unconfirmed = { regionPreference: "unconfirmed", asOf: "2026-10-12T00:47:00Z", rows: [] };
    expect(myBidBoardV1ResponseSchema.safeParse(unconfirmed).success).toBe(true);
    expect(myBidBoardV1ResponseSchema.safeParse({ ...unconfirmed, rows: boardFixture().rows }).success).toBe(false);
  });

  test("맞춤 칸의 예비 순위는 셋까지이고 계약에 없는 확률 필드를 받지 않는다", () => {
    const board = boardFixture();
    const market = board.rows[0]!.market;
    const four = { ...board.rows[0]!, market: { ...market, spares: [...market.spares, market.spares[0]!] } };
    expect(myBidBoardV1ResponseSchema.safeParse({ ...board, rows: [four] }).success).toBe(false);
    const withProbability = { ...board.rows[0]!, market: { ...market, winProbability: "5.4" } };
    expect(myBidBoardV1ResponseSchema.safeParse({ ...board, rows: [withProbability] }).success).toBe(false);
  });

  test("품목만 query로 받고 지역은 받지 않는다", () => {
    expect(myBidBoardQuerySchema.parse({ items: ["육류", "가금류"] })).toEqual({ items: ["육류", "가금류"] });
    expect(myBidBoardQuerySchema.parse({ items: "육류" })).toEqual({ items: ["육류"] });
    expect(myBidBoardQuerySchema.safeParse({ items: "축산" }).success).toBe(false);
    expect(myBidBoardQuerySchema.safeParse({ eligibilityArea: "15653" }).success).toBe(false);
  });

  test("bid-board 경로를 server 소유 operation 하나에서 파생한다", () => {
    const operation = myBidBoardV1Operations.getMyBidBoard;
    expect(operation.buildPath({ path: undefined })).toBe("/api/v1/me/bid-board");
    expect(operation.problemResponses[403]).toBeDefined();
    const found = publicHttpOperationRegistry.filter((candidate) => candidate.operationId === "getMyBidBoard");
    expect(found).toHaveLength(1);
    expect(found[0]?.implementationOwner).toBe("server");
  });
});
