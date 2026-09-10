import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../../../__fixtures__/attempts';
import { presentHistory } from '../../history/model/attempt-history';
import type { HistoryRow } from '../../history/model/attempt-history';
import { toMilli } from '../../../_lib/bid-rate';
import { rehearse } from './rehearsal';

function makeRow(
  overrides: Partial<HistoryRow> & { readonly openedText: string; readonly openedYear: string }
): HistoryRow {
  return {
    attemptId: '1',
    revisionId: null,
    openedMonthText: '26-01',
    openedKstDay: 20_454,
    announcedAt: '2025-12-29T00:00:00Z',
    openedMonth: '2026-01',
    itemLabel: '축산',
    floorRateText: '87.745',
    baseAmountText: '2,761,700',
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

// 예정가격과 기초금액이 같은 회차, 곧 두 축의 배율이 1인 합성 회차다. 사정률과 투찰률이 같은 값이라
// 이 파일의 집계 검사가 축 차이에 흔들리지 않는다. 축이 벌어졌을 때의 판정은 rehearsal-axis.test.ts가
// 남산초 실관측 92회차로 따로 검사한다.
function winRow(openedText: string, openedYear: string, winRate: string, dayFloor: string | null): HistoryRow {
  return makeRow({
    openedText,
    openedYear,
    winRateText: winRate,
    winRateMilli: toMilli(winRate),
    awardedBidRateText: `${winRate}0`,
    awardedBidRateMilli: toMilli(winRate),
    dayFloorText: dayFloor,
    dayFloorMilli: dayFloor === null ? null : toMilli(dayFloor)
  });
}

describe('이 값이면 재현 계산', () => {
  test('fixture 20회 중 투찰률 92.500으로 낙찰됐을 회차 수는 10이다', () => {
    const rows = presentHistory(attemptsFixture, null).rows;
    const rehearsal = rehearse(rows, '92.500');
    // 예정가격을 모르는 5회차는 축을 옮길 수 없어 판정 불가이므로 분모에서 빠진다.
    expect(rehearsal.total).toBe(15);
    expect(rehearsal.won).toBe(10);
    expect(rehearsal.wonFlags).toHaveLength(15);
  });

  test('그날 하한이 null인 회차는 하한 아래 집계에서 제외된다', () => {
    const rows = presentHistory(attemptsFixture, null).rows;
    const rehearsal = rehearse(rows, '1.000');
    // dayFloor가 있는 15회만 하한 아래로 세고, dayFloor가 null인 5회는 그 집계에서 빠진다.
    expect(rehearsal.belowDayFloor).toBe(15);
    // 그 5회는 예정가격을 모르는 회차라 낙찰값과도 견줄 수 없어 분모에도 들어가지 않는다.
    expect(rehearsal.total).toBe(15);
  });

  test('투찰률 축 낙찰률이 없는 회차는 분모에서 빠진다', () => {
    const rows = [
      winRow('26-03-01', '2026', '90.200', null),
      makeRow({ openedText: '26-02-01', openedYear: '2026' })
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.total).toBe(1);
    expect(rehearsal.wonFlags).toHaveLength(1);
  });

  test('투찰률 축 낙찰률이 없어도 그날 하한만 알면 하한 아래로 센다', () => {
    const rows = [
      winRow('26-03-01', '2026', '90.200', null),
      makeRow({
        openedText: '26-02-01',
        openedYear: '2026',
        dayFloorText: '89.900',
        dayFloorMilli: toMilli('89.900')
      })
    ];
    const rehearsal = rehearse(rows, '89.000');
    expect(rehearsal.belowDayFloor).toBe(1);
    // 하한 아래로 센 회차는 낙찰률이 없어도 분모에 들어간다.
    expect(rehearsal.total).toBe(2);
    expect(rehearsal.wonFlags).toEqual([false, true]);
  });

  test('같은 값이면 추첨이므로 낙찰로 센다', () => {
    const rows = [winRow('26-01-01', '2026', '90.200', '89.900')];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.won).toBe(1);
    expect(rehearsal.wonFlags).toEqual([true]);
  });

  test('응답 순서를 뒤집어 오래된 회차가 앞에 온다', () => {
    // 입력은 API 응답과 같은 최근 → 오래된 순: 2026(진 회차) 다음 2025(이긴 회차).
    const rows = [
      winRow('26-06-01', '2026', '90.100', null), // rate 90.200보다 낮은 winRate → 짐
      winRow('25-06-01', '2025', '90.300', null) // rate 90.200보다 높은 winRate → 이김
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.wonFlags).toEqual([true, false]);
    expect(rehearsal.byYear.map((bucket) => bucket.year)).toEqual(['2025', '2026']);
  });

  test('25회 이상이면 byYear가 연도별로 합산된다', () => {
    const rows2025 = Array.from({ length: 15 }, (_, index) =>
      winRow(`25-01-${String(index + 1).padStart(2, '0')}`, '2025', '90.300', null)
    );
    const rows2026 = Array.from({ length: 12 }, (_, index) =>
      winRow(`26-01-${String(index + 1).padStart(2, '0')}`, '2026', '90.100', null)
    );
    // presentHistory와 같은 최근 → 오래된 순으로 전달한다(2026이 앞).
    const rows = [...rows2026, ...rows2025];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.total).toBe(27);
    expect(rehearsal.byYear).toEqual([
      { year: '2025', won: 15, total: 15 },
      { year: '2026', won: 0, total: 12 }
    ]);
  });

  test('연도는 openedYear 필드에서만 읽고 openedText는 참고하지 않는다', () => {
    // openedText는 일부러 실제 연도('2026')와 다른 값을 준다. byYear가 openedText를 다시 파싱한다면
    // '20'+'19' → '2019'로 잘못 묶이겠지만, openedYear 필드만 읽으므로 '2026'으로 묶여야 한다.
    const rows = [winRow('19-12-31 공고', '2026', '90.300', null)];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.byYear).toEqual([{ year: '2026', won: 1, total: 1 }]);
  });

  test('fixture에서 92.700을 냈다면 낙찰값 이하 9회 중 6회가 낙찰값 바로 위 0.1 안이다', () => {
    const rows = presentHistory(attemptsFixture, null).rows;
    const rehearsal = rehearse(rows, '92.700');
    // 투찰률 축 낙찰률 92.7183~92.7617 여섯 회차가 (92.700, 92.800] 안이고 92.8078·92.8985·92.9953은 밖이다.
    expect(rehearsal.won).toBe(9);
    expect(rehearsal.nearAbove).toBe(6);
  });

  test('낙찰값 바로 위 0.1 안은 투찰률 축 낙찰률로만 재고 사정률로 재지 않는다', () => {
    // 사정률(winRate)로 재면 0.05%p 차이라 안에 들지만, 투찰률 축에서는 0.5%p 위라 밖이다.
    const rows = [
      makeRow({
        openedText: '26-01-01',
        openedYear: '2026',
        winRateText: '90.250',
        winRateMilli: toMilli('90.250'),
        awardedBidRateText: '90.7000',
        awardedBidRateMilli: toMilli('90.7000')
      })
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.won).toBe(1);
    expect(rehearsal.nearAbove).toBe(0);
  });

  test('낙찰값과 정확히 0.1%p 차이는 안으로, 같은 값도 안으로, 0.101%p는 밖으로 센다', () => {
    const rows = [
      winRow('26-01-03', '2026', '90.300', null), // 0.100 위
      winRow('26-01-02', '2026', '90.200', null), // 같은 값(추첨)
      winRow('26-01-01', '2026', '90.301', null) // 0.101 위
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.won).toBe(3);
    expect(rehearsal.nearAbove).toBe(2);
  });

  test('그날 하한 아래 회차는 낙찰값이 가까워도 바로 위 0.1 안으로 세지 않는다', () => {
    const rows = [winRow('26-01-01', '2026', '90.250', '90.240')];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.belowDayFloor).toBe(1);
    expect(rehearsal.nearAbove).toBe(0);
  });

  test('행이 없으면 rateSpan과 usualListCount가 null이다', () => {
    const rehearsal = rehearse([], '90.200');
    expect(rehearsal.rateSpan).toBeNull();
    expect(rehearsal.usualListCount).toBeNull();
    expect(rehearsal.total).toBe(0);
    expect(rehearsal.won).toBe(0);
    expect(rehearsal.nearAbove).toBe(0);
    expect(rehearsal.wonFlags).toEqual([]);
    expect(rehearsal.byYear).toEqual([]);
  });

  test('listCount 중앙값은 짝수 개면 위쪽 중간값이다', () => {
    const rows = [
      makeRow({ openedText: '26-01-01', openedYear: '2026', listCount: 10 }),
      makeRow({ openedText: '26-01-02', openedYear: '2026', listCount: 20 }),
      makeRow({ openedText: '26-01-03', openedYear: '2026', listCount: 30 }),
      makeRow({ openedText: '26-01-04', openedYear: '2026', listCount: 40 })
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.usualListCount).toBe(30);
  });

  test('rateSpan은 winRate가 있는 행의 최솟값·최댓값·중앙값 텍스트다', () => {
    const rows = [
      winRow('26-01-01', '2026', '90.100', null),
      winRow('26-01-02', '2026', '90.500', null),
      winRow('26-01-03', '2026', '90.300', null)
    ];
    const rehearsal = rehearse(rows, '90.200');
    expect(rehearsal.rateSpan).toEqual({ min: '90.100', max: '90.500', median: '90.300' });
  });
});
