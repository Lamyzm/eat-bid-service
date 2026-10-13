import { describe, expect, test } from 'bun:test';
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { findBannedCopy } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/banned-copy';
import { board, boardRows } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { habitCellOf, habitHeadRecord, habitHeadSample, habitRecordText } from './morning-habit-cell';
import { presentBidBoard } from './present-bid-board';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type HabitCell = NonNullable<BidBoardRowWire['morningHabit']>;

const asOf = (board as Confirmed).asOf;
const ratio = (value: string) => ({ value, unit: 'ratio' as const });
const position = (order: number, amount: string, baseRelative: string) => ({
  order,
  amount: { amount: `${amount}.00`, currency: 'KRW' as const },
  baseRelativeRate: { value: baseRelative, unit: 'percentage-points' as const }
});

const head: NonNullable<Confirmed['morningHabit']> = {
  version: '2026-10-11',
  decidedAt: asOf,
  coverageThreshold: ratio('0.300000'),
  validatedLeadMinutes: 10,
  evidence: [
    { from: '2025-01', through: '2025-12', rounds: 681, expectedWins: '41.5', monthlyExpectedWins: '39.6' },
    { from: '2026-01', through: '2026-08', rounds: 450, expectedWins: '23.3', monthlyExpectedWins: '19.3' },
    { from: '2026-09', through: '2026-09', rounds: 73, expectedWins: '4.1', monthlyExpectedWins: '3.4' }
  ]
};

const on: HabitCell = {
  state: 'applicable',
  coverage: ratio('0.734210'),
  regulars: 16,
  sameDayRegulars: 11,
  latestSameDayOpenedAt: '2026-09-22T00:30:00Z',
  competitorCount: 93,
  positions: [position(1, '13289384', '88.5420'), position(2, '13333962', '88.8390')],
  single: position(1, '13289384', '88.5420')
};

const closed = (coverage: string | null): HabitCell => ({
  state: 'not-applicable',
  reasons: ['same-day-coverage-below-threshold'],
  coverage: coverage === null ? null : ratio(coverage)
});

describe('오늘 투찰 아침 갱신 칸', () => {
  test('켜진 칸은 1번·2번 사정률과 몇 시 결과로 바뀌었는지, 단골 몇 곳을 반영했는지 쓴다', () => {
    const cell = habitCellOf({ ...boardRows.tongyeong, morningHabit: on }, asOf);
    if (cell.kind !== 'amounts') throw new Error('켜져야 한다');
    expect(cell.lines.map((line) => line.figure.assessmentRate)).toEqual(['98.380', '98.710']);
    expect(cell.note).toBe('09:30 결과로 바뀜 · 단골 11곳');
    expect(cell.detail).toBe('09:30까지 나온 오늘 결과에서 단골 11곳이 넣은 사정률을 보고 다시 고른 금액이에요. 결과가 더 나오면 바뀌니 넣기 직전에 새로고침해 보세요.');
  });

  test('오늘 자리가 안 보인 칸은 내일 마감이면 내일 아침에 다시 열라고, 오늘 마감이면 앞선 결과를 기다린다고 쓴다', () => {
    expect(habitCellOf({ ...boardRows.deokjeongTomorrow, morningHabit: closed('0.000000') }, asOf))
      .toMatchObject({ kind: 'reason', text: '내일 아침에 다시 열면 계산돼요', tomorrow: true });
    expect(habitCellOf({ ...boardRows.tongyeong, morningHabit: closed('0.000000') }, asOf))
      .toMatchObject({ kind: 'reason', text: '앞선 결과 기다리는 중', tomorrow: false });
  });

  test('조금 보였지만 문턱 아래인 칸은 단골 결과가 아직 적다고 쓴다', () => {
    expect(habitCellOf({ ...boardRows.tongyeong, morningHabit: closed('0.129900') }, asOf))
      .toMatchObject({ kind: 'reason', text: '단골 결과가 아직 적어요', tomorrow: false });
  });

  test('열 머리는 맞춤보다 늘어난 낙찰 수를 맞춤과 견준 수라고 밝히고, 잰 조건(마감 직전)과 공고 수를 바로 아래에 단다', () => {
    expect(habitHeadRecord(head)).toBe('맞춤보다 +6.6건');
    expect(habitHeadSample(head)).toBe('마감 10분 전 기준 · 1,204건');
    expect(habitRecordText(head, '10월 맞춤')).toBe(
      '지난 공고 1,204건에 마감 10분 전에 1번·2번을 넣었다고 치고 세면 아침 갱신 68.9건, 10월 맞춤 62.3건이에요(계산 2026-10-11).'
    );
  });

  test('아침 갱신이 실리면 세 칸이 되고, 켜진 행은 근거 표시를 아침 갱신 칸으로 옮긴다', () => {
    const response: MyBidBoardV1Response = {
      ...(board as Confirmed),
      morningHabit: head,
      rows: [{ ...boardRows.tongyeong, morningHabit: on }, { ...boardRows.wolsan, morningHabit: closed('0.000000') }]
    };
    const view = presentBidBoard(response);
    if (view.kind !== 'board') throw new Error('목록이어야 한다');
    expect(view.methods).toBe(3);
    expect(view.columns.map((column) => column.label)).toEqual(['아침 갱신', '10월 맞춤', '전국 공식']);
    expect(view.columns[1]?.sample).toBe('1,838건');
    const rows = view.groups.flatMap((group) => group.rows);
    expect(rows[0]?.cells.map((cell) => cell.kind === 'amounts' && cell.lead)).toEqual([true, false, false]);
    expect(rows[1]?.cells.map((cell) => cell.kind === 'amounts' && cell.lead)).toEqual([false, true, false]);
  });

  test('머리 문장은 아침 결과로 다시 고른 공고 수를, 없으면 내일 아침에 다시 열 공고 수를 말한다', () => {
    const morning = presentBidBoard({
      ...(board as Confirmed),
      morningHabit: head,
      rows: [{ ...boardRows.tongyeong, morningHabit: on }, { ...boardRows.deokjeongTomorrow, morningHabit: closed('0.000000') }]
    });
    const evening = presentBidBoard({
      ...(board as Confirmed),
      morningHabit: head,
      rows: [{ ...boardRows.deokjeongTomorrow, morningHabit: closed('0.000000') }]
    });
    if (morning.kind !== 'board' || evening.kind !== 'board') throw new Error('목록이어야 한다');
    expect(morning.lede).toBe('오늘 마감 1건, 내일 마감 1건이에요. 아침 결과로 1건의 금액을 다시 골랐어요.');
    expect(evening.lede).toBe('오늘 마감 0건, 내일 마감 1건이에요. 내일 마감 1건은 내일 아침에 다시 열면 아침 갱신 금액이 생길 수 있어요.');
    // 더 보기의 아침 갱신 상자는 꺼진 칸에도 언제 생기는지를 말한다.
    const tomorrowRow = evening.groups[0]!.rows[0]!;
    expect(tomorrowRow.more.habit?.text.startsWith('내일 아침 그날 앞선 공고의 결과가 나오면 금액이 생겨요.')).toBe(true);
    for (const view of [morning, evening]) expect(findBannedCopy(JSON.stringify(view))).toEqual([]);
  });

  test('아침 갱신이 실리지 않은 응답은 지금처럼 두 칸이다', () => {
    const view = presentBidBoard(board);
    if (view.kind !== 'board') throw new Error('목록이어야 한다');
    expect(view.methods).toBe(2);
    expect(view.columns).toHaveLength(2);
  });
});
