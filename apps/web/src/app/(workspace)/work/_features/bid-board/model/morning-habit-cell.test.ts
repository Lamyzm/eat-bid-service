import { describe, expect, test } from 'bun:test';
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { board, boardRows } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { habitCellOf, habitHeadRecord } from './morning-habit-cell';
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
  });

  test('오늘 자리가 안 보인 칸은 내일 마감이면 내일 아침 계산, 오늘 마감이면 앞선 결과를 기다린다고 쓴다', () => {
    expect(habitCellOf({ ...boardRows.deokjeongTomorrow, morningHabit: closed('0.000000') }, asOf))
      .toEqual({ kind: 'reason', text: '내일 아침 계산' });
    expect(habitCellOf({ ...boardRows.tongyeong, morningHabit: closed('0.000000') }, asOf))
      .toEqual({ kind: 'reason', text: '앞선 결과 기다리는 중' });
  });

  test('조금 보였지만 문턱 아래인 칸은 오늘 정보 부족이라고 쓴다', () => {
    expect(habitCellOf({ ...boardRows.tongyeong, morningHabit: closed('0.129900') }, asOf))
      .toEqual({ kind: 'reason', text: '오늘 정보 부족' });
  });

  test('열 머리는 같은 공고에서 맞춤보다 늘어난 낙찰 수와 그 공고 수다', () => {
    expect(habitHeadRecord(head)).toBe('+6.6건/1,204건');
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
    expect(view.columns[1]?.record.endsWith('/1,838건')).toBe(true);
    const rows = view.groups.flatMap((group) => group.rows);
    expect(rows[0]?.cells.map((cell) => cell.kind === 'amounts' && cell.lead)).toEqual([true, false, false]);
    expect(rows[1]?.cells.map((cell) => cell.kind === 'amounts' && cell.lead)).toEqual([false, true, false]);
  });

  test('아침 갱신이 실리지 않은 응답은 지금처럼 두 칸이다', () => {
    const view = presentBidBoard(board);
    if (view.kind !== 'board') throw new Error('목록이어야 한다');
    expect(view.methods).toBe(2);
    expect(view.columns).toHaveLength(2);
  });
});
