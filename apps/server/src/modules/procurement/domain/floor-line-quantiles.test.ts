import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal } from "@eatbid/domain";

import { FLOOR_LINE_QUANTILE_COUNT, floorLineQuantiles } from "./floor-line-quantiles";
import { PLANNED_RATIO_DISTRIBUTION } from "./planned-ratio-distribution-table";

const 하한율90 = bidRate(canonicalDecimal("90.000", 3));

describe("하한선 분위수", () => {
  test("199개를 낮은 쪽부터 내고 줄지 않는다", () => {
    const values = floorLineQuantiles(PLANNED_RATIO_DISTRIBUTION, 하한율90).map(Number);
    expect(values).toHaveLength(FLOOR_LINE_QUANTILE_COUNT);
    for (let index = 1; index < values.length; index += 1) expect(values[index]!).toBeGreaterThanOrEqual(values[index - 1]!);
  });

  test("하한율 90%의 가운데 절반은 기초금액의 89.4~90.4%다(2026-10-15 김해·전국 실측과 같은 자리)", () => {
    const values = floorLineQuantiles(PLANNED_RATIO_DISTRIBUTION, 하한율90).map(Number);
    // 0.25·0.50·0.75 분위는 49·99·149번째(0.005 간격 1부터)다.
    expect(values[49]!).toBeCloseTo(89.42, 1);
    expect(values[99]!).toBeCloseTo(89.91, 1);
    expect(values[149]!).toBeCloseTo(90.39, 1);
  });

  test("하한율이 바뀌면 같은 추첨 분포에 그 하한율을 곱한다", () => {
    const at90 = floorLineQuantiles(PLANNED_RATIO_DISTRIBUTION, 하한율90).map(Number);
    const at88 = floorLineQuantiles(PLANNED_RATIO_DISTRIBUTION, bidRate(canonicalDecimal("88.000", 3))).map(Number);
    expect(at88[99]! / at90[99]!).toBeCloseTo(88 / 90, 4);
  });

  test("값은 소수 넷째 자리 기초금액 대비율 문자열이다", () => {
    const first = floorLineQuantiles(PLANNED_RATIO_DISTRIBUTION, 하한율90)[0]!;
    expect(first).toMatch(/^\d{2}\.\d{4}$/);
  });
});
