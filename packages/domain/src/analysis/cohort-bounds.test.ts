import { describe, expect, test } from "bun:test";
import { Temporal } from "../time/temporal.js";
import { sampleCount } from "../numeric/quantities.js";
import { analysisDateRange, analysisListCountRange } from "./cohort-bounds.js";

describe("분석 기간과 명단의 의미 경계", () => {
  test("종료일을 포함하는 KST 기간을 다음 날 미만의 Instant 경계로 만든다", () => {
    const period = analysisDateRange(Temporal.PlainDate.from("2024-02-29"), Temporal.PlainDate.from("2024-02-29"));
    expect(period.fromInclusive.toString()).toBe("2024-02-28T15:00:00Z");
    expect(period.toExclusive.toString()).toBe("2024-02-29T15:00:00Z");
    expect(() => analysisDateRange(Temporal.PlainDate.from("2026-03-01"), Temporal.PlainDate.from("2026-02-28"))).toThrow();
  });

  test("명단은 양끝을 포함하고 제한이 있을 때만 미관측을 제외한다", () => {
    const range = analysisListCountRange(sampleCount(12n), sampleCount(24n));
    expect([11n, 12n, 24n, 25n].map((value) => range.includes(sampleCount(value)))).toEqual([false, true, true, false]);
    expect(range.includes(null)).toBe(false);
    expect(analysisListCountRange(null, null).includes(null)).toBe(true);
    expect(analysisListCountRange(sampleCount(0n), sampleCount(0n)).includes(sampleCount(0n))).toBe(true);
    expect(() => analysisListCountRange(sampleCount(24n), sampleCount(12n))).toThrow();
  });
});
