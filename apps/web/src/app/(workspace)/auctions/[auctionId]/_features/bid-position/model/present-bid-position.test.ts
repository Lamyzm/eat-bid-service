import { describe, expect, test } from 'bun:test';
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { findBannedCopy } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/banned-copy';
import { octoberMarketPick } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/market-pick';
import { presentBidPosition, type BidPositionView } from './present-bid-position';

type Result = AuctionBidPositionV1Response['result'];
type Applicable = Extract<Result, { state: 'applicable' }>;

const position = (
  order: number,
  amount: string,
  rate: string,
  wins: number,
  win: string,
  lottery: string
) => ({
  order,
  amount: { amount, currency: 'KRW' as const },
  baseRelativeRate: { value: rate, unit: 'percentage-points' as const },
  cumulativeWinRate: { value: win, unit: 'percentage-points' as const },
  cumulativeLotteryWinRate: { value: lottery, unit: 'percentage-points' as const },
  cumulativeValidationWins: wins
});

const applicable: Applicable = {
  state: 'applicable',
  band: { minBidCount: 40, maxBidCount: 69 },
  bidCountBasis: { kind: 'observed', bidCount: 52 },
  evidence: 'clear',
  selection: 'training',
  validationRounds: 3450,
  holdout: { month: '2026-09', rounds: 851, tickets: 2, wins: 33, lotteryExpectedWins: '31.6' },
  positions: [
    position(1, '15227341.00', '88.7400', 74, '2.144928', '1.755211'),
    position(2, '15320002.00', '89.2800', 145, '4.202899', '3.447802'),
    position(3, '15374076.00', '89.5950', 217, '6.289855', '5.080982')
  ]
};

const response: AuctionBidPositionV1Response = {
  auctionId: '5796468',
  revisionId: '99',
  baseAmount: { amount: '17159500.00', currency: 'KRW' },
  floorRate: { value: '90.000', unit: 'percentage-points' },
  participation: { bidCount: 52, observedAt: '2026-10-07T01:00:00Z' },
  deadlineAt: '2026-10-07T02:00:00Z',
  rule: {
    version: '2026-10-10',
    trainedThrough: '2025-12',
    validatedFrom: '2026-01',
    validatedThrough: '2026-08'
  },
  result: applicable,
  marketPick: octoberMarketPick
};

const withResult = (result: Result) =>
  presentBidPosition({ kind: 'position', response: { ...response, result } });

function applicableView(view: BidPositionView | null) {
  if (view?.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
  return view;
}

describe('추천 투찰가 표시', () => {
  test('사업자별 금액을 원 단위로 끊고 누적 낙찰률을 무작위 자리와 나란히 쓴다', () => {
    const view = applicableView(presentBidPosition({ kind: 'position', response }));
    expect(view.rows.map((row) => row.amount)).toEqual([
      '15,227,341원',
      '15,320,002원',
      '15,374,076원'
    ]);
    expect(view.rows[0]?.baseRelative).toBe('기초금액 대비 88.7400%');
    expect(view.rows[1]?.evidence).toBe(
      '1~2번 함께: 검증 3,450회차 중 145회 낙찰(4.20%) · 무작위 자리 3.45%'
    );
    expect(view.band).toBe('참여 40~69곳 표');
    expect(view.inputs).toBe('기초금액 17,159,500원 · 하한율 90% · 참여 52곳(10월 7일 10:00 관측)');
  });

  test('열린 대역은 "곳 이상"으로 쓴다', () => {
    const view = applicableView(
      withResult({ ...applicable, band: { minBidCount: 70, maxBidCount: null } })
    );
    expect(view.band).toBe('참여 70곳 이상 표');
  });

  test('표본 밖 성적과 고른 뒤 처음 본 달의 결과를 함께 쓰고 근거가 약한 대역은 그렇게 말한다', () => {
    const view = applicableView(presentBidPosition({ kind: 'position', response }));
    expect(view.calibration).toContain('고를 때 보지 않은 2026-01~2026-08 회차의 결과예요');
    expect(view.calibration).toContain(
      '2026-09 851회차에서는 2장으로 33회 낙찰했고 무작위로는 31.6회였어요(1.04배)'
    );
    expect(view.weakNote).toBeNull();
    const weak = applicableView(withResult({ ...applicable, evidence: 'weak' }));
    expect(weak.weakNote).toContain('참고로만');
  });

  test('추정한 참여 수로 표를 고르면 관측값과 추정값을 함께 말하고 하루 이상 남으면 다시 보라고 한다', () => {
    const estimated = (hoursBeforeDeadline: number) =>
      applicableView(
        withResult({
          ...applicable,
          bidCountBasis: {
            kind: 'estimated',
            observedBidCount: 36,
            hoursBeforeDeadline,
            estimatedBidCount: 49
          }
        })
      );
    expect(estimated(12).basisNote).toBe(
      '마감 12시간 전에 본 36곳으로 마감 1시간 전 참여를 약 49곳으로 잡아 표를 골랐어요.'
    );
    expect(estimated(30).basisNote).toContain('마감 당일에 다시 보세요');
    expect(applicableView(presentBidPosition({ kind: 'position', response })).basisNote).toBeNull();
  });

  test('운영자가 아니면 패널이 없고 조회 실패는 실패라고 말한다', () => {
    expect(presentBidPosition({ kind: 'forbidden' })).toBeNull();
    expect(presentBidPosition({ kind: 'failed' })).toEqual({ kind: 'unavailable' });
  });

  test('규칙 밖 회차는 금액 없이 실패한 조건을 모두 쓴다', () => {
    const view = withResult({
      state: 'not-applicable',
      reasons: ['floor-rate-outside-rule', 'participation-unobserved']
    });
    if (view?.kind !== 'not-applicable') throw new Error('규칙 밖이어야 한다');
    expect(view.reason).toBe(
      '규칙은 하한율 90%·88% 회차에서만 검증했어요. 참여 업체 수를 아직 확인하지 못했어요. 그래서 이 회차는 계산하지 않았어요.'
    );
    expect(JSON.stringify(view)).not.toContain('15,227,341원');
  });

  test('전국 규칙이 계산하지 않은 회차에도 내 사업자 맞춤 금액은 따로 판정해 함께 싣는다', () => {
    const view = withResult({ state: 'not-applicable', reasons: ['participation-unobserved'] });
    if (view?.kind !== 'not-applicable') throw new Error('규칙 밖이어야 한다');
    expect(view.market.kind).toBe('applicable');
    expect(view.market.kind === 'applicable' && view.market.rows[0]?.amount).toBe('15,210,353원');
    const national = applicableView(presentBidPosition({ kind: 'position', response }));
    expect(national.market.title).toBe('10월 내 사업자 맞춤 금액');
  });

  test('패널 문구는 NeaT 입력 지시·안전 단정·확정형 낙찰 같은 금지 문형을 쓰지 않는다', () => {
    const views = [
      presentBidPosition({ kind: 'position', response }),
      withResult({ ...applicable, evidence: 'weak' }),
      withResult({
        ...applicable,
        bidCountBasis: {
          kind: 'estimated',
          observedBidCount: 36,
          hoursBeforeDeadline: 30,
          estimatedBidCount: 49
        }
      }),
      withResult({ state: 'not-applicable', reasons: ['participation-below-rule'] })
    ];
    for (const view of views) expect(findBannedCopy(JSON.stringify(view))).toEqual([]);
  });
});
