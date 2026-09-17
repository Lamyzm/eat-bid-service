/**
 * @module 책임: 분석 시간축 port를 활성 회차 요약 build의 실제 점·밀도·교집합·보유율 조회로 구현한다.
 *
 * 네 질의를 한 번에 보내는 이유는 같은 조건의 답들이 서로 다른 순간을 보면 안 되기 때문이다. 활성
 * build를 하위 질의로 고정하므로 그 사이 전환이 일어나도 한 답 안에서는 같은 build만 읽힌다(ADR 0034).
 */
import { sql } from "drizzle-orm";
import { rateTextMilli } from "../../application/distribution-statistics";
import type {
  AnalysisComparisonSeriesRecord,
  AnalysisDensityCellRecord,
  AnalysisMonthCoverage,
  AnalysisPointRecord,
  AnalysisTimeSeriesQuery,
  AnalysisTimeSeriesReader,
  AnalysisTimeSeriesReading,
} from "../../application/analysis-time-series-reader";
import { kstMonth, kstMonthFirstDayText, kstMonthOf } from "../../domain/kst-month";
import {
  analysisCoverageSql,
  analysisDensitySql,
  analysisOverlapSql,
  analysisPointsSql,
  DENSITY_CELL_LIMIT,
} from "./analysis-time-series-query";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import {
  coverageValue,
  ORG_ROUND_SUMMARY,
  readActiveMartBuildAsOf,
  readActiveMartBuildLineage,
} from "./drizzle-mart-build-reader";
import { bigintValue } from "./postgres-row-values";

type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type PointRow = Readonly<{
  auction_attempt_id: string | bigint;
  auction_revision_id: string | bigint;
  plotted_at: PostgresTimestamp;
  awarded_assessment_rate: string;
  total_count: string | number | bigint;
}>;

type DensityRow = Readonly<{
  from_at: PostgresTimestamp;
  rate_from_milli: string | number | bigint;
  cell_count: string | number | bigint;
  total_count: string | number | bigint;
}>;

type CoverageRow = Readonly<{ month_kst: string; coverage: string | null }>;

function countOf(value: string | number | bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("Database analysis count is invalid");
  return count;
}

function rows<Row>(result: unknown): ReadonlyArray<Row> {
  return Array.isArray(result) ? result as ReadonlyArray<Row> : [];
}

/**
 * 창 함수가 실은 전체 수는 행마다 같으므로 첫 행에서 읽는다. 행이 하나도 없으면 전체도 0이며, 그것은
 * "조건에 맞는 관측이 없다"는 관측이지 자료가 없다는 뜻이 아니다.
 */
function totalOf(rowsRead: ReadonlyArray<{ total_count: string | number | bigint }>): number {
  const first = rowsRead[0];
  return first === undefined ? 0 : countOf(first.total_count);
}

export function mapPointRow(row: PointRow): AnalysisPointRecord {
  const plottedAt = postgresInstant(row.plotted_at);
  // X축에 설 시각이 없는 회차는 점이 될 수 없다. 술어가 이미 기간으로 걸렀으므로 여기 오면 계보가 깨진 것이다.
  if (plottedAt === null) throw new TypeError("Database analysis point has no plotted timestamp");
  return {
    attemptId: bigintValue(row.auction_attempt_id),
    revisionId: bigintValue(row.auction_revision_id),
    plottedAt,
    assessmentRateMilli: rateTextMilli(row.awarded_assessment_rate),
  };
}

export function mapDensityRow(row: DensityRow): AnalysisDensityCellRecord {
  const fromAt = postgresInstant(row.from_at);
  if (fromAt === null) throw new TypeError("Database analysis density cell has no timestamp");
  return {
    fromAt,
    rateFromMilli: BigInt(row.rate_from_milli),
    count: countOf(row.cell_count),
  };
}

