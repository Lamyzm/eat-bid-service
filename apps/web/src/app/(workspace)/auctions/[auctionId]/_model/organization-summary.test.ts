import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from './attempt-history';
import type { HistoryRow } from './attempt-history';
import { summarizeOrganization } from './organization-summary';

function makeRow(overrides: Partial<HistoryRow> & { readonly openedKstDay: number }): HistoryRow {
  return {
    attemptId: String(overrides.openedKstDay),
    announcedAt: '2025-12-29T00:00:00Z',
    openedText: '26-01-01',
    openedYear: '2026',
    openedMonthText: '26-01',
    itemLabel: '축산',
    itemCodeValueId: '7',
    winRateText: null,
    winRateMilli: null,
    awardedBidRateText: null,
    awardedBidRateMilli: null,
    secondRateText: null,
    dayFloorText: null,
    dayFloorMilli: null,
    winnerText: '—',
    listCount: null,
    belowDayFloorCount: null,
    isSelectedItem: true,
    ...overrides
  };
}

describe('이 학교 요약', () => {
  test('fixture 20회차의 누적 회차·최근 낙찰·발주 주기를 응답에서 계산한다', () => {
    const summary = summarizeOrganization(presentHistory(attemptsFixture, null).rows);
    expect(summary.rounds).toBe(20);
    expect(summary.latestWin).toEqual({ rateText: '90.126', openedText: '26-08-10' });
    // 개찰일 간격 19개(27~60일)의 가운데값이다.
    expect(summary.cadenceDays).toBe(30);
  });

  test('회차가 없으면 숫자를 지어내지 않고 최근 낙찰과 발주 주기가 null이다', () => {
    const summary = summarizeOrganization([]);
    expect(summary).toEqual({ rounds: 0, latestWin: null, cadenceDays: null });
  });

  test('회차가 하나뿐이면 간격이 없으므로 발주 주기가 null이다', () => {
    const summary = summarizeOrganization([makeRow({ openedKstDay: 20_000, winRateText: '90.100' })]);
    expect(summary.rounds).toBe(1);
    expect(summary.cadenceDays).toBeNull();
  });

  test('최근 회차에 낙찰률이 없으면 그 다음 관측된 낙찰률을 최근 낙찰로 삼는다', () => {
    const rows = [
      makeRow({ openedKstDay: 20_060, openedText: '26-03-01' }),
      makeRow({ openedKstDay: 20_030, openedText: '26-02-01', winRateText: '90.250' })
    ];
    expect(summarizeOrganization(rows).latestWin).toEqual({ rateText: '90.250', openedText: '26-02-01' });
  });

  test('발주 주기는 응답 순서가 아니라 날짜순 이웃 간격의 가운데값이다', () => {
    // 일부러 뒤섞인 순서: 정렬하면 0, 10, 40, 100이고 간격은 10·30·60 → 가운데값 30.
    const rows = [40, 0, 100, 10].map((day) => makeRow({ openedKstDay: day }));
    expect(summarizeOrganization(rows).cadenceDays).toBe(30);
  });
});
