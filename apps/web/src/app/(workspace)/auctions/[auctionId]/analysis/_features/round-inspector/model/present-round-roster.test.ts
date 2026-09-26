import { describe, expect, test } from 'bun:test';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { presentRoundRoster } from './present-round-roster';

const PLACEHOLDER = { amount: '10000000043768.00', currency: 'KRW' } as const;
const STATUS = {
  codeValueId: '3',
  code: '005',
  scheme: 'eat:bid-status',
  label: '낙찰실패'
} as const;

function row(ordinal: number, rank: number | null, rate: string, amount: string | null) {
  return {
    submissionId: String(1000 + ordinal),
    rosterOrdinal: ordinal,
    supplier: {
      supplierPartyId: String(500 + ordinal),
      sourceSupplierAccountId: String(700 + ordinal),
      name: `업체 ${ordinal}`
    },
    // 운영처럼 계산 금액 칸에는 자리표시값이 들어 있고 실제 금액은 제출 금액 칸에 있다(ADR 0041).
    sourceCalculatedAmount: PLACEHOLDER,
    submittedAmount: amount === null ? null : { amount, currency: 'KRW' as const },
    bidRate: { value: rate, unit: 'percentage-points' as const },
    rank,
    submittedAt: null,
    sourceStatus: STATUS,
    withdrawal: null
  };
}

function roster(overrides: Partial<AuctionRosterV1Response> = {}): AuctionRosterV1Response {
  return {
    auctionId: '248067',
    revisionId: '130770',
    state: 'observed',
    rows: [
      row(2, 2, '90.013', '12748000.00'),
      row(0, 1, '90.002', '12746500.00'),
      row(3, 3, '89.950', null),
      row(1, null, '88.120', '12480000.00')
    ],
    award: {
      rosterOrdinal: 0,
      sourceCalculatedAmount: PLACEHOLDER,
      bidRate: { value: '90.002', unit: 'percentage-points' },
      secondRate: { value: '90.013', unit: 'percentage-points' }
    },
    meta: {
      rowCount: 4,
      sourceRosterSize: 4,
      observedAt: '2026-08-27T10:40:00Z',
      provenance: {
        sourceSystem: 'eat',
        observationId: '1',
        normalizedRecordId: '2',
        contentSha256: 'a'.repeat(64)
      }
    },
    ...overrides
  };
}

describe('선택 회차 명단 표시 모델', () => {
  test('낙찰 업체와 2순위 차이, 하한 미만 수를 명단 그대로 말한다', () => {
    const view = presentRoundRoster(roster(), '90.000');
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.winnerName).toBe('업체 0');
    expect(view.winnerRateText).toBe('90.002');
    expect(view.secondGapText).toBe('+0.011%p');
    expect(view.belowFloorCount).toBe(2);
    expect(view.observedAtText).toBe('2026-08-27 19:40');
  });

  test('행은 순위 순이고 순위가 없는 행은 뒤로 가며 지어내지 않는다', () => {
    const view = presentRoundRoster(roster(), '90.000');
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.rows.map((item) => item.rankText)).toEqual(['1위', '2위', '3위', '순위 미확인']);
    expect(view.rows[0]!.isWinner).toBe(true);
    expect(view.rows.map((item) => item.belowFloor)).toEqual([false, false, true, true]);
  });

  test('금액은 제출 금액만 쓰고 자리표시값을 금액으로 보이지 않는다', () => {
    const view = presentRoundRoster(roster(), '90.000');
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.rows[0]!.amountText).toBe('12,746,500원');
    expect(view.rows[2]!.amountText).toBe('금액 미확인');
    expect(view.rows.some((item) => item.amountText.includes('10,000,000,043,768'))).toBe(false);
  });

  test('2순위가 낙찰보다 낮으면 음수 차이를 그대로 적는다', () => {
    // 2순위는 원천 RNK=2 행이다. 낙찰 사정률보다 낮은 회차가 실제로 있다(2026-05 수산물 −0.016).
    const view = presentRoundRoster(
      roster({
        award: {
          rosterOrdinal: 0,
          sourceCalculatedAmount: PLACEHOLDER,
          bidRate: { value: '90.016', unit: 'percentage-points' },
          secondRate: { value: '90.000', unit: 'percentage-points' }
        }
      }),
      '90.000'
    );
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.secondGapText).toBe('−0.016%p');
  });

  test('띠는 하한과 낙찰 자리를 담고 밖으로 나간 행은 수로 남긴다', () => {
    const view = presentRoundRoster(roster(), '90.000');
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.strip.from).toBeLessThanOrEqual(90_000);
    expect(view.strip.to).toBeGreaterThanOrEqual(90_002);
    expect(view.strip.floor).toBe(90_000);
    const inside = view.strip.dots.every(
      (dot) => dot.x >= view.strip.from && dot.x <= view.strip.to
    );
    expect(inside).toBe(true);
  });

  test('명단 가운데 덩어리에서 멀리 떨어진 행은 띠 가장자리에 붙이고 몇 개인지 센다', () => {
    // 하한 아래로 한참 떨어진 한 곳까지 담으려고 띠를 늘리면 하한 위 경쟁이 한 점으로 뭉친다.
    const crowd = Array.from({ length: 40 }, (_, index) =>
      row(index + 1, index + 1, (90.001 + index * 0.01).toFixed(3), '12000000.00')
    );
    const view = presentRoundRoster(
      roster({ rows: [row(0, null, '80.000', null), ...crowd] }),
      '90.000'
    );
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.strip.outsideBelow).toBe(1);
    expect(view.strip.dots.find((dot) => dot.key === '1000')!.x).toBe(view.strip.from);
  });

  test('하한율을 모르면 하한 미만을 판단하지 않는다', () => {
    const view = presentRoundRoster(roster(), null);
    if (view.kind !== 'observed') throw new Error('observed여야 한다');
    expect(view.belowFloorCount).toBeNull();
    expect(view.rows.every((item) => item.belowFloor === null)).toBe(true);
  });

  test('명단을 관측하지 못한 회차는 0명이 아니라 미관측이다', () => {
    const view = presentRoundRoster(
      roster({ state: 'not-observed', rows: [], award: null }),
      '90.000'
    );
    expect(view.kind).toBe('not-observed');
  });
});
