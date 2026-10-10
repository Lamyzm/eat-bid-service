// 추천 투찰가 표시 테스트가 함께 쓰는 내 사업자 맞춤 금액 응답 표본이다. 배수는 2026년 10월 실제 값(0.9849·0.9892), 근거는
// 서버 방법 표(2026-10-10판)와 같고, 기초금액은 17,159,500원 예시 공고다.
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

type MarketPick = AuctionBidPositionV1Response['marketPick'];
type Applicable = Extract<MarketPick['result'], { state: 'applicable' }>;

export const marketPosition = (order: number, amount: string, rate: string) => ({
  order,
  amount: { amount, currency: 'KRW' as const },
  baseRelativeRate: { value: rate, unit: 'percentage-points' as const }
});

export const octoberMarketResult: Applicable = {
  state: 'applicable',
  marketRounds: 158,
  linkedBusinesses: 2,
  positions: [
    marketPosition(1, '15210353.00', '88.6410'),
    marketPosition(2, '15276760.00', '89.0280')
  ],
  single: marketPosition(1, '15210353.00', '88.6410'),
  evidence: [
    { from: '2024-04', through: '2024-12', rounds: 634, expectedWins: '32.7', ruleExpectedWins: '27.6', currentExpectedWins: '21.7', lotteryExpectedWins: '25.7' },
    { from: '2025-01', through: '2025-12', rounds: 681, expectedWins: '39.6', ruleExpectedWins: '34.7', currentExpectedWins: '22.4', lotteryExpectedWins: '26.6' },
    { from: '2026-01', through: '2026-08', rounds: 450, expectedWins: '19.3', ruleExpectedWins: '17.2', currentExpectedWins: '12.0', lotteryExpectedWins: '14.2' },
    { from: '2026-09', through: '2026-09', rounds: 73, expectedWins: '3.4', ruleExpectedWins: '2.4', currentExpectedWins: '1.8', lotteryExpectedWins: '2.2' }
  ]
};

export const octoberMarketPick: MarketPick = {
  version: '2026-10-10',
  windowMonths: 3,
  minimumRounds: 70,
  window: { fromMonth: '2026-07', throughMonth: '2026-09' },
  result: octoberMarketResult
};
