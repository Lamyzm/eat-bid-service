import { describe, expect, test } from "bun:test";
import { openAuctionSummaryV1ResponseSchema } from "@eatbid/contracts";
import { bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import type {
  OpenAuctionSummaryQuery,
  OpenAuctionSummaryRecord,
} from "../../application/open-auction-summary-reader";
import { toOpenAuctionSummaryResponse } from "./open-auction-summary.presenter";

const lineage: MartBuildLineage = {
  buildId: 601n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r2",
  computedAt: Temporal.Instant.from("2026-09-07T00:10:00Z"),
  coverage: "partial",
  regionScheme: "eat:auction-location-sigungu",
};

const query: OpenAuctionSummaryQuery = {
  asOf: Temporal.Instant.from("2026-09-14T01:00:00Z"),
  sidoCodeValueId: null,
  sigunguCodeValueIds: null,
  eligibilityAreaCodeValueIds: null,
  itemLabels: null,
  includeUnknownItem: false,
  baseAmountMin: null,
  baseAmountMax: null,
  calendarFrom: "2026-09-14",
  calendarTo: "2026-09-16",
};

const summary: OpenAuctionSummaryRecord = {
  totalCount: 11,
  organizationCount: 11,
  openedTodayCount: 0,
  announcedUnobservedCount: 0,
  closingTodayCount: 2,
  floorShares: [
    { rate: bidRate(canonicalDecimal("90.000", 3)), count: 9 },
    { rate: null, count: 2 },
  ],
  sidoCounts: [
    { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도", count: 10 },
    // 라벨이 관측되지 않은 시도도 항목으로 남는다. 코드목록 수집 전의 DB가 그렇다(AGENTS 3).
    { codeValueId: 42n, code: "47", scheme: "eat:auction-location-sido", label: null, count: 1 },
  ],
  sigunguCounts: [
    { codeValueId: 43n, code: "48120", scheme: "eat:auction-location-sigungu", label: "창원시", count: 7 },
    { codeValueId: 44n, code: "48250", scheme: "eat:auction-location-sigungu", label: "김해시", count: 3 },
  ],
  regionUnobservedCount: 0,
  itemCounts: [
    { item: "육류", count: 6 }, { item: "가금류", count: 4 }, { item: "농산물", count: 0 }, { item: "수산물", count: 0 },
    { item: "가공식품", count: 1 }, { item: "김치류", count: 0 }, { item: "곡류", count: 0 }, { item: "우유류", count: 0 },
  ],
  itemUnobservedCount: 2,
  calendar: [
    { date: "2026-09-14", count: 2, releasedCount: 7 },
    { date: "2026-09-15", count: 0, releasedCount: 0 },
    { date: "2026-09-16", count: 9, releasedCount: 24 },
  ],
  latestObservedAt: Temporal.Instant.from("2026-09-14T00:30:00Z"),
  nextClosingDay: { date: "2026-09-14", count: 2 },
  snapshotLineage: lineage,
};

describe("열린 공고 요약 presenter", () => {
  test("화면이 세는 자리를 공개 응답으로 직렬화하고 하한율은 값 봉투로 싣는다", () => {
    const response = toOpenAuctionSummaryResponse({ query, summary });

    expect(openAuctionSummaryV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.totalCount).toBe(11);
    expect(response.organizationCount).toBe(11);
    // 관측되지 않은 하한율은 버리지 않고 `rate: null` 항목으로 함께 센다. 합은 언제나 totalCount다.
    expect(response.floorShares).toEqual([
      { rate: { value: "90.000", unit: "percentage-points" }, count: 9 },
      { rate: null, count: 2 },
    ]);
    expect(response.floorShares.reduce((sum, share) => sum + share.count, 0)).toBe(response.totalCount);
    expect(response.latestObservedAt).toBe("2026-09-14T00:30:00Z");
    expect(response.nextClosingDay).toEqual({ date: "2026-09-14", count: 2 });
  });

  test("조건 기둥의 배지는 코드 참조를 문자열 id로 옮기고 라벨 없는 지역과 0건 원자를 지우지 않는다", () => {
    const response = toOpenAuctionSummaryResponse({ query, summary });

    expect(openAuctionSummaryV1ResponseSchema.parse(response)).toEqual(response);
    // bigint id는 wire에서 선행 0 없는 10진 문자열이다(ADR 0018). 라벨이 null인 항목도 그대로 남는다.
    expect(response.sidoCounts).toEqual([
      { region: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" }, count: 10 },
      { region: { codeValueId: "42", code: "47", scheme: "eat:auction-location-sido", label: null }, count: 1 },
    ]);
    expect(response.sigunguCounts.map((entry) => [entry.region.label, entry.count])).toEqual([["창원시", 7], ["김해시", 3]]);
    expect(response.regionUnobservedCount).toBe(0);
    // 여덟 원자가 어휘 순서로 전부 오고 0건도 항목이다. 한 행이 여러 원자를 가지므로 합이 전체보다 클 수 있다.
    expect(response.itemCounts.map((entry) => entry.item)).toEqual(["육류", "가금류", "농산물", "수산물", "가공식품", "김치류", "곡류", "우유류"]);
    expect(response.itemCounts.filter((entry) => entry.count === 0)).toHaveLength(5);
    expect(response.itemUnobservedCount).toBe(2);
  });

  test("진행중 탭 수를 따로 싣지 않고 tabs는 오늘 둘만 말한다", () => {
    const response = toOpenAuctionSummaryResponse({ query, summary });

    // 날짜 축을 받지 않는 요약이라 진행중은 언제나 totalCount와 같다. 같은 수를 두 자리에 실으면
    // 언젠가 한쪽만 고쳐져 탭과 축 줄이 다른 말을 한다.
    expect(response.tabs).toEqual({ openedToday: 0, closingToday: 2 });
    expect(Object.keys(response.tabs)).not.toContain("live");
    // 둘 다 totalCount의 부분집합이며 서로 겹칠 수 있어 합이 전체가 되지 않는다.
    expect(response.tabs.closingToday).toBeLessThanOrEqual(response.totalCount);
  });

  test("달력은 0건인 날을 빼지 않고 창의 날짜를 그대로 싣는다", () => {
    const response = toOpenAuctionSummaryResponse({ query, summary });

    // 0건인 날을 빼면 화면이 "그날은 없다"와 "그날은 창 밖"을 구분하지 못한다. 사용자가 보는 것은
    // 빈 칸이지 없는 칸이다.
    expect(response.calendar.map((day) => day.date)).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
    expect(response.calendar[1]).toEqual({ date: "2026-09-15", count: 0, releasedCount: 0 });
    // 조건을 푼 수가 건 수보다 작을 수 없다. 화면의 `2건 · 7건 중`이 뒤집히면 거짓말이 된다.
    for (const day of response.calendar) {
      expect(day.releasedCount).toBeGreaterThanOrEqual(day.count);
    }
  });

  test("meta는 기준 시각과 달력 창을 되돌려 실어 수치의 코호트를 응답만으로 닫는다", () => {
    const response = toOpenAuctionSummaryResponse({ query, summary });

    expect(response.meta).toEqual({
      asOf: "2026-09-14T01:00:00Z",
      calendarFrom: "2026-09-14",
      calendarTo: "2026-09-16",
      openAuctionSnapshotBuild: {
        buildId: "601",
        sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
        calcVersion: "mart-r2",
        computedAt: "2026-09-07T00:10:00Z",
        coverage: "partial",
        regionScheme: "eat:auction-location-sigungu",
      },
    });
  });

  test("결과가 0건이면 기준 관측과 다음 마감일이 0이 아니라 null이다", () => {
    const response = toOpenAuctionSummaryResponse({
      query,
      summary: {
        ...summary,
        totalCount: 0,
        organizationCount: 0,
        openedTodayCount: 0,
        announcedUnobservedCount: 0,
        closingTodayCount: 0,
        floorShares: [],
        calendar: [{ date: "2026-09-14", count: 0, releasedCount: 0 }],
        latestObservedAt: null,
        nextClosingDay: null,
        snapshotLineage: null,
      },
    });

    expect(openAuctionSummaryV1ResponseSchema.parse(response)).toEqual(response);
    // 0은 "세었는데 없다"이고 null은 "말할 수 없다"이다. 관측이 없으면 "지금"을 말할 수 없다.
    expect(response.latestObservedAt).toBeNull();
    expect(response.nextClosingDay).toBeNull();
    expect(response.totalCount).toBe(0);
    expect(response.meta.openAuctionSnapshotBuild.buildId).toBeNull();
  });
  test('게시일을 한 건도 관측하지 못하면 오늘 열린 수가 0이 아니라 null이다', () => {
    // 게시일은 목록이 주지 않고 상세에서만 온다. 아직 채우지 않은 build에서 0을 실으면 화면이
    // "오늘 새로 뜬 공고가 없다"고 말하지만 사실은 세지 못한 것이다(AGENTS 3).
    const response = toOpenAuctionSummaryResponse({
      query,
      summary: { ...summary, announcedUnobservedCount: summary.totalCount },
    });

    expect(openAuctionSummaryV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.tabs.openedToday).toBeNull();
    expect(response.announcedUnobservedCount).toBe(11);
    // 마감일은 목록 행이 주므로 같은 build에서도 셀 수 있다. 둘을 한꺼번에 못 세는 것으로 묶지 않는다.
    expect(response.tabs.closingToday).toBe(2);
  });

  test('게시일을 일부만 관측했으면 센 수를 그대로 싣고 못 센 수를 함께 낸다', () => {
    const response = toOpenAuctionSummaryResponse({
      query,
      summary: { ...summary, openedTodayCount: 3, announcedUnobservedCount: 4 },
    });

    // 부분 관측을 null로 덮으면 실제로 센 셋이 사라진다. 화면이 `3건 · 게시일 미관측 4건`이라고 말한다.
    expect(response.tabs.openedToday).toBe(3);
    expect(response.announcedUnobservedCount).toBe(4);
  });
});
