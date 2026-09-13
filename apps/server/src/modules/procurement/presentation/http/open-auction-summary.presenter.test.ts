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
  itemLabel: null,
  baseAmountMin: null,
  baseAmountMax: null,
  calendarFrom: "2026-09-14",
  calendarTo: "2026-09-16",
};

const summary: OpenAuctionSummaryRecord = {
  totalCount: 11,
  organizationCount: 11,
  openedTodayCount: 0,
  closingTodayCount: 2,
  floorShares: [
    { rate: bidRate(canonicalDecimal("90.000", 3)), count: 9 },
    { rate: null, count: 2 },
  ],
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
});
