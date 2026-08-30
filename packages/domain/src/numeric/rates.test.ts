import { describe, expect, test } from "bun:test";

import { canonicalDecimal } from "./canonical-decimal.js";
import {
  bidRate,
  floorRate,
  percentagePoints,
  percentagePointsToRatio,
  ratio,
  ratioToPercentagePoints,
  sharePercent,
} from "./rates.js";

describe("의미가 분리된 정확 비율", () => {
  test("퍼센트포인트와 ratio의 닫힌 범위를 문자열 계수로 검증한다", () => {
    expect(percentagePoints(canonicalDecimal("0.000000", 6))).toBe("0.000000");
    expect(percentagePoints(canonicalDecimal("100.000000", 6))).toBe("100.000000");
    expect(ratio(canonicalDecimal("0.000000", 6))).toBe("0.000000");
    expect(ratio(canonicalDecimal("1.000000", 6))).toBe("1.000000");
    expect(() => percentagePoints(canonicalDecimal("100.000001", 6))).toThrow(RangeError);
    expect(() => ratio(canonicalDecimal("1.000001", 6))).toThrow(RangeError);
  });

  test("업무별 rate 생성자가 범위를 지키면서 원문 정밀도를 보존한다", () => {
    expect(bidRate(canonicalDecimal("90.123000", 6))).toBe("90.123000");
    expect(floorRate(canonicalDecimal("88.745000", 6))).toBe("88.745000");
    expect(sharePercent(canonicalDecimal("42.500000", 6))).toBe("42.500000");
    expect(() => bidRate(canonicalDecimal("100.000001", 6))).toThrow(RangeError);
  });

  test("명시한 scale과 reject mode로 퍼센트포인트를 ratio로 정확히 변환한다", () => {
    const value = percentagePoints(canonicalDecimal("90.123000", 6));

    expect(
      percentagePointsToRatio(value, { sourceScale: 6, targetScale: 6, rounding: "reject" }),
    ).toBe("0.901230");
  });

  test("명시한 scale과 reject mode로 ratio를 퍼센트포인트로 정확히 변환한다", () => {
    const value = ratio(canonicalDecimal("0.901230", 6));

    expect(
      ratioToPercentagePoints(value, { sourceScale: 6, targetScale: 6, rounding: "reject" }),
    ).toBe("90.123000");
  });

  test("0 scale에서도 100과 1 사이를 정확히 왕복한다", () => {
    const points = percentagePoints(canonicalDecimal("100", 0));
    const unitRatio = ratio(canonicalDecimal("1", 0));

    expect(
      percentagePointsToRatio(points, { sourceScale: 0, targetScale: 0, rounding: "reject" }),
    ).toBe("1");
    expect(
      ratioToPercentagePoints(unitRatio, { sourceScale: 0, targetScale: 0, rounding: "reject" }),
    ).toBe("100");
  });

  test("최대 지원 scale과 최대 파생 이동에서도 정확한 문자열만 만든다", () => {
    const points = percentagePoints(canonicalDecimal("100.000000000000000000", 18));
    const unitRatio = ratio(canonicalDecimal("1", 0));

    expect(
      percentagePointsToRatio(points, { sourceScale: 18, targetScale: 0, rounding: "reject" }),
    ).toBe("1");
    expect(
      ratioToPercentagePoints(unitRatio, { sourceScale: 0, targetScale: 18, rounding: "reject" }),
    ).toBe("100.000000000000000000");
  });

  test("지원 scale과 안전한 산술 범위를 넘는 옵션을 allocation 전에 거부한다", () => {
    const points = percentagePoints(canonicalDecimal("0", 0));

    for (const targetScale of [19, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        percentagePointsToRatio(points, { sourceScale: 0, targetScale, rounding: "reject" }),
      ).toThrow("Rate conversion targetScale must be between 0 and 18");
    }
    expect(() =>
      percentagePointsToRatio(points, {
        sourceScale: Number.MAX_SAFE_INTEGER,
        targetScale: 0,
        rounding: "reject",
      }),
    ).toThrow("Rate conversion sourceScale must be between 0 and 18");
  });

  test("출력 scale이 정밀도를 잃으면 반올림하지 않고 거부한다", () => {
    const points = percentagePoints(canonicalDecimal("90.123001", 6));
    const unitRatio = ratio(canonicalDecimal("0.901231", 6));

    expect(() =>
      percentagePointsToRatio(points, { sourceScale: 6, targetScale: 5, rounding: "reject" }),
    ).toThrow(RangeError);
    expect(() =>
      ratioToPercentagePoints(unitRatio, { sourceScale: 6, targetScale: 3, rounding: "reject" }),
    ).toThrow(RangeError);
  });

  test("호출자가 선언한 입력 scale과 실제 문자열이 다르면 거부한다", () => {
    const points = percentagePoints(canonicalDecimal("90.123000", 6));

    expect(() =>
      percentagePointsToRatio(points, { sourceScale: 5, targetScale: 6, rounding: "reject" }),
    ).toThrow();
  });

});
