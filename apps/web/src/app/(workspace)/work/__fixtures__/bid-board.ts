// 오늘 투찰 표시 테스트가 함께 쓰는 응답 표본이다. 공고·기초금액·참여 수는 2026-09-22(월) 김해 하한율 90% 육류 실제 공고이고,
// 금액은 10월 배수(0.9849·0.9892, 예비 0.9838·0.9860·0.9871)와 전국 공식 2026-10-10판으로 계산한 값이다. 기준 시각은 KST 09:47.
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

const money = (amount: string) => ({ amount: `${amount}.00`, currency: 'KRW' as const });
const rate = (value: string) => ({ value, unit: 'percentage-points' as const });
const position = (order: number, amount: string, baseRelative: string) => ({
  order,
  amount: money(amount),
  baseRelativeRate: rate(baseRelative)
});

function rulePositions(pairs: readonly (readonly [string, string])[]) {
  return pairs.map(([amount, baseRelative], index) => ({
    ...position(index + 1, amount, baseRelative),
    cumulativeWinRate: rate('2.000000'),
    cumulativeLotteryWinRate: rate('1.700000'),
    cumulativeValidationWins: 50 + index
  }));
}

function applicableRule(band: { minBidCount: number; maxBidCount: number | null }, bidCount: number, pairs: readonly (readonly [string, string])[]) {
  return {
    state: 'applicable' as const,
    band,
    bidCountBasis: { kind: 'observed' as const, bidCount },
    evidence: 'clear' as const,
    selection: 'training' as const,
    validationRounds: 3450,
    holdout: null,
    positions: rulePositions(pairs)
  };
}

function market(amounts: readonly [string, string, string, string, string]) {
  return {
    state: 'applicable' as const,
    positions: [position(1, amounts[0], '88.6410'), position(2, amounts[1], '89.0280')],
    single: position(1, amounts[0], '88.6410'),
    spares: [position(3, amounts[2], '88.5420'), position(4, amounts[3], '88.7400'), position(5, amounts[4], '88.8390')]
  };
}

function row(overrides: Partial<BidBoardRowWire> & Pick<BidBoardRowWire, 'auctionId'>): BidBoardRowWire {
  return {
    closesAt: '2026-09-22T01:00:00Z',
    organizationLabel: null,
    title: null,
    itemLabel: '육류 , 가금류',
    displayBidNo: null,
    baseAmount: null,
    floorRate: rate('90.000'),
    bidCount: null,
    observedAt: '2026-09-22T00:40:00Z',
    rule: null,
    market: null,
    ...overrides
  };
}

export const boardRows = {
  tongyeong: row({
    auctionId: '2797001',
    organizationLabel: '통영여자고등학교',
    title: '통영여자고등학교 2026년 10월 학교급식품 육류 구매 수의계약 안내 공고',
    baseAmount: money('15009130'),
    bidCount: 93,
    rule: applicableRule({ minBidCount: 70, maxBidCount: null }, 93, [['13285332', '88.5150'], ['13359627', '89.0100']]),
    market: market(['13304243', '13362329', '13289384', '13319102', '13333962'])
  }),
  juchon: row({
    auctionId: '2797002',
    organizationLabel: '주촌초등학교',
    title: '(주촌초등학교) 2026년 10월 식재료(육류) 구입 소액수의 공고',
    baseAmount: money('12261430'),
    bidCount: 71,
    rule: applicableRule({ minBidCount: 70, maxBidCount: null }, 71, [['10853205', '88.5150'], ['10913899', '89.0100']]),
    market: market(['10868655', '10916106', '10856516', '10880793', '10892932'])
  }),
  imho: row({
    auctionId: '2797003',
    organizationLabel: '김해임호고등학교',
    itemLabel: '육류',
    title: '2026년 10월 김해임호고등학교 식재료(육류) 구입 수의계약 안내공고',
    baseAmount: money('7673500'),
    bidCount: 44,
    rule: applicableRule({ minBidCount: 40, maxBidCount: 69 }, 44, [['6809464', '88.7400'], ['6850901', '89.2800']]),
    market: market(['6801868', '6831564', '6794271', '6809464', '6817061'])
  }),
  gubong88: row({
    auctionId: '2797004',
    organizationLabel: '구봉초등학교',
    itemLabel: '육류',
    title: '10월 급식 식재료(축산물) 구매 수의계약 견적 제출 공고',
    baseAmount: money('8711770'),
    floorRate: rate('88.000'),
    bidCount: 21,
    rule: { state: 'not-applicable', reasons: ['participation-below-rule'] },
    market: { state: 'not-applicable', reasons: ['floor-rate-outside-market-pick'] }
  }),
  naedeokNoBase: row({
    auctionId: '2797005',
    organizationLabel: '내덕초등학교',
    title: '2026년 10월 내덕초등학교 학교급식 육류 구입 소액수의 견적제출 안내 공고',
    bidCount: 43
  }),
  wolsan: row({
    auctionId: '2797006',
    closesAt: '2026-09-22T06:10:00Z',
    organizationLabel: '월산중학교',
    title: '2026년 10월 월산중학교 학교급식품(축산품) 소액수의 견적 제출 안내 공고',
    baseAmount: money('14198400'),
    bidCount: 65,
    rule: applicableRule({ minBidCount: 40, maxBidCount: 69 }, 65, [['12599661', '88.7400'], ['12676332', '89.2800']]),
    market: market(['12585604', '12640552', '12571548', '12599661', '12613717'])
  }),
  deokjeongTomorrow: row({
    auctionId: '2797007',
    closesAt: '2026-09-23T00:00:00Z',
    organizationLabel: '덕정초등학교',
    itemLabel: '육류',
    title: '2026년 10월 학교급식 식재료(축산물) 구매 소액수의',
    baseAmount: money('5598590'),
    rule: { state: 'not-applicable', reasons: ['participation-unobserved'] },
    market: market(['4962647', '4984313', '4957104', '4968189', '4973732'])
  })
} as const;

export const marketPickHead: Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>['marketPick'] = {
  version: '2026-10-10',
  windowMonths: 3,
  minimumRounds: 70,
  window: { fromMonth: '2026-07', throughMonth: '2026-09' },
  state: 'picked',
  reasons: [],
  marketRounds: 164,
  linkedBusinesses: 2,
  evidence: [
    { from: '2024-04', through: '2024-12', rounds: 634, expectedWins: '32.7', ruleExpectedWins: '27.6', currentExpectedWins: '21.7', lotteryExpectedWins: '25.7' },
    { from: '2025-01', through: '2025-12', rounds: 681, expectedWins: '39.6', ruleExpectedWins: '34.7', currentExpectedWins: '22.4', lotteryExpectedWins: '26.6' },
    { from: '2026-01', through: '2026-08', rounds: 450, expectedWins: '19.3', ruleExpectedWins: '17.2', currentExpectedWins: '12.0', lotteryExpectedWins: '14.2' },
    { from: '2026-09', through: '2026-09', rounds: 73, expectedWins: '3.4', ruleExpectedWins: '2.4', currentExpectedWins: '1.8', lotteryExpectedWins: '2.2' }
  ]
};

export const board: MyBidBoardV1Response = {
  regionPreference: 'confirmed',
  asOf: '2026-09-22T00:47:00Z',
  closesBeforeDate: '2026-09-24',
  rule: { version: '2026-10-10', trainedThrough: '2025-12', validatedFrom: '2026-01', validatedThrough: '2026-08' },
  marketPick: marketPickHead,
  rows: Object.values(boardRows)
};
