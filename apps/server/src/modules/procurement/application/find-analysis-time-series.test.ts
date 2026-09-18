import { describe, expect, test } from "bun:test";
import { parseAnalysisMeta } from "@eatbid/contracts";
import { bidRate, canonicalDecimal, fixedClock, Temporal } from "@eatbid/domain";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import { kstDate } from "../domain/kst-day";
import { organizationId } from "../domain/organization-id";
import type { AnalysisTimeSeriesReader } from "./analysis-time-series-reader";
import {
  AnalysisRegionNotFound,
  FindAnalysisTimeSeries,
  timeResolutionOf,
  type FindAnalysisTimeSeriesInput,
} from "./find-analysis-time-series";
import { OrganizationNotFound } from "./list-organization-auction-attempts";
import { toAnalysisTimeSeriesResponse } from "../presentation/http/analysis.presenter";

const clock = fixedClock(Temporal.Instant.from("2026-09-18T01:00:00Z"));

const lineage = {
  buildId: 501n,
  sourceReleaseId: "00000000-0000-0000-0000-000000000141",
  calcVersion: "mart-r10",
  computedAt: Temporal.Instant.from("2026-09-17T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const sourceCutoffAt = Temporal.Instant.from("2026-09-17T00:00:00Z");

const input: FindAnalysisTimeSeriesInput = {
  targetOrganizationId: organizationId(9_007_199_254_740_993n),
  excludeAttemptId: 89n,
  period: { from: kstDate("2026-08-01"), to: kstDate("2026-08-31") },
  dateBasis: "opened",
  comparisonScope: { kind: "national" },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  awardMethodCodeValueId: 71n,
  listCountMin: 12,
  listCountMax: 24,
  itemFilter: { kind: "all" as const },
  overlayOrganizationIds: [],
};

const emptyReading = {
  targetPoints: [],
  targetTotal: 0,
  comparison: { kind: "points", points: [] },
  comparisonTruncated: false,
  comparisonTotal: 0,
  overlapCount: 0,
  overlays: [],
  coverage: [],
  lineage,
  sourceCutoffAt,
} as const;

function readerDouble(overrides: Partial<AnalysisTimeSeriesReader>): AnalysisTimeSeriesReader {
  return {
    organizationExists: async () => true,
    regionExists: async () => true,
    readTimeSeries: async () => emptyReading,
    ...overrides,
  };
}

// controller와 같은 순서로 use case의 내부 결과를 presenter로 닫는다. 단언은 그 둘을 합친 공개 응답을 본다.
const run = (reader: AnalysisTimeSeriesReader, value: FindAnalysisTimeSeriesInput = input) =>
  new EffectRunner().run(new FindAnalysisTimeSeries(reader, clock).execute(value))
    .then(toAnalysisTimeSeriesResponse);

describe("분석 시간축 조회 use case", () => {
  test("없는 기관은 표본 0이 아니라 기관 없음으로 끊는다", async () => {
    const reader = readerDouble({ organizationExists: async () => false });
    await expect(run(reader)).rejects.toBeInstanceOf(OrganizationNotFound);
  });

  test("없는 비교 지역은 표본 0이 아니라 지역 없음으로 끊는다", async () => {
    const reader = readerDouble({ regionExists: async () => false });
    const region = {
      ...input,
      comparisonScope: { kind: "region", scheme: "eat:auction-location-sido", codeValueId: 48n },
    } as const;
    await expect(run(reader, region)).rejects.toBeInstanceOf(AnalysisRegionNotFound);
    // 전국은 확인할 축이 없으므로 지역 조회를 열지 않는다.
    await expect(run(reader)).resolves.toBeDefined();
  });

  test("지역 비교는 적용한 체계와 코드값을 그대로 되돌려 준다", async () => {
    const response = await run(readerDouble({}), {
      ...input,
      comparisonScope: { kind: "region", scheme: "eat:auction-location-sigungu", codeValueId: 49n },
    });
    expect(response.meta.effectiveFilter.comparisonScope).toEqual({
      kind: "region",
      scheme: "eat:auction-location-sigungu",
      codeValueId: "49",
    });
  });

  test("활성 build가 없으면 축·점·비교군이 전부 null이고 표본 수를 0으로 채우지 않는다", async () => {
    const reader = readerDouble({
      readTimeSeries: async () => ({ ...emptyReading, lineage: null, sourceCutoffAt: null }),
    });
    const response = await run(reader);
    expect(response.axis).toBeNull();
    expect(response.target).toBeNull();
    expect(response.comparison).toBeNull();
    expect(response.meta.state).toBe("unavailable");
    expect(response.meta).not.toHaveProperty("targetSampleCount");
  });

  test("자료가 준비됐는데 조건에 맞는 관측이 없으면 표본 0의 준비된 응답이다", async () => {
    const response = await run(readerDouble({}));
    expect(response.meta.state).toBe("ready");
    expect(response.target).toEqual([]);
    if (response.meta.state !== "ready") throw new Error("ready 상태여야 한다");
    expect(response.meta.targetSampleCount).toBe(0);
  });

  test("읽지 않은 분포 mart의 계보를 스냅샷에 싣지 않는다", async () => {
    const response = await run(readerDouble({}));
    if (response.meta.state !== "ready") throw new Error("ready 상태여야 한다");
    expect(response.meta.snapshot.builds).toHaveLength(1);
    expect(response.meta.snapshot.builds[0]?.purpose).toBe("observations");
    expect(response.meta.snapshot.sourceCutoffAt).toBe("2026-09-17T00:00:00Z");
    // 발급 시각은 주입된 clock의 값이고 봉인 입력의 기준 시각과 다르다.
    expect(response.meta.snapshot.issuedAt).toBe("2026-09-18T01:00:00Z");
    expect(response.meta.snapshot.expiresAt).toBe("2026-09-19T01:00:00Z");
  });

  test("기관 점이 상한에 걸리면 잘렸다고 말하고 전체 수는 잘리기 전 값이다", async () => {
    const reader = readerDouble({
      readTimeSeries: async () => ({
        ...emptyReading,
        targetPoints: [{
          attemptId: 12n,
          revisionId: 34n,
          plottedAt: Temporal.Instant.from("2026-08-04T01:00:00Z"),
          assessmentRateMilli: 90_123n,
        }],
        targetTotal: 9,
        // 전국 비교군에는 기관 관측이 전부 들어 있으므로 겹침 수가 기관 표본 수와 같다(계약 codec).
        comparisonTotal: 20,
        overlapCount: 9,
      }),
    });
    const response = await run(reader);
    expect(response.targetTruncated).toBe(true);
    expect(response.target).toHaveLength(1);
    if (response.meta.state !== "ready") throw new Error("ready 상태여야 한다");
    expect(response.meta.targetSampleCount).toBe(9);
    expect(response.target?.[0]?.assessmentRate).toEqual({ value: "90.123", unit: "percentage-points" });
  });

  test("밀도 칸은 폭에서 오른쪽 끝을 만들고 시간 칸은 다음 눈금까지다", async () => {
    const reader = readerDouble({
      readTimeSeries: async () => ({
        ...emptyReading,
        comparison: {
          kind: "density",
          cells: [{
            fromAt: Temporal.Instant.from("2026-08-03T15:00:00Z"),
            rateFromMilli: 90_100n,
            count: 7,
          }],
        },
        comparisonTotal: 7,
      }),
    });
    const response = await run(reader);
    expect(response.axis?.rateBinWidth).toEqual({ value: "0.100", unit: "percentage-points" });
    if (response.comparison?.kind !== "density") throw new Error("밀도여야 한다");
    const cell = response.comparison.cells[0]!;
    expect(cell.rateFrom.value).toBe("90.100");
    expect(cell.rateTo.value).toBe("90.200");
    // KST로 자른 8월 4일 00시의 다음 눈금은 8월 5일 00시(=UTC 8월 4일 15시)다.
    expect(cell.fromAt).toBe("2026-08-03T15:00:00Z");
    expect(cell.toAt).toBe("2026-08-04T15:00:00Z");
  });

  test("비교군이 점으로 오면 사정률 칸 폭이 없다", async () => {
    const response = await run(readerDouble({}));
    expect(response.axis?.rateBinWidth).toBeNull();
  });

  test("수집 상태는 달을 자리로 삼되 양끝을 요청 기간으로 잘라 빈틈없이 덮는다", async () => {
    const response = await run(readerDouble({}), {
      ...input,
      period: { from: kstDate("2026-07-15"), to: kstDate("2026-09-14") },
    });
    if (response.meta.state !== "ready") throw new Error("ready 상태여야 한다");
    expect(response.meta.periodCoverage.map((entry) => entry.period)).toEqual([
      { from: "2026-07-15", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-09-14" },
    ]);
    expect(response.meta.periodCoverage.every((entry) => entry.target === "none")).toBe(true);
  });

  test("준비된 meta는 계약의 의미 parser를 그대로 통과한다", async () => {
    // 겹침·기간 덮기·스냅샷 시각 순서는 schema가 아니라 codec이 판정한다. presenter가 낸 값을 그
    // parser에 그대로 넣어 두지 않으면 규칙이 갈라진 것을 배포 뒤에야 안다.
    const response = await run(readerDouble({}));
    expect(parseAnalysisMeta(response.meta).state).toBe("ready");
  });

  test("적용한 필터를 그대로 되돌려 주며 명단 범위의 양끝을 유지한다", async () => {
    const response = await run(readerDouble({}));
    expect(response.meta.effectiveFilter.listCountRange).toEqual({ min: 12, max: 24 });
    expect(response.meta.effectiveFilter.excludeAttemptId).toBe("89");
    expect(response.meta.effectiveFilter.itemFilter).toEqual({ kind: "all" });
  });
});

describe("시간 눈금 선택", () => {
  test("넉 달까지는 하루, 두 해 남짓까지는 주, 그보다 길면 달이다", () => {
    expect(timeResolutionOf(1)).toBe("day");
    expect(timeResolutionOf(120)).toBe("day");
    expect(timeResolutionOf(121)).toBe("week");
    expect(timeResolutionOf(800)).toBe("week");
    expect(timeResolutionOf(801)).toBe("month");
    expect(timeResolutionOf(1_900)).toBe("month");
  });
});
