import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import { kstDate } from "../domain/kst-day";
import { organizationId } from "../domain/organization-id";
import type { AnalysisDistributionReader } from "./analysis-distribution-reader";
import type { AnalysisTimeSeriesReader } from "./analysis-time-series-reader";
import { FindAnalysisDistribution, type FindAnalysisDistributionInput } from "./find-analysis-distribution";
import type { MartBuildLineage } from "./mart-build-lineage";

const lineage: MartBuildLineage = {
  buildId: 501n,
  sourceReleaseId: "00000000-0000-0000-0000-000000000501",
  calcVersion: "mart-r2",
  computedAt: Temporal.Instant.from("2026-09-20T00:00:00Z"),
  coverage: null,
  regionScheme: null,
};

const input: FindAnalysisDistributionInput = {
  targetOrganizationId: organizationId(41n),
  excludeAttemptId: null,
  period: { from: kstDate("2026-08-01"), to: kstDate("2026-09-30") },
  dateBasis: "opened",
  comparisonScope: { kind: "national" },
  floorRate: bidRate(canonicalDecimal("87.500", 3)),
  awardMethodCodeValueId: 31n,
  listCountMin: null,
  listCountMax: null,
  itemFilter: { kind: "all" },
};

const axes = { organizationExists: async () => true, regionExists: async () => true } as unknown as AnalysisTimeSeriesReader;

function readerWith(active: MartBuildLineage | null): AnalysisDistributionReader {
  return {
    readDistribution: async () => ({
      lineage: active,
      target: new Map([[-1, 1], [0, 2], [10, 1]]),
      comparison: new Map([[0, 5], [3, 4]]),
    }),
  };
}

const run = (reader: AnalysisDistributionReader) =>
  new EffectRunner().run(new FindAnalysisDistribution(reader, axes).execute(input));

describe("분석 낙찰값 분포 use case", () => {
  test("구간은 하한율에서 시작하는 0.1%p 열 칸이고 두 집단이 같은 경계를 쓴다", async () => {
    const result = await run(readerWith(lineage));
    expect(result.bins).toHaveLength(10);
    expect(result.bins[0]).toMatchObject({ fromMilli: 87_500n, toMilli: 87_600n, targetCount: 2, comparisonCount: 5 });
    expect(result.bins[3]?.comparisonCount).toBe(4);
  });

  test("칸 밖은 따로 세고 전체는 칸과 칸 밖을 모두 더한 수다", async () => {
    const result = await run(readerWith(lineage));
    expect(result.targetOutside).toEqual({ below: 1, above: 1 });
    expect(result.targetTotal).toBe(4);
    expect(result.comparisonTotal).toBe(9);
  });

  test("자료가 아직 없으면 빈 칸 열 개를 0으로 채우지 않는다", async () => {
    // 관측 0건과 아직 발행되지 않음은 사용자가 할 일이 다르다(ADR 0011).
    expect((await run(readerWith(null))).bins).toEqual([]);
  });
});
