import { describe, expect, test } from 'bun:test';
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { findBannedCopy } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/banned-copy';
import { presentBidPosition, type BidPositionView } from './present-bid-position';

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

const response: AuctionBidPositionV1Response = {
  auctionId: '5796468',
  revisionId: '99',
  baseAmount: { amount: '17159500.00', currency: 'KRW' },
  floorRate: { value: '90.000', unit: 'percentage-points' },
  participation: { bidCount: 52, observedAt: '2026-10-07T01:00:00Z' },
  deadlineAt: '2026-10-07T02:00:00Z',
  rule: {
    version: '2026-10-07',
    trainedThrough: '2025-12',
    validatedFrom: '2026-01',
    validatedThrough: '2026-08'
  },
  result: {
    state: 'applicable',
    band: '40-69',
    selection: 'validation-informed',
    validationRounds: 3450,
    holdout: { month: '2026-09', rounds: 869, tickets: 2, wins: 41, lotteryExpectedWins: '33.7' },
    positions: [
      position(1, '15219619.00', '88.6950', 78, '2.260870', '1.787757'),
      position(2, '15320002.00', '89.2800', 149, '4.318841', '3.575513'),
      position(3, '15358611.00', '89.5050', 206, '5.971014', '5.363270')
    ]
  }
};

function textsOf(view: BidPositionView | null): string {
  return JSON.stringify(view);
}

describe('추천 투찰가 표시', () => {
  test('사업자별 금액을 원 단위로 끊고 누적 낙찰률을 무작위 자리와 나란히 쓴다', () => {
    const view = presentBidPosition({ kind: 'position', response });
    if (view?.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
    expect(view.rows.map((row) => row.amount)).toEqual([
      '15,219,619원',
      '15,320,002원',
      '15,358,611원'
    ]);
    expect(view.rows[0]?.baseRelative).toBe('기초금액 대비 88.6950%');
    expect(view.rows[1]?.evidence).toBe(
      '1~2번 함께: 검증 3,450회차 중 149회 낙찰(4.32%) · 무작위 자리 3.58%'
    );
    expect(view.band).toBe('참여 40~69곳 표');
    expect(view.inputs).toBe('기초금액 17,159,500원 · 하한율 90% · 참여 52곳(10월 7일 10:00 관측)');
  });

  test('검증 기간을 보고 고른 표는 낙관적이라고 말하고 고른 뒤 처음 본 달의 결과를 함께 쓴다', () => {
    const view = presentBidPosition({ kind: 'position', response });
    if (view?.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
    expect(view.calibration).toContain('실제보다 높게 나왔을 수 있습니다');
    expect(view.calibration).toContain(
      '2026-09 869회차에서 2장은 41회 낙찰, 무작위 33.7회(1.22배)'
    );
  });

  test('관측이 마감 1시간 전보다 이르면 표가 바뀔 수 있다고 말하고 그 뒤면 말하지 않는다', () => {
    const early = presentBidPosition({
      kind: 'position',
      response: { ...response, participation: { bidCount: 52, observedAt: '2026-10-06T23:30:00Z' } }
    });
    if (early?.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
    expect(early.timingNote).toContain('마감 2시간 30분 전');
    const days = presentBidPosition({
      kind: 'position',
      response: { ...response, participation: { bidCount: 52, observedAt: '2026-10-03T17:46:00Z' } }
    });
    if (days?.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
    expect(days.timingNote).toContain('마감 3일 8시간 14분 전');
    const late = presentBidPosition({ kind: 'position', response });
    if (late?.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
    expect(late.timingNote).toBeNull();
  });

  test('운영자가 아니면 패널이 없고 조회 실패는 실패라고 말한다', () => {
    expect(presentBidPosition({ kind: 'forbidden' })).toBeNull();
    expect(presentBidPosition({ kind: 'failed' })).toEqual({ kind: 'unavailable' });
  });

  test('규칙 밖 회차는 금액 없이 사유만 쓴다', () => {
    const view = presentBidPosition({
      kind: 'position',
      response: {
        ...response,
        result: { state: 'not-applicable', reason: 'floor-rate-outside-rule' }
      }
    });
    expect(view?.kind).toBe('not-applicable');
    expect(view !== null && 'rows' in view).toBe(false);
    expect(textsOf(view)).not.toContain('15,219,619원');
    expect(textsOf(view)).toContain('하한율 90% 회차에서만 검증');
  });

  test('패널 문구는 NeaT 입력 지시·안전 단정·확정형 낙찰 같은 금지 문형을 쓰지 않는다', () => {
    const views = [
      presentBidPosition({ kind: 'position', response }),
      presentBidPosition({
        kind: 'position',
        response: {
          ...response,
          result: { state: 'not-applicable', reason: 'participation-below-rule' }
        }
      })
    ];
    for (const view of views) expect(findBannedCopy(textsOf(view))).toEqual([]);
  });
});
