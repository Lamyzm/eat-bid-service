import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from './attempt-history';
import type { HistoryRow } from './attempt-history';
import { toMilli } from './bid-rate';
import { rehearse } from './rehearsal';

function makeRow(overrides: Partial<HistoryRow> & { readonly openedText: string }): HistoryRow {
  return {
    attemptId: '1',
    itemLabel: '축산',
    itemCodeValueId: '7',
    winRateText: null,
    winRateMilli: null,
    secondRateText: null,
    dayFloorText: null,
    dayFloorMilli: null,
    winnerText: '—',
    listCount: null,
    invalidCount: null,
    isSelectedItem: true,
    ...overrides
  };
}

function winRow(openedText: string, winRate: string, dayFloor: string | null): HistoryRow {
  return makeRow({
    openedText,
    winRateText: winRate,
    winRateMilli: toMilli(winRate),
    dayFloorText: dayFloor,
    dayFloorMilli: dayFloor === null ? null : toMilli(dayFloor)
  });
}

describe('이 값이면 재현 계산', () => {
  test('fixture 20회 중 90.309로 낙찰됐을 회차 수는 7이다', () => {
    const rows = presentHistory(attemptsFixture, null).rows;
    const rehearsal = rehearse(rows, '90.309');
    expect(rehearsal.total).toBe(20);
    expect(rehearsal.won).toBe(7);
    expect(rehearsal.wonFlags).toHaveLength(20);
  });

  test('그날 하한이 null인 회차는 무효 집계에서 제외된다', () => {
    const rows = presentHistory(attemptsFixture, null).rows;
    const rehearsal = rehearse(rows, '1.000');
    // dayFloor가 있는 15회만 무효로 세고, dayFloor가 null인 5회는 무효 집계에서 빠진다.
    expect(rehearsal.invalid).toBe(15);
    expect(rehearsal.total).toBe(20);
  });

  test('winRate 없는 회차는 분모에서 빠진다', () => {
    const rows = [
      winRow('26-03-01', '90.200', null),
      makeRow({ openedText: '26-02-01', winRateText: null, winRateMilli: null })
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.total).toBe(1);
    expect(rehearsal.wonFlags).toHaveLength(1);
  });

  test('같은 값이면 추첨이므로 낙찰로 센다', () => {
    const rows = [winRow('26-01-01', '90.200', '89.900')];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.won).toBe(1);
    expect(rehearsal.wonFlags).toEqual([true]);
  });

  test('응답 순서를 뒤집어 오래된 회차가 앞에 온다', () => {
    // 입력은 API 응답과 같은 최근 → 오래된 순: 2026(진 회차) 다음 2025(이긴 회차).
    const rows = [
      winRow('26-06-01', '90.100', null), // rate 90.200보다 낮은 winRate → 짐
      winRow('25-06-01', '90.300', null) // rate 90.200보다 높은 winRate → 이김
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.wonFlags).toEqual([true, false]);
    expect(rehearsal.byYear.map((bucket) => bucket.year)).toEqual(['2025', '2026']);
  });

  test('25회 이상이면 byYear가 연도별로 합산된다', () => {
    const rows2025 = Array.from({ length: 15 }, (_, index) => winRow(`25-01-${String(index + 1).padStart(2, '0')}`, '90.300', null));
    const rows2026 = Array.from({ length: 12 }, (_, index) => winRow(`26-01-${String(index + 1).padStart(2, '0')}`, '90.100', null));
    // presentHistory와 같은 최근 → 오래된 순으로 전달한다(2026이 앞).
    const rows = [...rows2026, ...rows2025];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.total).toBe(27);
    expect(rehearsal.byYear).toEqual([
      { year: '2025', won: 15, total: 15 },
      { year: '2026', won: 0, total: 12 }
    ]);
  });

  test('행이 없으면 rateSpan과 usualListCount가 null이다', () => {
    const rehearsal = rehearse([], '90.200');
    expect(rehearsal.rateSpan).toBeNull();
    expect(rehearsal.usualListCount).toBeNull();
    expect(rehearsal.total).toBe(0);
    expect(rehearsal.won).toBe(0);
    expect(rehearsal.wonFlags).toEqual([]);
    expect(rehearsal.byYear).toEqual([]);
  });

  test('listCount 중앙값은 짝수 개면 위쪽 중간값이다', () => {
    const rows = [
      makeRow({ openedText: '26-01-01', listCount: 10 }),
      makeRow({ openedText: '26-01-02', listCount: 20 }),
      makeRow({ openedText: '26-01-03', listCount: 30 }),
      makeRow({ openedText: '26-01-04', listCount: 40 })
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.usualListCount).toBe(30);
  });

  test('rateSpan은 winRate가 있는 행의 최솟값·최댓값·중앙값 텍스트다', () => {
    const rows = [winRow('26-01-01', '90.100', null), winRow('26-01-02', '90.500', null), winRow('26-01-03', '90.300', null)];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.rateSpan).toEqual({ min: '90.100', max: '90.500', median: '90.300' });
  });
});
