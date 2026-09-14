import type { OpenAuction, OpenAuctionListV1Response, OpenAuctionSummaryV1Response } from '@eatbid/contracts/api/v1/auctions';

/** 오늘 화면 테스트가 같은 공개 계약 예시를 공유하는 fixture다. 기준 시각은 KST 2026-09-07 10:30이다. */
export const fixtureNow = '2026-09-07T01:30:00Z';

const lineage = {
  buildId: '601',
  sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
  calcVersion: 'mart-r2',
  computedAt: '2026-09-07T01:00:00Z',
  coverage: 'unknown',
  regionScheme: 'eat:auction-location-sigungu'
} as const;

export const nullLineage = {
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null
} as const;

const eligibilityAreas = [
  { codeValueId: '9101', code: '15000', scheme: 'eat:eligibility-area', label: '경남/전체' },
  { codeValueId: '9102', code: '15653', scheme: 'eat:eligibility-area', label: '경남/김해시' }
] as const;

const region = {
  sido: { codeValueId: '41', code: '48', scheme: 'eat:auction-location-sido', label: '경상남도' },
  sigungu: { codeValueId: '43', code: '48120', scheme: 'eat:auction-location-sigungu', label: '창원시' }
} as const;

export const todayRow: OpenAuction = {
  auctionAttemptId: '5796468',
  organization: { organizationId: '3101', label: '창원 남산초등학교', type: 'unknown' },
  itemLabel: '축산',
  floorRate: { value: '90.000', unit: 'percentage-points' },
  region,
  eligibilityAreas: [...eligibilityAreas],
  termsRevisionId: '5796469',
  // KST 2026-09-07 20:00 — 오늘 마감.
  closesAt: '2026-09-07T11:00:00Z',
  baseAmount: { amount: '2761700.00', currency: 'KRW' },
  bidCount: 5,
  observedAt: '2026-09-07T01:00:00Z',
  sourceLastChangedAt: null,
  orgSummary: {
    attemptCount: 17,
    medianListCount: 5,
    listCountSampleCount: 12,
    lastRound: {
      auctionAttemptId: '5780681',
      openedAt: '2026-09-02T02:00:00Z',
      awardedBidRate: { value: '88.3020', unit: 'percentage-points' },
      dayFloorBidRate: { value: '88.0350', unit: 'percentage-points' },
      listCount: 17,
      belowDayFloorCount: 2
    }
  }
};

export const tomorrowRow: OpenAuction = {
  ...todayRow,
  auctionAttemptId: '5796470',
  organization: { organizationId: '3102', label: null, type: 'school' },
  itemLabel: '농산',
  // KST 2026-09-08 00:30 — UTC로는 같은 날(09-07 15:30)이지만 KST로 내일이다.
  closesAt: '2026-09-07T15:30:00Z',
  baseAmount: { amount: '43879200.00', currency: 'KRW' },
  bidCount: null,
  orgSummary: { attemptCount: 3, medianListCount: null, listCountSampleCount: 0, lastRound: null }
};

export const laterRow: OpenAuction = {
  ...todayRow,
  auctionAttemptId: '5796471',
  organization: null,
  itemLabel: null,
  floorRate: null,
  region: null,
  // 제한지역을 관측하지 못한 행이다. 화면이 이 상태를 "제한 없음"으로 바꿔 말하지 않는지, 그리고 상태
  // 색을 빌려 쓰지 않는지를 이 행이 검사한다(ADR 0048 결정 3).
  eligibilityAreas: null,
  termsRevisionId: null,
  // KST 2026-09-10 11:00.
  closesAt: '2026-09-10T02:00:00Z',
  baseAmount: null,
  bidCount: 0,
  orgSummary: null
};

export const unknownClosesRow: OpenAuction = {
  ...laterRow,
  auctionAttemptId: '5796472',
  closesAt: null
};

export const openAuctionsFixture: OpenAuctionListV1Response = {
  auctions: [todayRow, tomorrowRow, laterRow, unknownClosesRow],
  nextCursor: null,
  meta: {
    sampleCount: 4,
    asOf: fixtureNow,
    sido: null,
    sigungu: null,
    eligibilityArea: null,
    eligibilityMatchedCount: null,
    eligibilityUnobservedCount: null,
    items: null,
    closesWithinHours: null,
    closesOn: null,
    announcedOn: null,
    baseAmountMin: null,
    baseAmountMax: null,
    openAuctionSnapshotBuild: lineage,
    orgRoundSummaryBuild: { ...lineage, buildId: '501', calcVersion: 'mart-r1', regionScheme: null }
  }
};

export const noSnapshotFixture: OpenAuctionListV1Response = {
  auctions: [],
  nextCursor: null,
  meta: { ...openAuctionsFixture.meta, sampleCount: 0, openAuctionSnapshotBuild: nullLineage, orgRoundSummaryBuild: nullLineage }
};

/**
 * 요약 fixture다. 기준일 2026-09-07(월)이라 달력 창은 09-07~09-20 열네 칸이고 지나간 칸이 없다.
 * 게시일은 한 건도 관측되지 않은 build를 재현한다 — `오늘 열린`이 0이 아니라 null인 경우다.
 */
export const openSummaryFixture: OpenAuctionSummaryV1Response = {
  totalCount: 4,
  organizationCount: 2,
  tabs: { openedToday: null, closingToday: 1 },
  announcedUnobservedCount: 4,
  floorShares: [
    { rate: { value: '90.000', unit: 'percentage-points' }, count: 2 },
    { rate: null, count: 2 }
  ],
  calendar: [
    { date: '2026-09-07', count: 1, releasedCount: 3 },
    { date: '2026-09-08', count: 1, releasedCount: 2 },
    { date: '2026-09-09', count: 0, releasedCount: 0 },
    { date: '2026-09-10', count: 2, releasedCount: 5 },
    { date: '2026-09-11', count: 0, releasedCount: 0 },
    { date: '2026-09-12', count: 0, releasedCount: 0 },
    { date: '2026-09-13', count: 0, releasedCount: 0 },
    { date: '2026-09-14', count: 0, releasedCount: 0 },
    { date: '2026-09-15', count: 0, releasedCount: 0 },
    { date: '2026-09-16', count: 0, releasedCount: 0 },
    { date: '2026-09-17', count: 0, releasedCount: 0 },
    { date: '2026-09-18', count: 0, releasedCount: 0 },
    { date: '2026-09-19', count: 0, releasedCount: 0 },
    { date: '2026-09-20', count: 0, releasedCount: 0 }
  ],
  latestObservedAt: '2026-09-07T01:00:00Z',
  nextClosingDay: { date: '2026-09-07', count: 1 },
  meta: {
    asOf: fixtureNow,
    calendarFrom: '2026-09-07',
    calendarTo: '2026-09-20',
    openAuctionSnapshotBuild: lineage
  }
};
