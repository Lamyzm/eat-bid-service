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
  }
} satisfies AuctionV1Response;
