import { describe, expect, test } from 'bun:test';
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { presentMorningHabit } from './present-morning-habit';

type MorningHabit = NonNullable<AuctionBidPositionV1Response['morningHabit']>;

const position = (order: number, amount: string, rate: string) => ({
  order,
  amount: { amount, currency: 'KRW' as const },
  baseRelativeRate: { value: rate, unit: 'percentage-points' as const }
});

const base: Omit<MorningHabit, 'result'> = {
  version: '2026-10-11',
  decidedAt: '2026-10-12T02:52:00Z',
  coverageThreshold: { value: '0.300000', unit: 'ratio' },
  validatedLeadMinutes: 10,
  evidence: [
    { from: '2025-01', through: '2025-12', rounds: 681, expectedWins: '41.5', monthlyExpectedWins: '39.6' },
    { from: '2026-01', through: '2026-08', rounds: 450, expectedWins: '23.3', monthlyExpectedWins: '19.3' },
    { from: '2026-09', through: '2026-09', rounds: 73, expectedWins: '4.1', monthlyExpectedWins: '3.4' }
  ]
};

const on: MorningHabit = {
  ...base,
  result: {
    state: 'applicable',
    coverage: { value: '0.734210', unit: 'ratio' },
    regulars: 55,
    sameDayRegulars: 31,
    latestSameDayOpenedAt: '2026-10-12T01:24:00Z',
    competitorCount: 44,
    positions: [position(1, '15210353.00', '88.6410'), position(2, '15276760.00', '89.0280')],
    single: position(1, '15210353.00', '88.6410')
  }
};

describe('아침 갱신 표시', () => {
  test('켜진 공고는 반영한 마지막 개찰 시각과 기준 시각을 KST로, 단골 몇 곳의 오늘 자리를 봤는지와 함께 쓴다', () => {
    const view = presentMorningHabit(on, '90.000');
    if (view.kind !== 'on') throw new Error('켜져야 한다');
    expect(view.status).toBe('10:24 개찰 결과까지 반영 · 단골 55곳 중 31곳의 오늘 자리를 봤어요 · 11:52 기준');
    expect(view.rows.map((row) => row.figure.assessmentRate)).toEqual(['98.490', '98.920']);
    expect(view.single).toMatchObject({ label: '한 곳만 넣을 때', note: '1번과 같은 금액' });
    expect(view.premise).toContain('마감 10분 전에 넣을 때를 기준으로 검증했어요');
  });

  test('근거는 기간별 낙찰 수를 더해 이번 달 맞춤과 견준다', () => {
    const view = presentMorningHabit(on, '90.000');
    if (view.kind !== 'on') throw new Error('켜져야 한다');
    expect(view.evidence).toBe(
      '같은 시장 공고 1,204건(2025년 1월~2026년 9월)에 대어 본 낙찰 수예요(두 장, 예정가격 추첨 평균). ' +
        '이번 달 맞춤만 쓰면 62.3건, 켜진 공고를 아침 갱신으로 바꾸면 68.9건(+10.6%)이에요. ' +
        '아래 막대와는 공고 수가 달라 직접 견주지 마세요.'
    );
  });

  test('오늘 정보가 모자란 공고는 금액 없이 보인 몫과 켜지는 문턱을 쓴다', () => {
    const view = presentMorningHabit(
      {
        ...base,
        result: {
          state: 'not-applicable',
          reasons: ['same-day-coverage-below-threshold'],
          coverage: { value: '0.129900', unit: 'ratio' }
        }
      },
      '90.000'
    );
    expect(view).toEqual({
      kind: 'off',
      status:
        '오늘 정보 부족 — 단골 업체의 오늘 자리가 12%만 보였어요(30% 이상이면 켜져요). 지금은 아래 이번 달 맞춤을 보세요.'
    });
  });

  test('사업자가 하나면 한 곳만 넣을 때 줄을 따로 두지 않는다', () => {
    const one: MorningHabit = { ...on, result: { ...on.result, positions: [position(1, '15210353.00', '88.6410')] } as MorningHabit['result'] };
    const view = presentMorningHabit(one, '90.000');
    if (view.kind !== 'on') throw new Error('켜져야 한다');
    expect(view.single).toBeNull();
  });
});