/**
 * 전국 비교군의 모집단은 모든 지역이라 기관 코호트와 같은 최악값을 쓴다. 두 열로 나눠 두는 이유는
 * 지역 비교가 붙는 순간 두 값이 갈라지기 때문이며, 그때 화면의 해석을 바꾸지 않으려면 지금부터 자리가
 * 따로 있어야 한다. 판정이 없는 달은 행이 없다는 뜻이고 그 번역은 use case가 한다(PDR-0003).
 */
export function mapCoverageRow(row: CoverageRow): AnalysisMonthCoverage | null {
  const coverage = coverageValue(row.coverage);
  if (coverage === null) return null;
  return { month: kstMonth(row.month_kst), target: coverage, comparison: coverage };
}

export class DrizzleAnalysisTimeSeriesReader implements AnalysisTimeSeriesReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async organizationExists(organizationId: bigint): Promise<boolean> {
    // 존재 확인은 파생물이 아니라 권위 있는 core 사실에서 읽어야 mart 빌드 지연이 404로 새지 않는다.
    const result = await this.database.execute(sql`
      select 1 as present from core.organization where organization_id = ${organizationId} limit 1`);
    return rows(result).length > 0;
  }

  async readTimeSeries(query: AnalysisTimeSeriesQuery): Promise<AnalysisTimeSeriesReading> {
    const fromMonth = kstMonthFirstDayText(kstMonthOf(query.from));
    // 반열림 구간의 끝은 다음 달 1일 0시일 수 있다. 1밀리초 앞의 시각으로 달을 고르지 않으면 요청하지
    // 않은 달이 보유율 표에 한 줄 더 선다.
    const toMonth = kstMonthFirstDayText(kstMonthOf(query.before.subtract({ milliseconds: 1 })));
    const [pointResult, densityResult, overlapResult, coverageResult, lineage, sourceCutoffAt] = await Promise.all([
      this.database.execute(analysisPointsSql(query, "target", query.targetPointLimit)),
      this.database.execute(analysisDensitySql(query)),
      this.database.execute(analysisOverlapSql(query)),
      this.database.execute(analysisCoverageSql(fromMonth, toMonth)),
      readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY),
      readActiveMartBuildAsOf(this.database, ORG_ROUND_SUMMARY),
    ]);
    const pointRows = rows<PointRow>(pointResult);
    const densityRows = rows<DensityRow>(densityResult);
    const comparisonTotal = totalOf(densityRows);
    return {
      targetPoints: pointRows.map(mapPointRow),
      targetTotal: totalOf(pointRows),
      ...await this.comparison(query, densityRows, comparisonTotal),
      comparisonTotal,
      overlapCount: countOf(rows<{ overlap_count: string | number | bigint }>(overlapResult)[0]?.overlap_count ?? 0),
      coverage: rows<CoverageRow>(coverageResult).map(mapCoverageRow).filter((entry) => entry !== null),
      lineage,
      sourceCutoffAt,
    };
  }

  /**
   * 좁은 범위에서만 실제 점을 다시 읽는다. 밀도를 먼저 접고 그 전체 수로 판단하는 이유는, 점 수를 알기
   * 전에 점을 읽으면 넓은 범위에서 수만 행을 받아 버린 뒤에야 "너무 많다"는 것을 알게 되기 때문이다.
   */
  private async comparison(
    query: AnalysisTimeSeriesQuery,
    densityRows: ReadonlyArray<DensityRow>,
    comparisonTotal: number,
  ): Promise<{ comparison: AnalysisComparisonSeriesRecord; comparisonTruncated: boolean }> {
    if (comparisonTotal <= query.comparisonPointLimit) {
      const result = await this.database.execute(analysisPointsSql(query, "comparison", query.comparisonPointLimit));
      return {
        comparison: { kind: "points", points: rows<PointRow>(result).map(mapPointRow) },
        comparisonTruncated: false,
      };
    }
    return {
      comparison: { kind: "density", cells: densityRows.slice(0, DENSITY_CELL_LIMIT).map(mapDensityRow) },
      comparisonTruncated: densityRows.length > DENSITY_CELL_LIMIT,
    };
  }
}
