import { describe, expect, test } from "bun:test";
import { organizationV1Operations } from "./operations";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

const EMPTY_META = {
  sampleCount: 0,
  item: null,
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null,
} as const;

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

  test("빈 이력 응답도 meta의 표본 수와 build 계보 자리를 요구한다", () => {
    const parsed = organizationAuctionAttemptsV1ResponseSchema.parse({
      organizationId: "42",
      attempts: [],
      nextCursor: null,
      meta: EMPTY_META,
    });
    expect(parsed.attempts).toHaveLength(0);
    // 활성 build가 아직 없는 상태는 오류가 아니라 계보 전체가 null인 정상 응답이다(ADR 0034).
    expect(parsed.meta.buildId).toBeNull();
  });

  test("meta는 요청 품목 echo를 요구하고 품목 없는 조회는 null이다", () => {
    const meta = organizationAuctionAttemptsV1ResponseSchema.shape.meta;
    expect(meta.parse({ ...EMPTY_META, sampleCount: 3, item: "7" }).item).toBe("7");
    const { item: _omitted, ...withoutItem } = EMPTY_META;
    expect(() => meta.parse({ ...withoutItem, sampleCount: 3 })).toThrow();
    expect(() => meta.parse({ ...EMPTY_META, sampleCount: 3, item: "0" })).toThrow();
  });

  test("meta는 build 계보를 build id와 봉인된 release id로 싣고 martRelease를 거부한다", () => {
    const meta = organizationAuctionAttemptsV1ResponseSchema.shape.meta;
    const lineage = {
      ...EMPTY_META,
      sampleCount: 12,
      buildId: "501",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r1",
      computedAt: "2026-09-04T00:00:00Z",
      coverage: "unknown",
      regionScheme: "eat:auction-location-sigungu",
    };
    expect(meta.parse(lineage)).toEqual(lineage);
    // 이름이 둘이 되면 어느 쪽이 권위인지 알 수 없다. 옛 이름은 계약이 거부한다.
    expect(() => meta.parse({ ...lineage, martRelease: "2026-09-04T00" })).toThrow();
    // release id는 소문자 canonical UUID만 받는다.
    expect(() => meta.parse({ ...lineage, sourceReleaseId: "0F5F5D3C-6A1B-4F2E-9C8D-1A2B3C4D5E6F" })).toThrow();
    expect(() => meta.parse({ ...lineage, coverage: "unclear" })).toThrow();
  });

  test("품목 라벨은 512자까지 허용하고 그보다 길면 거부한다", () => {
    const attempt = organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element;
    const row = {
      attemptId: "5796468", announcedAt: "2026-09-01T00:00:00Z", openedAt: null,
      item: { codeValueId: "7", label: "가".repeat(512) },
      floorRate: null, baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: null, secondRate: null, awardedBidRate: null, dayFloorRate: null,
      listCount: null, belowDayFloorCount: null,
      winnerSupplierPartyId: null, supersedesAttemptId: null,
    };
    expect(attempt.parse(row).item?.label).toHaveLength(512);
    expect(() => attempt.parse({ ...row, item: { codeValueId: "7", label: "가".repeat(513) } })).toThrow();
  });

  test("회차 행은 비율 단위와 금액 통화를 강제한다", () => {
    const row = {
      attemptId: "5796468", announcedAt: "2026-09-01T00:00:00Z", openedAt: "2026-09-04T05:00:00Z",
      item: { codeValueId: "7", label: "축산" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: { value: "90.309", unit: "percentage-points" },
      secondRate: null, awardedBidRate: null, dayFloorRate: null, listCount: 17, belowDayFloorCount: 2,
      winnerSupplierPartyId: "9", supersedesAttemptId: null,
    };
    expect(organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse(row)).toEqual(row);
    expect(() => organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse({ ...row, winRate: 90.309 })).toThrow();
    expect(() => organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse({
      ...row,
      baseAmount: { amount: "2761700.00", currency: "USD" },
    })).toThrow();
  });

  test("그날 하한은 투찰률 축이라 넷째 자리를 손실 없이 담고 셋째 자리 값을 거부한다", () => {
    const attempt = organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element;
    const row = {
      attemptId: "5796468", announcedAt: "2026-09-01T00:00:00Z", openedAt: "2026-09-04T05:00:00Z",
      item: null, floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "8888360.00", currency: "KRW" },
      winRate: null, secondRate: null, awardedBidRate: null,
      // 남산초 5669545의 그날 하한이다. 셋째 자리로 끊으면 89.959가 되어 원본의 넷째 자리를 잃는다.
      dayFloorRate: { value: "89.9592", unit: "percentage-points" },
      listCount: 91, belowDayFloorCount: 46,
      winnerSupplierPartyId: null, supersedesAttemptId: null,
    };
    expect(attempt.parse(row).dayFloorRate?.value).toBe("89.9592");
    expect(() => attempt.parse({ ...row, dayFloorRate: { value: "89.959", unit: "percentage-points" } })).toThrow();
  });

  test("낙찰률은 사정률 축과 투찰률 축 두 필드로 나뉘고 서로의 정밀도를 받지 않는다", () => {
    const attempt = organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element;
    // 남산초 5780681이다. 같은 낙찰 하나가 사정률 축에서는 90.010, 투찰률 축에서는 89.8460이다.
    const row = {
      attemptId: "5780681", announcedAt: "2026-08-10T00:00:00Z", openedAt: "2026-08-13T04:00:00Z",
      item: { codeValueId: "7", label: "축산" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "4986290.00", currency: "KRW" },
      winRate: { value: "90.010", unit: "percentage-points" },
      secondRate: { value: "90.032", unit: "percentage-points" },
      awardedBidRate: { value: "89.8460", unit: "percentage-points" },
      dayFloorRate: { value: "89.8360", unit: "percentage-points" },
      listCount: 86, belowDayFloorCount: 42,
      winnerSupplierPartyId: null, supersedesAttemptId: null,
    };
    expect(attempt.parse(row)).toEqual(row);
    // 투찰률 축은 그날 하한과 같은 넷째 자리다. 셋째 자리를 받으면 손잡이 판정이 하한과 다른
    // 정밀도로 비교되므로 거부한다.
    expect(() => attempt.parse({ ...row, awardedBidRate: { value: "89.846", unit: "percentage-points" } })).toThrow();
    // 예정가격이 아직 관측되지 않은 회차는 축을 옮길 입력이 없어 null이며 그것은 정상 상태다.
    expect(attempt.parse({ ...row, awardedBidRate: null }).awardedBidRate).toBeNull();
  });
});
