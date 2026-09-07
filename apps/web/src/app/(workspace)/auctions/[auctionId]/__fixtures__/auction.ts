import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

/** 공고 화면 테스트가 같은 공개 계약 예시를 공유하도록 유지하는 fixture다. */
export const auctionFixture = {
  identity: {
    auctionId: '9007199254740993',
    revisionId: '9007199254740995',
    externalBidId: 'eat-opaque-id',
    displayBidNumber: 'EAT-2026-0001',
    title: '2026학년도 학교 급식 식재료 구매',
    status: 'OPEN'
  },
  organization: { organizationId: '3101', name: '창원 남산초등학교', type: 'school' },
  schedule: {
    announcedAt: '2026-08-30T00:00:00Z',
    deadlineAt: null,
    openedAt: null
  },
  pricing: {
    baseAmount: { amount: '9007199254740993.50', currency: 'KRW' },
    plannedAmount: null
  },
  provenance: {
    sourceSystem: 'eat',
    observationId: '9007199254740997',
    normalizedRecordId: '9007199254740999',
    contentSha256: 'a'.repeat(64)
  },
  // 코호트 재료다. 하한율 90·낙찰방식 003·경남 창원은 남산초 실관측 회차의 값이다.
  terms: {
    floorRate: { value: '90.000', unit: 'percentage-points' },
    awardMethod: { codeValueId: '31', code: '003', scheme: 'eat:award-method', label: '적격심사' }
  },
  location: {
    sido: { codeValueId: '41', code: '48', scheme: 'eat:auction-location-sido', label: '경상남도' },
    sigungu: { codeValueId: '43', code: '48120', scheme: 'eat:auction-location-sigungu', label: '창원시' }
  },
  classification: { itemLabel: '축산' },
  // 목록 스냅샷에 잡힌 적 없는 공고다. 참여 수는 미확인이어야 한다.
  participation: null
} satisfies AuctionV1Response;

/** 마감·개찰이 관측된 진행 중 공고. 2026-09-03T01:30Z(10:30 KST)에 보면 마감 24시간 30분 전이다. */
export const openAuctionFixture = {
  ...auctionFixture,
  identity: { ...auctionFixture.identity, auctionId: '5796468', revisionId: '5796469', title: '창원 남산초등학교 축산물 구매' },
  schedule: { announcedAt: '2026-09-01T00:00:00Z', deadlineAt: '2026-09-04T02:00:00Z', openedAt: '2026-09-04T05:00:00Z' },
  pricing: { baseAmount: { amount: '2761700.00', currency: 'KRW' }, plannedAmount: null },
  // 목록 관측 BID_CNT다. fixtureNow 직전 관측 4곳, 하루 전 관측 2곳 → "어제보다 +2".
  participation: {
    latest: { bidCount: 4, observedAt: '2026-09-03T01:00:00Z' },
    dayEarlier: { bidCount: 2, observedAt: '2026-09-02T00:30:00Z' }
  }
} satisfies AuctionV1Response;

/** 개찰이 끝난 공고. now가 openedAt 뒤다. */
export const closedAuctionFixture = {
  ...openAuctionFixture,
  identity: { ...openAuctionFixture.identity, auctionId: '5780681', revisionId: '5780682', status: 'CLOSED' },
  schedule: { announcedAt: '2026-08-10T00:00:00Z', deadlineAt: '2026-08-13T02:00:00Z', openedAt: '2026-08-13T05:00:00Z' }
} satisfies AuctionV1Response;

export const fixtureNow = '2026-09-03T01:30:00Z';
