import { describe, expect, test } from "bun:test";
import { isMoney, Temporal } from "@eatbid/domain";

// 코호트 재료 열만 바꿔 가며 확인하려고 나머지 필수 열을 한 자리에 고정한다.
function cohortRow(overrides: Record<string, unknown>): never {
  return {
    auction_id: "41",
    revision_id: "43",
    title: "Fresh produce supply",
    source_status: "OPEN",
    display_bid_no: null,
    announced_at: "2026-08-30T00:00:00Z",
    deadline_at: null,
    opened_at: null,
    base_amount: "1000.00",
    planned_amount: null,
    currency: "KRW",
    organization_id: "3101",
    organization_name: "창원 남산초등학교",
    organization_type: "school",
    source_system: "eat",
    external_bid_id: "external-opaque-id",
    observation_id: "45",
    normalized_record_id: "47",
    content_sha256: "a".repeat(64),
    floor_rate: null,
    award_method_code_value_id: null,
    award_method_code: null,
    award_method_scheme: null,
    award_method_label: null,
    location_sido_code_value_id: null,
    location_sido_code: null,
    location_sido_scheme: null,
    location_sido_label: null,
    location_sigungu_code_value_id: null,
    location_sigungu_code: null,
    location_sigungu_scheme: null,
    location_sigungu_label: null,
    item_label: null,
    participation_bid_count: null,
    participation_observed_at: null,
    participation_day_earlier_bid_count: null,
    participation_day_earlier_observed_at: null,
    ...overrides,
  } as never;
}

