import { describe, expect, test } from "bun:test";
import { auctionBidPositionV1ResponseSchema } from "./get-auction-bid-position.response";
import { auctionV1Operations } from "./operations";

const applicableFixture = () => ({
  auctionId: "9007199254740993",
  revisionId: "99",
  baseAmount: { amount: "17159500.00", currency: "KRW" },
  floorRate: { value: "90.000", unit: "percentage-points" },
  participation: { bidCount: 52, observedAt: "2026-10-07T01:00:00Z" },
  deadlineAt: "2026-10-07T02:00:00Z",
  rule: { version: "2026-10-07", trainedThrough: "2025-12", validatedFrom: "2026-01", validatedThrough: "2026-08" },
  result: {
    state: "applicable",
    band: { minBidCount: 40, maxBidCount: 69 },
    bidCountBasis: { kind: "estimated", observedBidCount: 36, hoursBeforeDeadline: 12, estimatedBidCount: 49 },
    evidence: "clear",
    selection: "training",
    validationRounds: 3450,
    holdout: { month: "2026-09", rounds: 869, tickets: 2, wins: 41, lotteryExpectedWins: "33.7" },
    positions: [{
      order: 1,
      amount: { amount: "15219619.00", currency: "KRW" },
      baseRelativeRate: { value: "88.6950", unit: "percentage-points" },
      cumulativeWinRate: { value: "2.260000", unit: "percentage-points" },
      cumulativeLotteryWinRate: { value: "1.790000", unit: "percentage-points" },
      cumulativeValidationWins: 78,
    }],
  },
});

describe("추천 투찰가 공개 계약", () => {
  test("금액과 근거를 손실 없이 왕복한다", () => {
    const data = applicableFixture();
    expect(auctionBidPositionV1ResponseSchema.parse(data)).toEqual(data);
  });

  test("규칙 밖 회차는 숫자 없이 사유만 싣는다", () => {
    const data = { ...applicableFixture(), result: { state: "not-applicable", reasons: ["floor-rate-outside-rule", "participation-unobserved"] } };
    expect(auctionBidPositionV1ResponseSchema.parse(data).result).toEqual(data.result);
    const smuggled = { ...data, result: { ...data.result, positions: [] } };
    expect(auctionBidPositionV1ResponseSchema.safeParse(smuggled).success).toBe(false);
  });

  test("원 단위 소수 둘째 자리가 아닌 금액과 셋을 넘는 자리를 거부한다", () => {
    const data = applicableFixture();
    data.result.positions[0]!.amount.amount = "15219620";
    expect(auctionBidPositionV1ResponseSchema.safeParse(data).success).toBe(false);
    const many = applicableFixture();
    many.result.positions = [1, 2, 3, 4].map((order) => ({ ...many.result.positions[0]!, order }));
    expect(auctionBidPositionV1ResponseSchema.safeParse(many).success).toBe(false);
  });

  test("사유 없는 규칙 밖 응답과 추정 근거 없는 추정 참여 수를 거부한다", () => {
    const empty = { ...applicableFixture(), result: { state: "not-applicable", reasons: [] } };
    expect(auctionBidPositionV1ResponseSchema.safeParse(empty).success).toBe(false);
    const data = applicableFixture();
    (data.result as { bidCountBasis: unknown }).bidCountBasis = { kind: "estimated", estimatedBidCount: 49 };
    expect(auctionBidPositionV1ResponseSchema.safeParse(data).success).toBe(false);
  });

  test("공고 아래 bid-position 경로를 operation 하나에서 파생한다", () => {
    const operation = auctionV1Operations.bidPosition;
    expect(operation.buildPath({ path: { auctionId: "5270" } })).toBe("/api/v1/auctions/5270/bid-position");
    expect(operation.problemResponses[403]).toBeDefined();
  });
});
