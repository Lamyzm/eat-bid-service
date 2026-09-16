import { describe, expect, test } from "bun:test";
import { AUCTION_ITEM_ATOMS } from "../../../values/auction-item";
import { openAuctionItemCountSchema, openAuctionRegionCountSchema, openAuctionSummaryV1ResponseSchema } from "./summarize-open-auctions.response";

const region = { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" };

const response = {
  totalCount: 3,
  organizationCount: 2,
  tabs: { openedToday: null, closingToday: 1 },
  announcedUnobservedCount: 3,
  floorShares: [{ rate: { value: "90.000", unit: "percentage-points" }, count: 3 }],
  sidoCounts: [{ region, count: 3 }],
  sigunguCounts: [],
  regionUnobservedCount: 0,
  itemCounts: AUCTION_ITEM_ATOMS.map((item) => ({ item, count: item === "육류" ? 2 : 0 })),
  itemUnobservedCount: 1,
  calendar: [{ date: "2026-09-16", count: 1, releasedCount: 2 }],
  latestObservedAt: "2026-09-16T00:30:00Z",
  nextClosingDay: { date: "2026-09-16", count: 1 },
  meta: {
    asOf: "2026-09-16T01:00:00Z",
    calendarFrom: "2026-09-16",
    calendarTo: "2026-09-16",
    openAuctionSnapshotBuild: {
      buildId: "601",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r2",
      computedAt: "2026-09-16T00:10:00Z",
      coverage: "partial",
      regionScheme: "eat:auction-location-sigungu",
    },
  },
};

describe("열린 공고 요약 응답 계약의 조건 기둥 배지", () => {
  test("시도·시군구·품목 배지가 더해진 응답을 받아들이고 라벨 없는 지역도 항목으로 남긴다", () => {
    expect(openAuctionSummaryV1ResponseSchema.parse(response)).toEqual(response);
    expect(openAuctionRegionCountSchema.parse({ region: { ...region, label: null }, count: 0 }).region.label).toBeNull();
  });

  test("품목 배지는 여덟 원자 전부여야 하고 어휘 밖 조각이나 묶음은 거부한다", () => {
    // 항목이 빠지면 화면이 "오늘 없다"와 "어휘에 없다"를 가르지 못한다.
    expect(openAuctionSummaryV1ResponseSchema.safeParse({ ...response, itemCounts: response.itemCounts.slice(1) }).success).toBe(false);
    // `축산`은 육류+가금류 묶음이라 어휘에 없다. 묶음을 받는 순간 그 정의를 우리가 소유한다.
    expect(openAuctionItemCountSchema.safeParse({ item: "축산", count: 1 }).success).toBe(false);
    expect(openAuctionItemCountSchema.safeParse({ item: "육류", count: -1 }).success).toBe(false);
  });
});
