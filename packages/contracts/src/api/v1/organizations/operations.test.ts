import { describe, expect, test } from "bun:test";
import { organizationV1Operations } from "./operations";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

describe("listOrganizationAuctionAttempts 계약", () => {
  test("경로와 query를 canonical 형태로 조립한다", () => {
    const path = organizationV1Operations.listAuctionAttempts.buildPath({
      path: { organizationId: "42" },
      query: { limit: 60, cursor: "5796468", item: "7" },
    });
    expect(path).toBe("/api/v1/organizations/42/auction-attempts?cursor=5796468&item=7&limit=60");
  });

  test("limit 기본값은 12이고 200을 넘으면 거부한다", () => {
    const { querySchema } = organizationV1Operations.listAuctionAttempts;
    expect(querySchema.parse({})).toEqual({ limit: 12 });
    expect(querySchema.parse({ limit: "200" })).toEqual({ limit: 200 });
    expect(() => querySchema.parse({ limit: "201" })).toThrow();
  });

  test("빈 이력 응답도 meta의 표본 수와 release를 요구한다", () => {
    const parsed = organizationAuctionAttemptsV1ResponseSchema.parse({
      organizationId: "42",
      attempts: [],
      nextCursor: null,
      meta: { sampleCount: 0, martRelease: null, computedAt: null, calcVersion: null },
    });
    expect(parsed.attempts).toHaveLength(0);
  });

  test("회차 행은 비율 단위와 금액 통화를 강제한다", () => {
    const row = {
      attemptId: "5796468", announcedAt: "2026-09-01T00:00:00Z", openedAt: "2026-09-04T05:00:00Z",
      item: { codeValueId: "7", label: "축산" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: { value: "90.309", unit: "percentage-points" },
      secondRate: null, dayFloorRate: null, listCount: 17, invalidCount: 2,
      winnerSupplierPartyId: "9", supersedesAttemptId: null,
    };
    expect(organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse(row)).toEqual(row);
    expect(() => organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse({ ...row, winRate: 90.309 })).toThrow();
  });
});
