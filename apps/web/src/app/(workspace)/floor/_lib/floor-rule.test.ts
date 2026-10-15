import { describe, expect, test } from 'bun:test';

import { QUANTILES } from '../__fixtures__/floor-lines';
import { belowFloorProbability, drawFloors, floorAtProbability, seededRandom, twentyDots } from './floor-rule';

const quantiles = QUANTILES.map(Number);

describe('하한선 분위수 읽기', () => {
  test('분위수 자리에서는 그 분위수 값을 그대로 읽는다', () => {
    expect(floorAtProbability(quantiles, 0.005)).toBeCloseTo(quantiles[0]!, 9);
    expect(floorAtProbability(quantiles, 0.5)).toBeCloseTo(quantiles[99]!, 9);
    expect(floorAtProbability(quantiles, 0.995)).toBeCloseTo(quantiles[198]!, 9);
  });

  test('하한 미달 확률은 넣는 값이 높을수록 줄고 분위수 자리에서 1 − p다', () => {
    expect(belowFloorProbability(quantiles, quantiles[99]!)).toBeCloseTo(0.5, 6);
    expect(belowFloorProbability(quantiles, quantiles[19]!)).toBeCloseTo(0.9, 6);
    const values = [88, 89, 89.5, 89.9, 90.3, 91, 92];
    const probabilities = values.map((value) => belowFloorProbability(quantiles, value));
    for (let index = 1; index < probabilities.length; index += 1) expect(probabilities[index]!).toBeLessThan(probabilities[index - 1]!);
    expect(belowFloorProbability(quantiles, 80)).toBe(1);
    expect(belowFloorProbability(quantiles, 100)).toBe(0);
  });

  test('점 20개는 (i+0.5)/20 분위수라 낮은 순으로 서고 가운데 열 개가 가운데 절반에 든다', () => {
    const dots = twentyDots(quantiles);
    expect(dots).toHaveLength(20);
    expect(dots.toSorted((left, right) => left - right)).toEqual(dots);
    expect(dots[5]!).toBeGreaterThan(floorAtProbability(quantiles, 0.25));
    expect(dots[14]!).toBeLessThan(floorAtProbability(quantiles, 0.75));
  });

  test('같은 씨앗이면 추첨만 돌린 하한선이 같다', () => {
    expect(drawFloors(quantiles, 5, seededRandom(7))).toEqual(drawFloors(quantiles, 5, seededRandom(7)));
    expect(drawFloors(quantiles, 5, seededRandom(7))).not.toEqual(drawFloors(quantiles, 5, seededRandom(8)));
  });
});
