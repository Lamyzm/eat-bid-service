/**
 * @module 책임: 하한선 값들에서 "열 번 중 다섯 번" 범위(가운데 절반)와 가운데값을 고른다. 하한선 자리 요약과 다른 화면의 입구 줄이 이
 * 함수 하나를 써서 같은 숫자를 말한다.
 */

/** 범위를 말하려면 공고가 이만큼은 있어야 한다. 몇 건의 사분위는 공고 하나만 바뀌어도 크게 흔들린다. */
export const MIN_RANGE_COUNT = 8;

/** 정렬된 값의 분위수다. 보간하지 않고 실제로 나온 하한선 하나를 고른다 — 화면이 "실제로 나온 값"을 말하게 한다. */
export function quantileOf(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  return sortedValues[Math.floor(p * (sortedValues.length - 1))]!;
}

export interface FloorRange {
  readonly count: number;
  /** 기초금액 대비 %다. */
  readonly low: number;
  readonly middle: number;
  readonly high: number;
}

/** 공고가 적으면 null이다. 값은 기초금액 대비 %다. */
export function floorRange(floors: readonly number[]): FloorRange | null {
  if (floors.length < MIN_RANGE_COUNT) return null;
  const sorted = floors.toSorted((left, right) => left - right);
  return { count: sorted.length, low: quantileOf(sorted, 0.25), middle: quantileOf(sorted, 0.5), high: quantileOf(sorted, 0.75) };
}
