import { describe, expect, test } from "bun:test";
import { organizationAuctionAttemptsQuerySchema } from "./operations";
import { organizationAuctionAttemptsMetaSchema, organizationAuctionAttemptSchema } from "./attempt.resource";

describe("기관 회차 비교집단 계약", () => {
  test("하한율·낙찰 방식의 전체와 미확인 및 60개월 구간을 구별한다", () => {
    const query = { floorRate: "88.000", awardMethod: "31", from: "2021-10", to: "2026-09" };
    expect(organizationAuctionAttemptsQuerySchema.parse(query)).toMatchObject(query);
    for (const value of ["all", "unknown"]) {
      expect(organizationAuctionAttemptsQuerySchema.parse({ floorRate: value, awardMethod: value }))
        .toMatchObject({ floorRate: value, awardMethod: value });
    }
    expect(organizationAuctionAttemptsQuerySchema.parse({})).toEqual({ limit: 12, opened: "only" });
  });

  test("잘못된 하한율·방식 식별자와 불완전하거나 역전된 기간을 거부한다", () => {
    for (const floorRate of ["88", "88.00", "100.001", "-1.000"]) {
      expect(organizationAuctionAttemptsQuerySchema.safeParse({ floorRate }).success).toBe(false);
    }
    for (const awardMethod of ["0", "031", "013.0", "9223372036854775808"]) {
      expect(organizationAuctionAttemptsQuerySchema.safeParse({ awardMethod }).success).toBe(false);
    }
    for (const period of [{ from: "2026-09" }, { to: "2026-09" }, { from: "2026-09", to: "2026-08" }, { from: "2021-09", to: "2026-09" }]) {
      expect(organizationAuctionAttemptsQuerySchema.safeParse(period).success).toBe(false);
    }
  });

  test("응답 조건에는 exact 값의 단위와 미확인·전체 상태를 함께 싣는다", () => {
    const cohort = {
      floorRate: { kind: "exact", value: { value: "88.000", unit: "percentage-points" } },
      awardMethod: { kind: "unknown" },
      period: { from: "2026-08", to: "2026-09" },
    };
    expect(organizationAuctionAttemptsMetaSchema.shape.cohort.parse(cohort)).toEqual(cohort);
    expect(organizationAuctionAttemptsMetaSchema.shape.cohort.parse(undefined)).toBeUndefined();
    expect(organizationAuctionAttemptSchema.shape.awardMethodCodeValueId.parse("9007199254740993"))
      .toBe("9007199254740993");
    expect(organizationAuctionAttemptSchema.shape.awardMethodCodeValueId.parse(null)).toBeNull();
  });
});
