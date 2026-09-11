import { describe, expect, test } from "bun:test";
import { mapOpenAuctionRow, type OpenAuctionRow } from "./drizzle-open-auction-reader";

const row: OpenAuctionRow = {
  auction_attempt_id: "5796468",
  organization_id: "3101",
  organization_label: " 창원 남산초등학교 ",
  organization_type: "unknown",
  item_label: "축산",
  floor_rate: "90.000",
  terms_revision_id: "5796469",
  closes_at: "2026-09-08T02:00:00Z",
  base_amount: "2761700.00",
  currency: "KRW",
  bid_count: 5,
  observed_at: new Date("2026-09-07T00:30:00Z"),
  source_last_changed_at: null,
  region_sido_code_value_id: "41",
  region_sido_code: "48",
  region_sido_scheme: "eat:auction-location-sido",
  region_sido_label: "경상남도",
  region_sigungu_code_value_id: null,
  region_sigungu_code: null,
  region_sigungu_scheme: null,
  region_sigungu_label: null,
  eligibility_areas: [
    { code_value_id: "9101", code: "15000", scheme: "eat:eligibility-area", label: "경남/전체" },
    { code_value_id: "9102", code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" },
  ],
  attempt_count: 17,
  median_list_count: 5,
  list_count_sample_count: 12,
  last_round_attempt_id: "5780681",
  last_round_opened_at: "2026-09-02T02:00:00Z",
  last_round_awarded_bid_rate: "88.3020",
  last_round_day_floor_bid_rate: "88.0350",
  last_round_list_count: 17,
  last_round_below_day_floor_count: 2,
};

describe("열린 공고 스냅샷 행 매핑", () => {
  test("driver가 준 timestamp 문자열과 Date를 같은 Instant로 옮기고 라벨 공백을 다듬는다", () => {
    const record = mapOpenAuctionRow(row, true);
    expect(record.auctionAttemptId).toBe(5_796_468n);
    expect(record.observedAt.toString()).toBe("2026-09-07T00:30:00Z");
    expect(record.closesAt!.toString()).toBe("2026-09-08T02:00:00Z");
    expect(record.organization).toEqual({ organizationId: 3_101n, label: "창원 남산초등학교", type: "unknown" });
    expect(record.floorRate).toBe("90.000");
    expect(record.region).toEqual({
      sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
      sigungu: null,
    });
    // 참가제한지역은 공고지역과 다른 체계이며 행이 스스로 그 이름을 싣는다.
    expect(record.eligibilityAreas).toEqual([
      { codeValueId: 9_101n, code: "15000", scheme: "eat:eligibility-area", label: "경남/전체" },
      { codeValueId: 9_102n, code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" },
    ]);
    expect(record.orgSummary).toEqual({
      attemptCount: 17,
      medianListCount: 5,
      listCountSampleCount: 12,
      lastRound: {
        auctionAttemptId: 5_780_681n,
        openedAt: record.orgSummary!.lastRound!.openedAt,
        // 넷째 자리를 반올림하지 않는다. 그날 하한은 이 자리에서만 회차끼리 구분된다.
        awardedBidRate: "88.3020",
        dayFloorBidRate: "88.0350",
        listCount: 17,
        belowDayFloorCount: 2,
      },
    });
  });

  test("금액이 없으면 통화가 있어도 baseAmount는 null이다", () => {
    const record = mapOpenAuctionRow({ ...row, base_amount: null }, true);
    expect(record.baseAmount).toBeNull();
    expect(mapOpenAuctionRow(row, true).baseAmount).toEqual({ amount: "2761700.00", currency: "KRW" });
  });

  test("상세를 아직 따지 않은 행은 품목·하한·지역·계보가 모두 null이고 기관 없는 행은 요약도 없다", () => {
    const record = mapOpenAuctionRow({
      ...row,
      organization_id: null,
      organization_label: null,
      organization_type: null,
      item_label: "   ",
      floor_rate: null,
      terms_revision_id: null,
      region_sido_code_value_id: null,
      region_sido_code: null,
      region_sido_scheme: null,
      region_sido_label: null,
      attempt_count: null,
      median_list_count: null,
      list_count_sample_count: null,
      last_round_attempt_id: null,
      last_round_opened_at: null,
      eligibility_areas: null,
    }, true);
    expect(record.organization).toBeNull();
    expect(record.itemLabel).toBeNull();
    expect(record.floorRate).toBeNull();
    expect(record.region).toBeNull();
    expect(record.termsRevisionId).toBeNull();
    expect(record.orgSummary).toBeNull();
    // 관측하지 못한 제한지역은 빈 배열이 아니라 null이다. 빈 배열은 "제한 없음"으로 읽힌다(AGENTS 3).
    expect(record.eligibilityAreas).toBeNull();
  });

  test("활성 회차 요약 build가 없으면 요약은 null이고 코호트가 빈 회차 0건은 0으로 남는다", () => {
    expect(mapOpenAuctionRow(row, false).orgSummary).toBeNull();
    // 코호트를 만들 수 없는 행(기관 미확인·하한율 미관측)은 SQL이 요약 열을 통째로 null로 돌려준다.
    expect(mapOpenAuctionRow({ ...row, attempt_count: null }, true).orgSummary).toBeNull();
    // 코호트는 있는데 이 하한에서 본 회차가 0건인 것은 셀 수 있는 사실이라 요약 없음과 합치지 않는다.
    expect(mapOpenAuctionRow({
      ...row,
      attempt_count: 0,
      list_count_sample_count: 0,
      median_list_count: null,
      last_round_attempt_id: null,
      last_round_opened_at: null,
    }, true).orgSummary).toEqual({ attemptCount: 0, medianListCount: null, listCountSampleCount: 0, lastRound: null });
    // 회차는 있지만 개찰된 회차가 없으면 최근 회차만 null이다.
    const noRound = mapOpenAuctionRow({ ...row, last_round_attempt_id: null, last_round_opened_at: null }, true);
    expect(noRound.orgSummary).toMatchObject({ attemptCount: 17, lastRound: null });
  });
});
