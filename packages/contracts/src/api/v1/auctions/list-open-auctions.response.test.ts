import { describe, expect, test } from "bun:test";
import { auctionV1Operations } from "./operations";
import { openAuctionListQuerySchema } from "./list-open-auctions.query";
import { openAuctionListMetaSchema, openAuctionListV1ResponseSchema } from "./list-open-auctions.response";
import { openAuctionRowSchema } from "./open-auction.resource";
import { openAuctionSummaryQuerySchema } from "./summarize-open-auctions.query";

const nullLineage = {
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null,
};

const lineage = {
  buildId: "601",
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r2",
  computedAt: "2026-09-07T01:00:00Z",
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
};

const row = {
  auctionAttemptId: "5796468",
  organization: { organizationId: "3101", label: "창원 남산초등학교", type: "unknown" },
  itemLabel: "축산",
  displayBidNo: "2026-0001",
  floorRate: { value: "90.000", unit: "percentage-points" },
  region: {
    sido: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
    sigungu: null,
  },
  eligibilityAreas: [
    { codeValueId: "9101", code: "15000", scheme: "eat:eligibility-area", label: "경남/전체" },
    { codeValueId: "9102", code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" },
  ],
  termsRevisionId: "5796469",
  closesAt: "2026-09-08T02:00:00Z",
  baseAmount: { amount: "2761700.00", currency: "KRW" },
  bidCount: 5,
  observedAt: "2026-09-07T00:30:00Z",
  sourceLastChangedAt: null,
  orgSummary: {
    attemptCount: 17,
    medianListCount: 5,
    listCountSampleCount: 12,
    lastRound: {
      auctionAttemptId: "5780681",
      openedAt: "2026-09-02T02:00:00Z",
      awardedBidRate: { value: "88.3020", unit: "percentage-points" },
      dayFloorBidRate: { value: "88.0350", unit: "percentage-points" },
      listCount: 17,
      belowDayFloorCount: 2,
    },
  },
};

const meta = {
  sampleCount: 1,
  asOf: "2026-09-07T01:30:00Z",
  sido: null,
  sigungu: null,
  eligibilityArea: null,
  eligibilityMatchedCount: null,
  eligibilityUnobservedCount: null,
  items: null,
  itemUnknown: null,
  q: null,
  bidState: null,
  closesWithinHours: null,
  closesOn: null,
  announcedOn: null,
  baseAmountMin: null,
  baseAmountMax: null,
  openAuctionSnapshotBuild: lineage,
  orgRoundSummaryBuild: lineage,
};

describe("열린 공고 목록 계약", () => {
  /**
   * 표본 `meta`가 계약의 모든 키를 덮는지 본다. 축을 하나 더할 때 이 표본을 빠뜨리면 나머지 시험들이
   * **옛 모양 위에서** 통과해 버리고, 깨지는 자리는 계약이 아니라 한참 뒤의 브라우저 검증이 된다
   * (2026-09-15 `itemUnknown`·`bidState`가 그랬다).
   */
  test("표본 meta는 계약이 요구하는 키를 하나도 빠뜨리지 않는다", () => {
    expect(Object.keys(meta).toSorted()).toEqual(Object.keys(openAuctionListMetaSchema.shape).toSorted());
  });

  test("열린 공고 목록 응답은 계보 둘을 각각 전부 null로 허용한다", () => {
    const parsed = openAuctionListV1ResponseSchema.safeParse({
      auctions: [],
      nextCursor: null,
      meta: { ...meta, sampleCount: 0, openAuctionSnapshotBuild: nullLineage, orgRoundSummaryBuild: nullLineage },
    });
    expect(parsed.success).toBe(true);
    // 두 계보는 서로 독립이다. 한쪽만 활성 build가 있는 상태가 실제로 있다.
    expect(openAuctionListV1ResponseSchema.safeParse({
      auctions: [row],
      nextCursor: "5796468",
      meta: { ...meta, orgRoundSummaryBuild: nullLineage },
    }).success).toBe(true);
  });

  test("열린 공고 행은 기관 없음과 기관 이름 미확인을 다른 값으로 구분한다", () => {
    expect(openAuctionRowSchema.safeParse({ ...row, organization: null, orgSummary: null }).success).toBe(true);
    expect(openAuctionRowSchema.safeParse({
      ...row,
      organization: { organizationId: "3101", label: null, type: "unknown" },
    }).success).toBe(true);
    // 빈 문자열 라벨은 관측이 아니다. null이어야 한다.
    expect(openAuctionRowSchema.safeParse({
      ...row,
      organization: { organizationId: "3101", label: "", type: "unknown" },
    }).success).toBe(false);
  });

  test("상세 파생 열 셋이 비면 계보도 비어야 하고 기관 요약의 최근 회차는 null일 수 있다", () => {
    expect(openAuctionRowSchema.safeParse({
      ...row,
      itemLabel: null,
      floorRate: null,
      region: null,
      eligibilityAreas: null,
      termsRevisionId: null,
      orgSummary: { attemptCount: 0, medianListCount: null, listCountSampleCount: 0, lastRound: null },
    }).success).toBe(true);
    // 사정률 축(3자리)을 투찰률 축(4자리) 자리에 실으면 거부된다(AGENTS 15).
    expect(openAuctionRowSchema.safeParse({
      ...row,
      orgSummary: {
        ...row.orgSummary,
        lastRound: { ...row.orgSummary.lastRound, awardedBidRate: { value: "88.302", unit: "percentage-points" } },
      },
    }).success).toBe(false);
  });

  test("query는 state=open만 받고 알 수 없는 key를 거부한다", () => {
    expect(openAuctionListQuerySchema.parse({})).toEqual({ state: "open", limit: 50 });
    expect(openAuctionListQuerySchema.safeParse({ state: "closed" }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ sort: "closesAt" }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ sido: "0" }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ items: [""] }).success).toBe(false);
    // 조각 열일곱은 관측된 라벨 가짓수보다 많다. 상한이 열여섯인 이유는 한 행이 가진 최대 조각 수의 두 배다.
    expect(openAuctionListQuerySchema.safeParse({
      items: Array.from({ length: 17 }, (_, index) => `조각${index}`),
    }).success).toBe(false);
    // query string은 값 하나와 값 여럿을 구분하지 못한다. 파싱 직전에 한 번만 배열로 편다.
    expect(openAuctionListQuerySchema.parse({ items: "육류" }).items).toEqual(["육류"]);
    // 시군구는 값 하나로 와도 배열로 펴진다. query string이 하나와 여럿을 구분하지 못하기 때문이다.
    expect(openAuctionListQuerySchema.parse({ sido: "41", sigungu: "43" }).sigungu).toEqual(["43"]);
    // KST 달력일은 형식이 고정이다. `2026-9-7` 같은 값은 날짜처럼 보여도 계약이 받지 않는다.
    expect(openAuctionListQuerySchema.safeParse({ closesOn: "2026-9-7" }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ closesOn: "2026-09-07" }).success).toBe(true);
  });

  test("참가제한지역 필터는 값 하나와 값 여럿을 같은 배열로 편다", () => {
    // query string은 `?eligibilityArea=9102` 하나를 문자열로, 둘 이상을 배열로 준다. 계약이 그 차이를
    // 흡수하지 않으면 코드 하나를 고른 사용자와 둘을 고른 사용자가 서로 다른 경로를 탄다.
    expect(openAuctionListQuerySchema.parse({ eligibilityArea: "9102" }).eligibilityArea).toEqual(["9102"]);
    expect(openAuctionListQuerySchema.parse({ eligibilityArea: ["9102", "9101"] }).eligibilityArea)
      .toEqual(["9102", "9101"]);
    expect(openAuctionListQuerySchema.parse({}).eligibilityArea).toBeUndefined();
    expect(openAuctionListQuerySchema.safeParse({ eligibilityArea: [] }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ eligibilityArea: ["0"] }).success).toBe(false);
  });

  test("검색어는 양끝 공백을 걷어 내고 빈 값과 65자를 거부한다", () => {
    expect(openAuctionListQuerySchema.parse({ q: "  남산초  " }).q).toBe("남산초");
    expect(openAuctionListQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ q: "가".repeat(65) }).success).toBe(false);
    // 요약도 같은 atom을 받는다. 한쪽만 받으면 검색 중에 탭·달력이 표와 다른 집합을 센다.
    expect(openAuctionSummaryQuerySchema.parse({ q: "남산초", calendarFrom: "2026-09-07", calendarTo: "2026-09-10" }).q).toBe("남산초");
  });

  test("closesWithinHours는 0과 721을 거부하고 1과 720을 받는다", () => {
    expect(openAuctionListQuerySchema.safeParse({ closesWithinHours: "0" }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ closesWithinHours: "721" }).success).toBe(false);
    expect(openAuctionListQuerySchema.parse({ closesWithinHours: "1" }).closesWithinHours).toBe(1);
    expect(openAuctionListQuerySchema.parse({ closesWithinHours: "720" }).closesWithinHours).toBe(720);
  });

  test("기초금액 경계는 소수 둘째 자리 고정 문자열만 받는다", () => {
    expect(openAuctionListQuerySchema.safeParse({ baseAmountMin: "2000000.00" }).success).toBe(true);
    expect(openAuctionListQuerySchema.safeParse({ baseAmountMin: "2000000" }).success).toBe(false);
    expect(openAuctionListQuerySchema.safeParse({ baseAmountMax: "2,000,000.00" }).success).toBe(false);
  });

  test("operation buildPath는 /api/v1/auctions와 정렬된 query string을 만든다", () => {
    expect(auctionV1Operations.listOpen.path).toBe("/api/v1/auctions");
    expect(auctionV1Operations.listOpen.handlerPath).toBe("");
    expect(auctionV1Operations.listOpen.buildPath({ path: {} })).toBe("/api/v1/auctions?limit=50&state=open");
    expect(auctionV1Operations.listOpen.buildPath({
      path: {},
      query: { sido: "41", closesWithinHours: 72, cursor: "5796468", items: ["축산"] },
    })).toBe("/api/v1/auctions?closesWithinHours=72&cursor=5796468&items=%EC%B6%95%EC%82%B0&limit=50&sido=41&state=open");
    // 요약은 고정 segment가 path parameter보다 앞이라 `summary`가 공고 id로 먹히지 않는다.
    expect(auctionV1Operations.summarizeOpen.buildPath({
      path: {},
      query: { calendarFrom: "2026-09-07", calendarTo: "2026-09-20", sido: "41" },
    })).toBe("/api/v1/auctions/summary?calendarFrom=2026-09-07&calendarTo=2026-09-20&sido=41&state=open");
    // 응답 schema는 operation이 가리키는 것과 같은 객체다.
    expect(auctionV1Operations.listOpen.successResponses[200].schema).toBe(openAuctionListV1ResponseSchema);
  });
});
