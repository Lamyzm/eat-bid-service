import { describe, expect, test } from "bun:test";
import { openAuctionListV1ResponseSchema } from "@eatbid/contracts";
import { baseRelativeBidRate, bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import type { OpenAuctionPage, OpenAuctionQuery, OpenAuctionRecord } from "../../application/open-auction-reader";
import { toOpenAuctionListResponse } from "./open-auction.presenter";

const record: OpenAuctionRecord = {
  auctionAttemptId: 5_796_468n,
  organization: { organizationId: 3_101n, label: "창원 남산초등학교", type: "unknown" },
  itemLabel: "축산",
  title: "축산물 구매",
  displayBidNo: "2026-0001",
  soloBidMethod: { codeValueId: 77n, code: "002", scheme: "eat:solo-bid-method", label: "단독입찰 허용안함" },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  region: {
    sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
    sigungu: null,
  },
  eligibilityAreas: [
    { codeValueId: 9_101n, code: "15000", scheme: "eat:eligibility-area", label: "경남/전체" },
    { codeValueId: 9_102n, code: "15653", scheme: "eat:eligibility-area", label: "경남/김해시" },
  ],
  termsRevisionId: 5_796_469n,
  closesAt: Temporal.Instant.from("2026-09-08T02:00:00Z"),
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  bidCount: 5,
  observedAt: Temporal.Instant.from("2026-09-07T00:30:00Z"),
  sourceLastChangedAt: null,
  orgSummary: {
    attemptCount: 17,
    medianListCount: 5,
    listCountSampleCount: 12,
    lastRound: {
      auctionAttemptId: 5_780_681n,
      openedAt: Temporal.Instant.from("2026-09-02T02:00:00Z"),
      // 같은 낙찰의 투찰률 축 표현이다. 사정률과 값이 다른 것이 축이 다르다는 증거다.
      awardedBidRate: baseRelativeBidRate(canonicalDecimal("88.3020", 4)),
      dayFloorBidRate: baseRelativeBidRate(canonicalDecimal("88.0350", 4)),
      listCount: 17,
      belowDayFloorCount: 2,
    },
  },
};

const lineage: MartBuildLineage = {
  buildId: 601n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r2",
  computedAt: Temporal.Instant.from("2026-09-07T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
};

const nullLineageWire = {
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null,
};

const query: OpenAuctionQuery = {
  asOf: Temporal.Instant.from("2026-09-07T01:30:00Z"),
  sidoCodeValueId: null,
  sigunguCodeValueIds: null,
  includeUnknownRegion: false,
  eligibilityAreaCodeValueIds: null,
  itemAtoms: null,
  includeUnknownItem: false,
  searchText: null,
  onlyWithoutBids: false,
  closesWithinHours: null,
  closesOnKst: null,
  announcedOnKst: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null,
  limit: 50,
};

function pageOf(overrides: Partial<OpenAuctionPage>): OpenAuctionPage {
  return {
    auctions: [],
    nextCursor: null,
    sampleCount: 0,
    eligibilityMatchedCount: 0,
    eligibilityUnobservedCount: 0,
    snapshotLineage: null,
    orgSummaryLineage: null,
    ...overrides,
  };
}

describe("열린 공고 목록 presenter", () => {
  test("스냅샷 행과 기관 요약을 공개 응답으로 직렬화하고 meta에 두 build의 계보를 이름 붙여 싣는다", () => {
    const response = toOpenAuctionListResponse({
      query,
      page: pageOf({
        auctions: [record],
        nextCursor: 5_796_468n,
        sampleCount: 70,
        snapshotLineage: lineage,
        orgSummaryLineage: { ...lineage, buildId: 501n, calcVersion: "mart-r1" },
      }),
    });
    expect(openAuctionListV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.nextCursor).toBe("5796468");
    expect(response.auctions).toEqual([{
      auctionAttemptId: "5796468",
      organization: { organizationId: "3101", label: "창원 남산초등학교", type: "unknown" },
      itemLabel: "축산",
      title: "축산물 구매",
      displayBidNo: "2026-0001",
      soloBidMethod: { codeValueId: "77", code: "002", scheme: "eat:solo-bid-method", label: "단독입찰 허용안함" },
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
    }]);
    expect(response.meta).toEqual({
      sampleCount: 70,
      asOf: "2026-09-07T01:30:00Z",
      sido: null,
      sigungu: null,
      eligibilityArea: null,
      eligibilityMatchedCount: null,
      eligibilityUnobservedCount: null,
      items: null,
      itemUnknown: null,
      regionUnknown: null,
      q: null,
      bidState: null,
      closesWithinHours: null,
      closesOn: null,
      announcedOn: null,
      baseAmountMin: null,
      baseAmountMax: null,
      openAuctionSnapshotBuild: {
        buildId: "601",
        sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
        calcVersion: "mart-r2",
        computedAt: "2026-09-07T00:10:00Z",
        coverage: "unknown",
        regionScheme: "eat:auction-location-sigungu",
      },
      orgRoundSummaryBuild: {
        buildId: "501",
        sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
        calcVersion: "mart-r1",
        computedAt: "2026-09-07T00:10:00Z",
        coverage: "unknown",
        regionScheme: "eat:auction-location-sigungu",
      },
    });
  });

  test("활성 build가 없으면 계보 둘이 모두 null이고 스냅샷 build만 있으면 기관 요약 계보만 null이다", () => {
    const none = toOpenAuctionListResponse({ query, page: pageOf({}) });
    expect(none.auctions).toEqual([]);
    expect(none.meta.openAuctionSnapshotBuild).toEqual(nullLineageWire);
    expect(none.meta.orgRoundSummaryBuild).toEqual(nullLineageWire);

    const snapshotOnly = toOpenAuctionListResponse({
      query,
      page: pageOf({ auctions: [{ ...record, orgSummary: null }], sampleCount: 1, snapshotLineage: lineage }),
    });
    expect(snapshotOnly.meta.openAuctionSnapshotBuild.buildId).toBe("601");
    expect(snapshotOnly.meta.orgRoundSummaryBuild).toEqual(nullLineageWire);
    expect(snapshotOnly.auctions[0]!.orgSummary).toBeNull();
  });

  test("기관을 찾지 못한 스냅샷 행은 organization이 null이고 상세 파생값도 null 그대로다", () => {
    const response = toOpenAuctionListResponse({
      query,
      page: pageOf({
        auctions: [{
          ...record,
          organization: null,
          orgSummary: null,
          region: null,
          eligibilityAreas: null,
          itemLabel: null,
          title: null,
          displayBidNo: null,
          soloBidMethod: null,
          floorRate: null,
          termsRevisionId: null,
        }],
        sampleCount: 1,
        snapshotLineage: lineage,
        orgSummaryLineage: lineage,
      }),
    });
    expect(openAuctionListV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.auctions[0]).toMatchObject({
      organization: null,
      orgSummary: null,
      region: null,
      itemLabel: null,
      title: null,
      displayBidNo: null,
      soloBidMethod: null,
      floorRate: null,
      termsRevisionId: null,
    });
  });

  test("meta는 요청 필터를 그대로 되돌려 실어 표본 수의 코호트를 응답만으로 닫는다", () => {
    const response = toOpenAuctionListResponse({
      query: {
        ...query,
        sidoCodeValueId: 41n,
        sigunguCodeValueIds: [43n, 44n],
        itemAtoms: ["육류", "가금류"],
        searchText: "남산",
        closesOnKst: "2026-09-07",
        baseAmountMin: "2000000.00",
        baseAmountMax: "3000000.00",
        limit: 20,
      },
      page: pageOf({ snapshotLineage: lineage, orgSummaryLineage: lineage }),
    });
    expect(response.meta).toMatchObject({
      sampleCount: 0,
      // 지역 축이 2단이라 시도와 시군구가 따로 실린다. 하나로 합치면 "경남 전체"와 "경남의 두 시"가
      // 응답에서 같은 모양이 된다.
      sido: "41",
      sigungu: ["43", "44"],
      items: ["육류", "가금류"],
      q: "남산",
      closesOn: "2026-09-07",
      closesWithinHours: null,
      baseAmountMin: "2000000.00",
      baseAmountMax: "3000000.00",
    });
  });

  test("참가제한지역 필터를 걸면 표본 수가 매칭과 미관측으로 나뉘어 실린다", () => {
    const response = toOpenAuctionListResponse({
      query: { ...query, eligibilityAreaCodeValueIds: [9_102n, 9_101n] },
      page: pageOf({
        sampleCount: 16,
        eligibilityMatchedCount: 9,
        eligibilityUnobservedCount: 7,
        snapshotLineage: lineage,
        orgSummaryLineage: lineage,
      }),
    });
    expect(response.meta).toMatchObject({
      sampleCount: 16,
      eligibilityArea: ["9102", "9101"],
      eligibilityMatchedCount: 9,
      eligibilityUnobservedCount: 7,
    });
    // 두 수의 합이 표시 표본이다. 미관측을 매칭에 섞으면 화면 문장이 거짓이 된다.
    expect(response.meta.eligibilityMatchedCount! + response.meta.eligibilityUnobservedCount!)
      .toBe(response.meta.sampleCount);
  });

  test("필터가 없으면 분해 수를 0이 아니라 null로 실어 묻지 않은 것과 없는 것을 구분한다", () => {
    const response = toOpenAuctionListResponse({
      query,
      page: pageOf({ sampleCount: 3, eligibilityUnobservedCount: 2, snapshotLineage: lineage }),
    });
    expect(response.meta.eligibilityArea).toBeNull();
    expect(response.meta.eligibilityMatchedCount).toBeNull();
    expect(response.meta.eligibilityUnobservedCount).toBeNull();
  });
});