describe("DrizzleAuctionReader row 경계", () => {
  test("전체 database row를 application 값으로 매핑하고 내부 payload는 버린다", async () => {
    const adapter = await import("./drizzle-auction-reader").catch(() => undefined);
    expect(adapter, "Drizzle auction adapter must exist").toBeDefined();
    const record = adapter!.mapAuctionRow(cohortRow({
      auction_id: "9007199254740993",
      revision_id: "9007199254740995",
      announced_at: "2026-08-30T00:00:00.123456789Z",
      deadline_at: new Date("2026-08-30T01:00:00.000Z"),
      base_amount: "1234567890.50",
      organization_id: "7",
      organization_name: "서울특별시교육청",
      organization_type: "education-office",
      observation_id: "9007199254740997",
      normalized_record_id: "9007199254740999",
      source_payload: { mustNotEscape: true },
    }));
    expect(record).toMatchObject({
      auctionId: 9_007_199_254_740_993n,
      revisionId: 9_007_199_254_740_995n,
      title: "Fresh produce supply",
      status: "OPEN",
      displayBidNumber: null,
      openedAt: null,
      organization: { organizationId: 7n, name: "서울특별시교육청", type: "education-office" },
      baseAmount: { amount: "1234567890.50", currency: "KRW" },
      plannedAmount: null,
      provenance: {
        sourceSystem: "eat",
        externalBidId: "external-opaque-id",
        observationId: 9_007_199_254_740_997n,
        normalizedRecordId: 9_007_199_254_740_999n,
        contentSha256: "a".repeat(64),
      },
    });
    expect(record.announcedAt).toBeInstanceOf(Temporal.Instant);
    expect(record.announcedAt.toString()).toBe("2026-08-30T00:00:00.123456789Z");
    expect(record.deadlineAt?.toString()).toBe("2026-08-30T01:00:00Z");
    expect(isMoney(record.baseAmount)).toBe(true);
  });

  test("구매기관 관계가 없는 revision은 organization을 unknown으로 남긴다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const record = adapter.mapAuctionRow(cohortRow({
      organization_id: null,
      organization_name: null,
      organization_type: null,
    }));
    expect(record.organization).toBeNull();
  });

  test("공백뿐인 관측 라벨은 기관 이름을 unknown으로 남긴다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const record = adapter.mapAuctionRow(cohortRow({ organization_name: "   " }));
    expect(record.organization).toEqual({ organizationId: 3101n, name: null, type: "school" });
  });

  test("하한율·낙찰방식·소재지·품목 라벨이 모두 관측된 행을 코드 참조로 매핑한다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const record = adapter.mapAuctionRow(cohortRow({
      floor_rate: "90.000",
      award_method_code_value_id: "31",
      award_method_code: "003",
      award_method_scheme: "eat:award-method",
      award_method_label: "적격심사",
      location_sido_code_value_id: "41",
      location_sido_code: "48",
      location_sido_scheme: "eat:auction-location-sido",
      location_sido_label: "경상남도",
      location_sigungu_code_value_id: "43",
      location_sigungu_code: "48120",
      location_sigungu_scheme: "eat:auction-location-sigungu",
      location_sigungu_label: null,
      item_label: "축산",
    }));
    expect(record.terms).toEqual({
      floorRate: "90.000",
      awardMethod: { codeValueId: 31n, code: "003", scheme: "eat:award-method", label: "적격심사" },
    });
    expect(record.location).toEqual({
      sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
      sigungu: { codeValueId: 43n, code: "48120", scheme: "eat:auction-location-sigungu", label: null },
    });
    expect(record.classification).toEqual({ itemLabel: "축산" });
  });

  test("셋 중 아무것도 관측되지 않은 행은 세 블록을 모두 null로 남긴다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const record = adapter.mapAuctionRow(cohortRow({}));
    expect(record.terms).toBeNull();
    expect(record.location).toBeNull();
    expect(record.classification).toBeNull();
  });

  test("하한율만 관측된 행은 낙찰방식이 없어도 조건 블록을 남긴다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const record = adapter.mapAuctionRow(cohortRow({ floor_rate: "88.000" }));
    expect(record.terms).toEqual({ floorRate: "88.000", awardMethod: null });
    expect(record.location).toBeNull();
  });

  test("공백뿐인 코드 라벨과 품목 라벨은 관측되지 않은 것으로 남긴다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const record = adapter.mapAuctionRow(cohortRow({
      award_method_code_value_id: "31",
      award_method_code: "003",
      award_method_scheme: "eat:award-method",
      award_method_label: "   ",
      item_label: "  ",
    }));
    expect(record.terms).toEqual({
      floorRate: null,
      awardMethod: { codeValueId: 31n, code: "003", scheme: "eat:award-method", label: null },
    });
    // 공백뿐인 라벨은 "관측되지 않았다"이므로 분류 블록 자체가 없다.
    expect(record.classification).toBeNull();
  });

  test("참여 수 최신 관측과 하루 전 관측을 시각과 함께 매핑하고 하루 전이 없으면 null로 남긴다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    const both = adapter.mapAuctionRow(cohortRow({
      participation_bid_count: 4,
      participation_observed_at: "2026-09-03T01:30:00Z",
      participation_day_earlier_bid_count: 2,
      participation_day_earlier_observed_at: new Date("2026-09-02T01:00:00.000Z"),
    }));
    expect(both.participation?.latest.bidCount).toBe(4);
    expect(both.participation?.latest.observedAt.toString()).toBe("2026-09-03T01:30:00Z");
    expect(both.participation?.dayEarlier?.bidCount).toBe(2);
    expect(both.participation?.dayEarlier?.observedAt.toString()).toBe("2026-09-02T01:00:00Z");

    const latestOnly = adapter.mapAuctionRow(cohortRow({
      participation_bid_count: 0,
      participation_observed_at: "2026-09-03T01:30:00Z",
    }));
    expect(latestOnly.participation).toEqual({
      latest: { bidCount: 0, observedAt: Temporal.Instant.from("2026-09-03T01:30:00Z") },
      dayEarlier: null,
    });
  });

  test("목록 스냅샷에 잡힌 적 없는 공고는 참여 블록이 null이고, 수와 시각 중 하나만 있으면 끊는다", async () => {
    const adapter = await import("./drizzle-auction-reader");
    expect(adapter.mapAuctionRow(cohortRow({})).participation).toBeNull();
    expect(() => adapter.mapAuctionRow(cohortRow({ participation_bid_count: 3 }))).toThrow(TypeError);
    expect(() => adapter.mapAuctionRow(cohortRow({ participation_observed_at: "2026-09-03T01:30:00Z" }))).toThrow(TypeError);
  });
});
