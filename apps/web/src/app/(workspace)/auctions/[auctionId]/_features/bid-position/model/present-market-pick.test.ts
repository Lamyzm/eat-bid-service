import { describe, expect, test } from 'bun:test';
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { findBannedCopy } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/banned-copy';
import {
  marketPosition,
  octoberMarketPick,
  octoberMarketResult
} from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/market-pick';
import { presentMarketPick, type MarketPickView } from './present-market-pick';

type MarketPick = AuctionBidPositionV1Response['marketPick'];

function applicableView(view: MarketPickView) {
  if (view.kind !== 'applicable') throw new Error('적용 대상이어야 한다');
  return view;
}

const withResult = (result: MarketPick['result'], window = octoberMarketPick.window) =>
  presentMarketPick({ ...octoberMarketPick, window, result });

describe('내 사업자 맞춤 금액 표시', () => {
  test('창 다음 달을 제목으로 쓰고 사업자별 금액을 원 단위로 끊어 기초금액 대비율과 함께 쓴다', () => {
    const view = applicableView(presentMarketPick(octoberMarketPick));
    expect(view.title).toBe('10월 내 사업자 맞춤 금액');
    expect(view.rows).toEqual([
      { label: '1번 사업자', amount: '15,210,353원', baseRelative: '기초금액 대비 88.6410%' },
      { label: '2번 사업자', amount: '15,276,760원', baseRelative: '기초금액 대비 89.0280%' }
    ]);
    expect(view.basis).toContain('7~9월 내 사업자가 넣은 하한율 90% 공고 158건에서');
    expect(view.basis).toContain('건수와 금액이 바뀔 수 있어요');
    expect(view.pairNote).toBeNull();
  });

  test('한 장 금액이 두 장의 1번과 같으면 같다고 적고 다르면 그대로 쓴다', () => {
    const same = applicableView(presentMarketPick(octoberMarketPick));
    expect(same.single).toEqual({
      label: '한 곳만 넣을 때',
      amount: '15,210,353원',
      baseRelative: '기초금액 대비 88.6410% · 이번 달은 1번과 같은 금액'
    });
    const different = applicableView(
      withResult({ ...octoberMarketResult, single: marketPosition(1, '15218076.00', '88.6860') })
    );
    expect(different.single).toEqual({
      label: '한 곳만 넣을 때',
      amount: '15,218,076원',
      baseRelative: '기초금액 대비 88.6860%'
    });
  });

  test('등록 사업자가 하나면 한 장 줄을 따로 두지 않고 두 번째 사업자를 등록하라고 알린다', () => {
    const one = applicableView(
      withResult({
        ...octoberMarketResult,
        linkedBusinesses: 1,
        positions: [marketPosition(1, '15210353.00', '88.6410')]
      })
    );
    expect(one.rows).toHaveLength(1);
    expect(one.single).toBeNull();
    expect(one.pairNote).toBe('두 번째 사업자를 등록하면 2번 금액이 같이 나와요.');
  });

  test('기간별 근거를 소수 오차 없이 더해 네 방법을 큰 순서의 막대로 세우고 길이는 가장 큰 값에 대한 비율이다', () => {
    const { record } = applicableView(presentMarketPick(octoberMarketPick));
    expect(record.title).toBe(
      '같은 공고 1,838건(2024년 4월~2026년 9월)에 대어 본 낙찰 수 · 두 장, 예정가격 추첨 평균'
    );
    // 32.7 + 39.6 + 19.3 + 3.4 = 95.0. Number로 더하면 95.00000000000001이 된다.
    expect(record.bars).toEqual([
      { label: '이 방법', value: '95.0건', widthPercent: '100.0', mine: true },
      { label: '전국 공식', value: '81.9건', widthPercent: '86.2', mine: false },
      { label: '무작위 자리', value: '68.7건', widthPercent: '72.3', mine: false },
      { label: '그동안 낸 금액', value: '57.9건', widthPercent: '60.9', mine: false }
    ]);
    expect(record.note).toContain('계산 판 2026-10-10');
  });

  test('근거 값의 소수 자릿수가 달라도 같은 자릿수로 맞춰 더하고 순서를 정한다', () => {
    const { record } = applicableView(
      withResult({
        ...octoberMarketResult,
        evidence: [
          { from: '2025-01', through: '2025-12', rounds: 10, expectedWins: '2.25', ruleExpectedWins: '2.3', currentExpectedWins: '1', lotteryExpectedWins: '0.5' }
        ]
      })
    );
    expect(record.bars.map((bar) => [bar.label, bar.value])).toEqual([
      ['전국 공식', '2.30건'],
      ['이 방법', '2.25건'],
      ['그동안 낸 금액', '1.00건'],
      ['무작위 자리', '0.50건']
    ]);
  });

  test('창이 해를 넘으면 연도를 붙이고 12월 창 다음 달은 1월이다', () => {
    const view = applicableView(
      withResult(octoberMarketResult, { fromMonth: '2026-11', throughMonth: '2027-01' })
    );
    expect(view.title).toBe('2월 내 사업자 맞춤 금액');
    expect(view.basis).toContain('2026년 11월~2027년 1월 내 사업자가');
    const december = withResult(octoberMarketResult, { fromMonth: '2026-10', throughMonth: '2026-12' });
    expect(december.title).toBe('1월 내 사업자 맞춤 금액');
  });

  test('금액을 내지 않은 이유를 그대로 말하고 공고 수 부족이면 읽은 건수와 필요한 건수를 쓴다', () => {
    const few = withResult({ state: 'not-applicable', reasons: ['market-rounds-below-minimum'], marketRounds: 52 });
    expect(few).toEqual({
      kind: 'not-applicable',
      title: '10월 내 사업자 맞춤 금액',
      reason: '최근 석 달 내 사업자가 넣은 공고가 52건이라 이번 달 금액을 고르지 않았어요(70건 이상 필요).'
    });
    const floor = withResult({ state: 'not-applicable', reasons: ['floor-rate-outside-market-pick'], marketRounds: null });
    expect(floor.kind === 'not-applicable' && floor.reason).toBe('맞춤 금액은 하한율 90% 공고에서만 검증했어요.');
    const broken = withResult({ state: 'not-applicable', reasons: ['market-data-unavailable'], marketRounds: null });
    expect(JSON.stringify(broken)).not.toContain('원');
  });

  test('맞춤 금액 문구는 NeaT 입력 지시·안전 단정·반사실 낙찰 같은 금지 문형을 쓰지 않는다', () => {
    const views = [
      presentMarketPick(octoberMarketPick),
      withResult({ ...octoberMarketResult, linkedBusinesses: 1, positions: [marketPosition(1, '15210353.00', '88.6410')] }),
      ...(
        [
          'floor-rate-unobserved',
          'floor-rate-outside-market-pick',
          'no-linked-business',
          'market-rounds-below-minimum',
          'market-data-unavailable'
        ] as const
      ).map((reason) => withResult({ state: 'not-applicable', reasons: [reason], marketRounds: 12 }))
    ];
    for (const view of views) expect(findBannedCopy(JSON.stringify(view))).toEqual([]);
  });
});
