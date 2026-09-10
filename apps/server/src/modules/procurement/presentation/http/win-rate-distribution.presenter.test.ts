import { describe, expect, test } from "bun:test";
import { winRateDistributionV1ResponseSchema } from "@eatbid/contracts";
import { bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";
import type { WinRateDistributionResult } from "../../application/find-win-rate-distribution";
import { kstMonth } from "../../domain/kst-month";
import { organizationId } from "../../domain/organization-id";
import { toWinRateDistributionResponse } from "./win-rate-distribution.presenter";

const lineage = {
  buildId: 501n,
  sourceReleaseId: "00000000-0000-0000-0000-000000000141",
  calcVersion: "mart-r1",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const result: WinRateDistributionResult = {
  input: {
    cohort: { scope: "organization", organizationId: organizationId(3101n) },
    floorRate: bidRate(canonicalDecimal("90.000", 3)),
    awardMethodCodeValueId: 31n,
    binWidth: bidRate(canonicalDecimal("0.010", 3)),
    granularity: "month",
    period: null,
  },
  period: { from: kstMonth("2026-08"), to: kstMonth("2026-09") },
  widthMilli: 10n,
  total: {
    bins: [{ lowerMilli: 90_000n, count: 3 }, { lowerMilli: 90_030n, count: 3 }],
    sampleCount: 6,
    medianBin: { fromMilli: 90_000n, toMilli: 90_010n },
    modeRange: { fromMilli: 90_000n, toMilli: 90_010n, count: 3, shareMillionths: 500_000n },
  },
  months: [
    { month: kstMonth("2026-08"), sampleCount: 2, coverage: "complete", bins: [{ lowerMilli: 90_000n, count: 2 }] },
    { month: kstMonth("2026-09"), sampleCount: 4, coverage: "none", bins: [{ lowerMilli: 90_000n, count: 1 }, { lowerMilli: 90_030n, count: 3 }] },
  ],
  coverage: "none",
  lineage,
};

describe("낙찰률 분포 presenter", () => {
  test("milli 정수 칸을 요청 폭의 십진 문자열 봉투로 닫고 비중은 ratio 축으로 싣는다", () => {
    const response = toWinRateDistributionResponse(result);
    expect(winRateDistributionV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.bins).toEqual([
      { from: { value: "90.000", unit: "percentage-points" }, to: { value: "90.010", unit: "percentage-points" }, count: 3 },
      { from: { value: "90.030", unit: "percentage-points" }, to: { value: "90.040", unit: "percentage-points" }, count: 3 },
    ]);
    expect(response.medianBin).toEqual({
      from: { value: "90.000", unit: "percentage-points" }, to: { value: "90.010", unit: "percentage-points" },
    });
    expect(response.modeRange).toEqual({
      from: { value: "90.000", unit: "percentage-points" }, to: { value: "90.010", unit: "percentage-points" },
      count: 3, share: { value: "0.500000", unit: "ratio" },
    });
    expect(response.months.map((month) => [month.month, month.sampleCount, month.coverage, month.bins?.length])).toEqual([
      ["2026-08", 2, "complete", 1], ["2026-09", 4, "none", 2],
    ]);
    expect(response.meta).toEqual({
      sampleCount: 6,
      item: null,
      scope: "organization",
      regionCodeValueId: null,
      organizationId: "3101",
      floorRate: { value: "90.000", unit: "percentage-points" },
      awardMethod: "31",
      binWidth: { value: "0.010", unit: "percentage-points" },
      period: { from: "2026-08", to: "2026-09" },
      buildId: "501",
      sourceReleaseId: "00000000-0000-0000-0000-000000000141",
      calcVersion: "mart-r1",
      computedAt: "2026-09-04T00:10:00Z",
      coverage: "none",
      regionScheme: "eat:auction-location-sigungu",
    });
  });

  test("total 단위 요청은 달별 요약은 싣되 달별 칸은 null로 비운다", () => {
    const response = toWinRateDistributionResponse({ ...result, input: { ...result.input, granularity: "total" } });
    expect(winRateDistributionV1ResponseSchema.parse(response)).toEqual(response);
    expect(response.months.map((month) => month.bins)).toEqual([null, null]);
    expect(response.months.map((month) => month.sampleCount)).toEqual([2, 4]);
  });

  test("활성 build가 없는 결과는 계보가 전부 null인 빈 응답이며 오류가 아니다", () => {
    const response = toWinRateDistributionResponse({
      ...result,
      input: { ...result.input, cohort: { scope: "national" } },
      total: { bins: [], sampleCount: 0, medianBin: null, modeRange: null },
      months: [],
      coverage: null,
      lineage: null,
    });
    expect(winRateDistributionV1ResponseSchema.parse(response)).toEqual(response);
    expect(response).toMatchObject({ bins: [], medianBin: null, modeRange: null, months: [] });
    expect(response.meta).toMatchObject({
      sampleCount: 0, scope: "national", regionCodeValueId: null, organizationId: null,
      buildId: null, sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null,
    });
  });
});
