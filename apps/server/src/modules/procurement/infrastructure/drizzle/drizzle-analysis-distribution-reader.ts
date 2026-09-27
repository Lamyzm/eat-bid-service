/**
 * @module 책임: 분석 낙찰값 분포 port를 시간축과 같은 코호트 술어 위의 사정률 구간 집계로 구현한다.
 *
 * 두 집단을 따로 한 번씩 센다. 한 번의 훑기로 두 집단을 가르려면 대상·비교 술어를 불리언으로 다시 써야 하고,
 * 그러면 코호트 정의가 두 벌이 된다. 활성 build는 두 질의 모두 같은 하위 질의로 고정한다.
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  AnalysisBinCounts,
  AnalysisDistributionQuery,
  AnalysisDistributionReader,
  AnalysisDistributionReading,
} from "../../application/analysis-distribution-reader";
import {
  analysisBasePredicate,
  analysisComparisonPredicate,
  analysisTargetPredicate,
} from "./analysis-time-series-query";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import { ORG_ROUND_SUMMARY, readActiveMartBuildLineage } from "./drizzle-mart-build-reader";

/**
 * 구간 번호다. milli 정수로 올린 뒤 정수 나눗셈으로 내린다 — 부동소수로 나누면 90.100 같은 경계 값이 칸마다
 * 흔들린다. 아래 밖은 -1, 위 밖은 `binCount`로 모은다.
 */
function binIndex(query: AnalysisDistributionQuery): SQL {
  return sql`least(greatest(
      floor((summary.awarded_assessment_rate * 1000 - ${query.binFromMilli.toString()}::numeric)
            / ${query.binWidthMilli.toString()}::numeric),
      -1), ${query.binCount})::int`;
}

function binCountsSql(query: AnalysisDistributionQuery, population: SQL): SQL {
  return sql`
    select ${binIndex(query)} as bin, count(*)::int as count
      from mart.org_round_summary summary
     where ${analysisBasePredicate(query)} ${population}
     group by 1`;
}

function countsOf(result: unknown): AnalysisBinCounts {
  const rows = Array.isArray(result) ? result as ReadonlyArray<{ bin: number; count: number }> : [];
  return new Map(rows.map((row) => [Number(row.bin), Number(row.count)]));
}

export class DrizzleAnalysisDistributionReader implements AnalysisDistributionReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async readDistribution(query: AnalysisDistributionQuery): Promise<AnalysisDistributionReading> {
    const [lineage, target, comparison] = await Promise.all([
      readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY),
      this.database.execute(binCountsSql(query, analysisTargetPredicate(query))),
      this.database.execute(binCountsSql(query, analysisComparisonPredicate(query))),
    ]);
    return { lineage, target: countsOf(target), comparison: countsOf(comparison) };
  }
}
