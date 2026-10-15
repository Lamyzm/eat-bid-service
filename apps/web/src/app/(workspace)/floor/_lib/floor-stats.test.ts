import { describe, expect, test } from 'bun:test';

import { hottestBand, MIN_MONTH_COUNT, monthBands, previousMonthFollowRate, sameMonthFollowRate, type StatPoint } from './floor-stats';

const point = (t: number, floor: number, month = '2026-09'): StatPoint => ({ t, floor, month });

describe('가장 많이 나온 칸', () => {
  test('0.2 칸은 0.1 눈금에서 시작하고 가장 많이 든 칸을 고른다', () => {
    const band = hottestBand([90.01, 90.05, 90.15, 90.18, 89.3, 91.2], 0.2);
    expect(band).toEqual({ lo: 90, inside: 4 });
  });

  test('같은 수면 가운데값에 가까운 칸을 고른다', () => {
    // 89.0대 둘, 90.0대 둘, 가운데값은 90 근처라 위쪽 칸이다. 첫 칸을 고르면 늘 아래로 기운다.
    expect(hottestBand([89.02, 89.05, 90.02, 90.05, 90.3], 0.1).lo).toBe(90);
  });

  test('달마다 칸을 고르고 건수와 칸에 든 수를 함께 낸다', () => {
    const bands = monthBands([point(1, 90.05, '2026-08'), point(2, 90.07, '2026-08'), point(3, 89.5, '2026-09')], 0.1);
    expect(bands.map((band) => [band.month, band.count, band.lo, band.hi, band.inside])).toEqual([
      ['2026-08', 2, 90, 90.1, 2],
      ['2026-09', 1, 89.5, 89.6, 1]
    ]);
  });
});

describe('몰린 칸 따라가기', () => {
  test('같은 달 앞서 10건이 쌓이기 전에는 세지 않고 같은 시각 공고끼리는 서로를 보지 않는다', () => {
    const early = Array.from({ length: 10 }, (_, index) => point(index, 90.05));
    // 같은 시각(t=10) 두 건은 서로를 보지 않고 앞의 10건만 본다.
    const result = sameMonthFollowRate([...early, point(10, 90.05), point(10, 91.5)], 0.2);
    expect(result).toEqual({ hits: 1, tries: 2 });
  });

  test('지난달 칸에 이번 달 내내 넣었다면 든 비율을 세고 공고가 적은 달은 건너뛴다', () => {
    const month = (name: string, floor: number) => Array.from({ length: MIN_MONTH_COUNT }, (_, index) => point(index, floor, name));
    const points = [...month('2026-07', 90.05), ...month('2026-08', 90.05), ...month('2026-09', 89.5), point(0, 90.05, '2026-10')];
    expect(previousMonthFollowRate(points, 0.2)).toEqual({ hits: MIN_MONTH_COUNT, tries: 2 * MIN_MONTH_COUNT, months: 3 });
  });
});
