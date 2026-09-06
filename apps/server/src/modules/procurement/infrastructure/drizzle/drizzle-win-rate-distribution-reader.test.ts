import { describe, expect, test } from "bun:test";

import { groupDistributionRows, mapCoverageRow } from "./drizzle-win-rate-distribution-reader";

describe("DrizzleWinRateDistributionReader row 경계", () => {
  test("달별 칸 행을 달 단위로 묶고 numeric 문자열을 milli 정수로 닫는다", () => {
    const reading = groupDistributionRows([
      { month_kst: "2026-08", bin_lower: "90.000", bin_width: "0.010", attempt_count: "2" },
      { month_kst: "2026-08", bin_lower: "90.030", bin_width: "0.010", attempt_count: "1" },
      { month_kst: "2026-09", bin_lower: "90.000", bin_width: "0.010", attempt_count: 3 },
    ]);
    expect(reading.storedBinWidthMilli).toBe(10n);
    expect(reading.months).toEqual([
      { month: "2026-08", bins: [{ lowerMilli: 90_000n, count: 2 }, { lowerMilli: 90_030n, count: 1 }] },
      { month: "2026-09", bins: [{ lowerMilli: 90_000n, count: 3 }] },
    ]);
  });

  test("행이 없으면 검증할 저장 폭도 없다", () => {
    expect(groupDistributionRows([])).toEqual({ months: [], storedBinWidthMilli: null });
  });

  test("한 build 안에서 칸 폭이 갈라진 행은 조용히 합치지 않고 끊는다", () => {
    // 같은 build 안에서 폭은 상수다. 갈라진 폭을 합치면 화면이 요청하지 않은 눈금을 보게 된다.
    expect(() => groupDistributionRows([
      { month_kst: "2026-09", bin_lower: "90.000", bin_width: "0.010", attempt_count: "1" },
      { month_kst: "2026-09", bin_lower: "90.100", bin_width: "0.050", attempt_count: "1" },
    ])).toThrow(TypeError);
  });

  test("조회가 좁혀 준 달 이름을 그대로 읽고 알 수 없는 보유율은 끊는다", () => {
    expect(mapCoverageRow({ month_kst: "2026-09", coverage: "partial" }))
      .toEqual({ month: "2026-09", coverage: "partial" });
    expect(() => mapCoverageRow({ month_kst: "2026-09", coverage: "unclear" })).toThrow(TypeError);
  });
});
