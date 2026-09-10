import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, fixedClock, Temporal } from "@eatbid/domain";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import { kstMonth } from "../domain/kst-month";
import { organizationId } from "../domain/organization-id";
import {
  DistributionBinWidthInvalid,
  DistributionRegionNotFound,
  FindWinRateDistribution,
} from "./find-win-rate-distribution";
import { OrganizationNotFound } from "./list-organization-auction-attempts";
import type { WinRateDistributionReader } from "./win-rate-distribution-reader";
import { toWinRateDistributionResponse } from "../presentation/http/win-rate-distribution.presenter";

const clock = fixedClock(Temporal.Instant.from("2026-09-06T01:00:00Z"));

const lineage = {
  buildId: 501n,
  sourceReleaseId: "00000000-0000-0000-0000-000000000141",
  calcVersion: "mart-r1",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const nationalInput = {
  cohort: { scope: "national" },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  awardMethodCodeValueId: 31n,
  binWidth: bidRate(canonicalDecimal("0.010", 3)),
  granularity: "total",
  period: null,
} as const;

function readerDouble(overrides: Partial<WinRateDistributionReader>): WinRateDistributionReader {
  return {
    cohortExists: async () => true,
    readDistribution: async () => ({ months: [], coverage: [], storedBinWidthMilli: null, lineage: null }),
    ...overrides,
  };
}

// controller와 같은 순서로 use case의 내부 결과를 presenter로 닫는다. 아래 단언은 그 둘을 합친 공개 응답을 본다.
const run = (reader: WinRateDistributionReader, input: Parameters<FindWinRateDistribution["execute"]>[0]) =>
  new EffectRunner().run(new FindWinRateDistribution(reader, clock).execute(input)).then(toWinRateDistributionResponse);

describe("낙찰률 분포 조회 use case", () => {
  test("use case의 내부 결과는 milli 정수 칸과 도메인 값이며 십진 문자열 봉투를 만들지 않는다", async () => {
    const reader = readerDouble({
      readDistribution: async () => ({
        months: [{ month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 1 }, { lowerMilli: 90_005n, count: 2 }] }],
        coverage: [{ month: kstMonth("2026-09"), coverage: "complete" }],
        storedBinWidthMilli: 5n,
        lineage,
      }),
    });
    const result = await new EffectRunner().run(new FindWinRateDistribution(reader, clock).execute({
      ...nationalInput, period: { from: kstMonth("2026-09"), to: kstMonth("2026-09") },
    }));
    expect(result.widthMilli).toBe(10n);
    expect(result.total).toMatchObject({ sampleCount: 3, bins: [{ lowerMilli: 90_000n, count: 3 }] });
    expect(result.months).toEqual([{ month: "2026-09", sampleCount: 3, coverage: "complete", bins: [{ lowerMilli: 90_000n, count: 3 }] }]);
    expect(result.coverage).toBe("complete");
    expect(result.lineage).toBe(lineage);
  });

  test("활성 build가 없으면 오류가 아니라 계보가 전부 null인 빈 결과다", async () => {
    const response = await run(readerDouble({}), nationalInput);
    expect(response.bins).toEqual([]);
    expect(response.months).toEqual([]);
    expect(response.medianBin).toBeNull();
    expect(response.modeRange).toBeNull();
    expect(response.meta).toMatchObject({
      sampleCount: 0,
      item: null,
      scope: "national",
      regionCodeValueId: null,
      organizationId: null,
      buildId: null,
      sourceReleaseId: null,
      calcVersion: null,
      computedAt: null,
      coverage: null,
      regionScheme: null,
    });
  });

  test("기간을 생략하면 주입된 clock의 KST 달을 끝으로 12개월을 채워 응답에 되돌린다", async () => {
    const response = await run(readerDouble({}), nationalInput);
    // 2026-09-06T01:00Z는 KST로 10:00이라 이번 달은 2026-09다.
    expect(response.meta.period).toEqual({ from: "2025-10", to: "2026-09" });
  });

  test("요청한 기간은 그대로 되돌리고 달마다 표본과 보유율을 싣는다", async () => {
    const reader = readerDouble({
      readDistribution: async () => ({
        months: [
          { month: kstMonth("2026-08"), bins: [{ lowerMilli: 90_000n, count: 2 }] },
          { month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 1 }, { lowerMilli: 90_030n, count: 3 }] },
        ],
        coverage: [{ month: kstMonth("2026-08"), coverage: "complete" }],
        storedBinWidthMilli: 10n,
        lineage,
      }),
    });
    const response = await run(reader, { ...nationalInput, period: { from: kstMonth("2026-08"), to: kstMonth("2026-09") } });
    expect(response.meta.period).toEqual({ from: "2026-08", to: "2026-09" });
    expect(response.meta.sampleCount).toBe(6);
    expect(response.months.map((month) => [month.month, month.sampleCount, month.coverage, month.bins])).toEqual([
      ["2026-08", 2, "complete", null],
      // 보유율 행이 없는 달은 complete가 아니라 none이다. 행이 없다는 것이 none이다(PDR-0003).
      ["2026-09", 4, "none", null],
    ]);
    // 최상위 coverage는 달들의 최악값이다.
    expect(response.meta.coverage).toBe("none");
  });

  test("granularity=month는 달별 칸을 싣고 상위 칸은 그 합과 같다", async () => {
    const reader = readerDouble({
      readDistribution: async () => ({
        months: [
          { month: kstMonth("2026-08"), bins: [{ lowerMilli: 90_000n, count: 2 }] },
          { month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 1 }, { lowerMilli: 90_030n, count: 3 }] },
        ],
        coverage: [
          { month: kstMonth("2026-08"), coverage: "unknown" },
          { month: kstMonth("2026-09"), coverage: "partial" },
        ],
        storedBinWidthMilli: 10n,
        lineage,
      }),
    });
    const response = await run(reader, {
      ...nationalInput,
      granularity: "month",
      period: { from: kstMonth("2026-08"), to: kstMonth("2026-09") },
    });
    expect(response.bins).toEqual([
      { from: { value: "90.000", unit: "percentage-points" }, to: { value: "90.010", unit: "percentage-points" }, count: 3 },
      { from: { value: "90.030", unit: "percentage-points" }, to: { value: "90.040", unit: "percentage-points" }, count: 3 },
    ]);
    expect(response.months[1]?.bins).toEqual([
      { from: { value: "90.000", unit: "percentage-points" }, to: { value: "90.010", unit: "percentage-points" }, count: 1 },
      { from: { value: "90.030", unit: "percentage-points" }, to: { value: "90.040", unit: "percentage-points" }, count: 3 },
    ]);
    expect(response.meta.coverage).toBe("unknown");
  });

  test("없는 기관과 없는 지역 코드값을 빈 분포가 아니라 서로 다른 실패로 닫는다", async () => {
    const missing = readerDouble({ cohortExists: async () => false });
    await expect(run(missing, {
      ...nationalInput,
      cohort: { scope: "organization", organizationId: organizationId(3101n) },
    })).rejects.toBeInstanceOf(OrganizationNotFound);
    await expect(run(missing, {
      ...nationalInput,
      cohort: { scope: "province", regionCodeValueId: 41n },
    })).rejects.toBeInstanceOf(DistributionRegionNotFound);
    // 전국은 확인할 축이 없으므로 존재 확인을 하지 않는다.
    expect((await run(missing, nationalInput)).bins).toEqual([]);
  });

  test("요청 칸 폭이 활성 build의 저장 폭의 배수가 아니면 요청 오류로 닫는다", async () => {
    const reader = readerDouble({
      readDistribution: async () => ({
        months: [{ month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 1 }] }],
        coverage: [],
        storedBinWidthMilli: 10n,
        lineage,
      }),
    });
    const request = { ...nationalInput, binWidth: bidRate(canonicalDecimal("0.015", 3)) };
    await expect(run(reader, request)).rejects.toBeInstanceOf(DistributionBinWidthInvalid);
    // 저장 폭보다 좁은 칸은 만들 수 없다.
    await expect(run(reader, { ...nationalInput, binWidth: bidRate(canonicalDecimal("0.005", 3)) }))
      .rejects.toBeInstanceOf(DistributionBinWidthInvalid);
  });

  test("코호트와 칸 폭을 응답 meta에 되돌려 표본을 응답만으로 재현하게 한다", async () => {
    const reader = readerDouble({
      readDistribution: async () => ({
        months: [{ month: kstMonth("2026-09"), bins: [{ lowerMilli: 90_000n, count: 1 }] }],
        coverage: [{ month: kstMonth("2026-09"), coverage: "complete" }],
        storedBinWidthMilli: 10n,
        lineage,
      }),
    });
    const response = await run(reader, {
      ...nationalInput,
      cohort: { scope: "district", regionCodeValueId: 43n },
      binWidth: bidRate(canonicalDecimal("0.050", 3)),
      period: { from: kstMonth("2026-09"), to: kstMonth("2026-09") },
    });
    expect(response.meta).toEqual({
      sampleCount: 1,
      item: null,
      scope: "district",
      regionCodeValueId: "43",
      organizationId: null,
      floorRate: { value: "90.000", unit: "percentage-points" },
      awardMethod: "31",
      binWidth: { value: "0.050", unit: "percentage-points" },
      period: { from: "2026-09", to: "2026-09" },
      buildId: "501",
      sourceReleaseId: "00000000-0000-0000-0000-000000000141",
      calcVersion: "mart-r1",
      computedAt: "2026-09-04T00:10:00Z",
      coverage: "complete",
      regionScheme: "eat:auction-location-sigungu",
    });
  });
});
