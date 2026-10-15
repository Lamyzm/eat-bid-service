import { describe, expect, test } from 'bun:test';

import { floorRange, MIN_RANGE_COUNT, quantileOf } from './floor-range';

describe('하한선 가운데 절반 범위', () => {
  test('보간하지 않고 실제로 나온 값 하나를 고른다', () => {
    expect(quantileOf([89, 89.5, 90, 90.5], 0.5)).toBe(89.5);
    expect(quantileOf([], 0.5)).toBeNaN();
  });

  test('정렬하지 않은 값도 받아 가운데 절반과 가운데값을 낸다', () => {
    const floors = [90.4, 89.2, 89.9, 90.1, 89.5, 89.7, 90.0, 89.4];
    expect(floorRange(floors)).toEqual({ count: 8, low: 89.4, middle: 89.7, high: 90.0 });
  });

  test('공고가 적으면 범위를 말하지 않는다', () => {
    expect(floorRange(Array.from({ length: MIN_RANGE_COUNT - 1 }, () => 90))).toBeNull();
  });
});
