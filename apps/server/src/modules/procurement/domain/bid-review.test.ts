import { describe, expect, test } from "bun:test";

import {
  baseRelativeRatio,
  bestCompetitorRate,
  classifyRate,
  classifyRatio,
  expectedWins,
  floorRatio,
  rateRatio,
  type ReviewRoundFacts,
} from "./bid-review";
import { PLANNED_RATIO_DISTRIBUTION } from "./planned-ratio-distribution-table";

// 기초금액 1,000만 원, 예정가격 995만 원 — 그날 하한은 0.995(사정률 99.500)이다.
const facts: ReviewRoundFacts = {
  baseAmount: "10000000.00",
  plannedAmount: "9950000.00",
  floorRate: "90.000",
  competitorRates: ["89.500", "90.100", "90.500"],
};

describe("복기 판정", () => {
  test("그날 하한은 예정가격 ÷ 기초금액이고, 투찰률은 같은 눈금(투찰률 ÷ 하한율 × 예정가격 ÷ 기초금액)으로 옮긴다", () => {
    expect(floorRatio(facts)).toBe("0.995000");
    expect(rateRatio(facts, "90.100")).toBe("0.996106");
    // 진영대창초 9월 공고: 예정가격 8,330,747원 / 기초금액 8,255,500원.
    expect(floorRatio({ ...facts, baseAmount: "8255500.00", plannedAmount: "8330747.00" })).toBe("1.009115");
  });

  test("가장 낮은 유효 투찰은 하한율 미만 투찰을 건너뛴다", () => {
    expect(bestCompetitorRate(facts)).toBe("90.100");
    expect(bestCompetitorRate({ ...facts, competitorRates: ["89.000"] })).toBeNull();
  });

  test("우리 값은 하한 아래면 하한 미달, 하한 이상이면서 가장 낮은 유효 투찰보다 낮으면 1등 자리, 아니면 1등 자리보다 높음이다", () => {
    expect(classifyRatio(facts, "0.984900")).toBe("below-floor");
    expect(classifyRatio(facts, "0.995000")).toBe("first");
    expect(classifyRatio(facts, "0.996000")).toBe("first");
    expect(classifyRatio(facts, "0.997000")).toBe("above-first");
    // 유효 투찰이 하나도 없으면 하한 위는 모두 1등 자리다.
    expect(classifyRatio({ ...facts, competitorRates: ["89.000"] }, "1.020000")).toBe("first");
  });

  test("실제 낸 투찰률도 같은 규칙으로 가리되 예정가격 대비 축 그대로 비교한다", () => {
    expect(classifyRate(facts, "89.900")).toBe("below-floor");
    expect(classifyRate(facts, "90.050")).toBe("first");
    expect(classifyRate(facts, "90.100")).toBe("above-first");
  });

  test("화면의 기초금액 대비 %는 하한율로 나눠 같은 눈금에 앉는다", () => {
    expect(baseRelativeRatio("88.6410", "90.000")).toBe("0.984900");
    expect(baseRelativeRatio("90.8496", "90.000")).toBe("1.009440");
  });

  test("추첨 평균 기대는 두 값이 덮는 구간을 한 번만 세고, 더 높은 값을 더해도 줄지 않는다", () => {
    const one = expectedWins(facts, ["0.995500"], PLANNED_RATIO_DISTRIBUTION);
    const two = expectedWins(facts, ["0.995500", "0.990000"], PLANNED_RATIO_DISTRIBUTION);
    const same = expectedWins(facts, ["0.995500", "0.995500"], PLANNED_RATIO_DISTRIBUTION);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThanOrEqual(one);
    expect(same).toBeCloseTo(one, 12);
  });
});
