import type { MyBidReviewV1Response } from '@eatbid/contracts/api/v1/me';

const ratio = (value: string) => ({ value, unit: 'ratio' as const });

// 합성 표본이다. 업체 이름·사업자는 실제 납품업체가 아니다. 하한 1.009115·낙찰 1.009440은 실제 공고 모양을 흉내 낸 값이다.
export const bidReview: MyBidReviewV1Response = {
  asOf: '2026-10-14T00:00:00Z',
  months: [
    { month: '2025-12', rounds: 40, bids: 80, wins: 2 },
    { month: '2026-08', rounds: 73, bids: 140, wins: 1 },
    { month: '2026-09', rounds: 3, bids: 6, wins: 1 }
  ],
  selected: {
    month: '2026-09',
    marketPick: { version: '2026-10-10', window: { fromMonth: '2026-06', throughMonth: '2026-08' }, ratios: [ratio('0.984900'), ratio('0.989400')], marketRounds: 164 },
    nationalRuleVersion: '2026-10-10',
    plannedDistribution: { version: '2026-10-10', sourceRounds: 108126 },
    unplannedRounds: 1,
    summaries: [
      { method: 'own', rounds: 3, first: 1, allBelowFloor: 1, allAboveFirst: 1, expectedWins: '0.3', recomputedRounds: 0 },
      { method: 'market-pick', rounds: 3, first: 1, allBelowFloor: 2, allAboveFirst: 0, expectedWins: '0.5', recomputedRounds: 3 },
      { method: 'national-rule', rounds: 3, first: 0, allBelowFloor: 2, allAboveFirst: 1, expectedWins: '0.2', recomputedRounds: 3 },
      { method: 'morning-habit', rounds: 0, first: 0, allBelowFloor: 0, allAboveFirst: 0, expectedWins: '0.0', recomputedRounds: 0 }
    ],
    rounds: [
      {
        auctionId: '120042',
        openedAt: '2026-09-16T01:00:00Z',
        displayBidNo: 'E260909-658847-0',
        title: '2026년 10월 진영대창초등학교 급식용 식재료 축산물 소액수의 견적제출 공고',
        organizationLabel: '진영대창초등학교',
        itemLabel: '육류',
        baseAmount: { amount: '8255500.00', currency: 'KRW' },
        floorRate: { value: '90.000', unit: 'percentage-points' },
        bidderCount: 64,
        floorRatio: ratio('1.009115'),
        bestCompetitorRatio: ratio('1.009440'),
        winner: { label: '업체 가', ratio: ratio('1.009440'), mine: false },
        own: [
          { label: '내 업체 1', ratio: ratio('0.997914'), verdict: 'below-floor' },
          { label: '내 업체 2', ratio: ratio('0.999001'), verdict: 'below-floor' }
        ],
        ownExpectedWins: '0.0787',
        methods: [
          { method: 'market-pick', source: 'recomputed', version: '2026-10-10', positions: [{ ratio: ratio('0.984900'), verdict: 'below-floor' }, { ratio: ratio('0.989400'), verdict: 'below-floor' }], expectedWins: '0.0589' },
          { method: 'national-rule', source: 'recomputed', version: '2026-10-10', positions: [{ ratio: ratio('0.986000'), verdict: 'below-floor' }, { ratio: ratio('0.992000'), verdict: 'below-floor' }], expectedWins: '0.0053' }
        ]
      },
      {
        auctionId: '250657',
        openedAt: '2026-09-17T02:00:00Z',
        displayBidNo: 'E260910-659271-0',
        title: '2026년 10월 수남초 급식품(축산물) 구매',
        organizationLabel: '수남초등학교',
        itemLabel: '육류 , 가금류',
        baseAmount: { amount: '14041880.00', currency: 'KRW' },
        floorRate: { value: '90.000', unit: 'percentage-points' },
        bidderCount: 64,
        floorRatio: ratio('0.984500'),
        // 우리가 낙찰한 공고라 1등 자리 끝은 낙찰(우리)이 아니라 다른 업체 가장 낮은 유효 투찰이다.
        bestCompetitorRatio: ratio('0.988200'),
        winner: { label: '내 업체 1', ratio: ratio('0.987000'), mine: true },
        own: [
          { label: '내 업체 1', ratio: ratio('0.987000'), verdict: 'won' },
          { label: '내 업체 2', ratio: ratio('0.995000'), verdict: 'above-first' }
        ],
        ownExpectedWins: '0.1200',
        methods: [
          { method: 'market-pick', source: 'recomputed', version: '2026-10-10', positions: [{ ratio: ratio('0.984900'), verdict: 'first' }, { ratio: ratio('0.989400'), verdict: 'above-first' }], expectedWins: '0.2500' },
          { method: 'national-rule', source: 'recomputed', version: '2026-10-10', positions: [{ ratio: ratio('0.986000'), verdict: 'first' }, { ratio: ratio('0.992000'), verdict: 'above-first' }], expectedWins: '0.1000' }
        ]
      },
      {
        auctionId: '155645',
        openedAt: '2026-09-18T01:00:00Z',
        displayBidNo: null,
        title: null,
        organizationLabel: null,
        itemLabel: null,
        baseAmount: { amount: '5598590.00', currency: 'KRW' },
        floorRate: { value: '90.000', unit: 'percentage-points' },
        bidderCount: 40,
        floorRatio: ratio('1.002000'),
        bestCompetitorRatio: null,
        winner: null,
        own: [{ label: null, ratio: ratio('0.999000'), verdict: 'below-floor' }],
        ownExpectedWins: '0.0100',
        methods: []
      }
    ]
  }
};
