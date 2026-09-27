/**
 * @module 책임: 분석 낙찰값 분포의 구간 경계를 정하고 두 집단을 같은 경계로 세어 구간·구간 밖·전체로 조립한다.
 *
 * 경계를 여기서 정하는 이유는 두 집단과 화면이 같은 경계를 봐야 하기 때문이다. 하한율에서 시작하는 이유는
 * 사용자가 "하한에서 얼마나 위에서 낙찰됐나"로 읽기 때문이다 — 0.1%p 칸이 하한과 어긋나면 하한 바로 위
 * 칸이 하한 아래 회차와 섞인다.
 */
import { Effect } from "effect";
import type { BidRate } from "@eatbid/domain";
import { assertAnalysisAxesExist, type AnalysisRegionNotFound } from "./analysis-axes";
import type { AnalysisBinCounts, AnalysisDistributionReader } from "./analysis-distribution-reader";
import type { AnalysisComparisonScope, AnalysisItemFilter, AnalysisTimeSeriesReader } from "./analysis-time-series-reader";
import { rateTextMilli } from "./distribution-statistics";
import { ProcurementDependencyUnavailable } from "./failures";
import type { AnalysisPeriodInput } from "./find-analysis-time-series";
import type { OrganizationNotFound } from "./list-organization-auction-attempts";
import type { MartBuildLineage } from "./mart-build-lineage";
import { kstDayAfter, kstDayStart } from "../domain/kst-day";
import type { OrganizationId } from "../domain/organization-id";

export interface FindAnalysisDistributionInput {
  readonly targetOrganizationId: OrganizationId;
  readonly excludeAttemptId: bigint | null;
  readonly period: AnalysisPeriodInput;
  readonly dateBasis: "opened" | "announced";
  readonly comparisonScope: AnalysisComparisonScope;
  readonly floorRate: BidRate;
  readonly awardMethodCodeValueId: bigint;
  readonly listCountMin: number | null;
  readonly listCountMax: number | null;
  readonly itemFilter: AnalysisItemFilter;
}

/** 구간 폭(0.1%p)과 칸 수다. 하한에서 1%p 위까지가 낙찰이 몰리는 자리다(2026-09 서울 실측 99%가 그 안). */
const BIN_WIDTH_MILLI = 100n;
const BIN_COUNT = 10;

export interface DistributionBinRecord {
  readonly fromMilli: bigint;
  readonly toMilli: bigint;
  readonly targetCount: number;
  readonly comparisonCount: number;
}

export interface AnalysisDistributionResult {
  readonly lineage: MartBuildLineage | null;
  readonly bins: readonly DistributionBinRecord[];
  readonly targetOutside: { readonly below: number; readonly above: number };
  readonly comparisonOutside: { readonly below: number; readonly above: number };
  readonly targetTotal: number;
  readonly comparisonTotal: number;
}

function total(counts: AnalysisBinCounts): number {
  let sum = 0;
  for (const count of counts.values()) sum += count;
  return sum;
}

export class FindAnalysisDistribution {
  constructor(
    private readonly reader: AnalysisDistributionReader,
    private readonly axes: AnalysisTimeSeriesReader,
  ) {}

  execute(input: FindAnalysisDistributionInput): Effect.Effect<
    AnalysisDistributionResult,
    ProcurementDependencyUnavailable | OrganizationNotFound | AnalysisRegionNotFound,
    never
  > {
    const binFromMilli = rateTextMilli(input.floorRate);
    return assertAnalysisAxesExist(this.axes, input.targetOrganizationId, input.comparisonScope).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.reader.readDistribution({
          targetOrganizationId: input.targetOrganizationId,
          excludeAttemptId: input.excludeAttemptId,
          from: kstDayStart(input.period.from),
          before: kstDayAfter(input.period.to),
          dateBasis: input.dateBasis,
          floorRateMilli: binFromMilli,
          awardMethodCodeValueId: input.awardMethodCodeValueId,
          listCountMin: input.listCountMin,
          listCountMax: input.listCountMax,
          itemFilter: input.itemFilter,
          // 겹쳐 찍을 기관은 표시 축이라 분포의 집합을 바꾸지 않는다(PDR-0007).
          overlayOrganizationIds: [],
          comparisonScope: input.comparisonScope,
          binFromMilli,
          binWidthMilli: BIN_WIDTH_MILLI,
          binCount: BIN_COUNT,
        }),
        catch: (cause) => new ProcurementDependencyUnavailable(cause),
      })),
      Effect.map((reading) => ({
        lineage: reading.lineage,
        // 자료가 없으면 구간도 없다. 빈 칸 열 개를 0으로 채우면 "관측 0건"과 "아직 없음"이 같아진다(ADR 0011).
        bins: reading.lineage === null ? [] : Array.from({ length: BIN_COUNT }, (_, index) => ({
          fromMilli: binFromMilli + BIN_WIDTH_MILLI * BigInt(index),
          toMilli: binFromMilli + BIN_WIDTH_MILLI * BigInt(index + 1),
          targetCount: reading.target.get(index) ?? 0,
          comparisonCount: reading.comparison.get(index) ?? 0,
        })),
        targetOutside: { below: reading.target.get(-1) ?? 0, above: reading.target.get(BIN_COUNT) ?? 0 },
        comparisonOutside: { below: reading.comparison.get(-1) ?? 0, above: reading.comparison.get(BIN_COUNT) ?? 0 },
        targetTotal: total(reading.target),
        comparisonTotal: total(reading.comparison),
      })),
    );
  }
}
