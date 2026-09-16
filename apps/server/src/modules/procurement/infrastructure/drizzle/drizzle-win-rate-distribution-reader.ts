/**
 * @module 책임: 낙찰률 분포 port를 활성 build의 mart 달×칸 조회와 코호트 한정 보유율 조회로 구현한다.
 *
 * 달×칸을 한 질의로 읽는 이유는 상위 합과 달별 합이 서로 다른 스냅샷을 보면 안 되기 때문이다
 * (설계 §5.2). 재집계와 합산은 조회가 아니라 application의 순수 계산이 한다.
 */
import { sql, type SQL } from "drizzle-orm";
import { rateTextMilli, type DistributionBinCount } from "../../application/distribution-statistics";
import type {
  DistributionMonthCoverage,
  DistributionMonthRows,
  DistributionReading,
  WinRateDistributionQuery,
  WinRateDistributionReader,
} from "../../application/win-rate-distribution-reader";
import {
  cohortOrganizationId,
  cohortRegionCodeValueId,
  type DistributionCohort,
} from "../../domain/distribution-cohort";
import { kstMonth, kstMonthFirstDayText } from "../../domain/kst-month";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import {
  activeMartBuildId,
  coverageValue,
  readActiveMartBuildLineage,
  worstCoverageOrder,
} from "./drizzle-mart-build-reader";

const WIN_RATE_DISTRIBUTION = "win_rate_distribution_monthly";

type DistributionRow = Readonly<{
  month_kst: string;
  bin_lower: string;
  bin_width: string;
  attempt_count: string | number | bigint;
}>;

type CoverageRow = Readonly<{ month_kst: string; coverage: string }>;

/**
 * `month_kst`는 조회가 `to_char(..., 'YYYY-MM')`으로 이미 달 이름까지 좁혀 돌려준다. driver가 주는
 * `Date`를 여기서 읽지 않는 이유는 두 가지다. 그 표현의 유일한 경계는 `drizzle-auction-reader.ts`이고
 * (AGENTS 17), 이 값은 시각이 아니라 달력 구간이라 시간대 변환을 한 번 더 거치면 하루가 밀려 달이 바뀐다.
 */
function monthOf(value: string) {
  return kstMonth(value);
}

function countOf(value: string | number | bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("Database attempt count is invalid");
  return count;
}

export function mapCoverageRow(row: CoverageRow): DistributionMonthCoverage {
  const coverage = coverageValue(row.coverage);
  if (coverage === null) throw new TypeError("Database coverage row has no verdict");
  return { month: monthOf(row.month_kst), coverage };
}

/**
 * 조회는 달 순서로 오므로 달이 바뀔 때마다 새 묶음을 연다. `storedBinWidthMilli`는 읽은 행들의 폭이며
 * 같은 build 안에서 상수다. 갈라진 폭을 조용히 합치면 화면이 요청하지 않은 눈금을 보게 된다.
 */
export function groupDistributionRows(rows: readonly DistributionRow[]): {
  readonly months: readonly DistributionMonthRows[];
  readonly storedBinWidthMilli: bigint | null;
} {
  const byMonth = new Map<string, DistributionBinCount[]>();
  let storedBinWidthMilli: bigint | null = null;
  for (const row of rows) {
    const widthMilli = rateTextMilli(row.bin_width);
    if (storedBinWidthMilli === null) storedBinWidthMilli = widthMilli;
    else if (storedBinWidthMilli !== widthMilli) throw new TypeError("Active mart build has inconsistent bin widths");
    const month = monthOf(row.month_kst);
    const bins = byMonth.get(month) ?? [];
    bins.push({ lowerMilli: rateTextMilli(row.bin_lower), count: countOf(row.attempt_count) });
    byMonth.set(month, bins);
  }
  return {
    months: [...byMonth.entries()].map(([month, bins]) => ({ month: kstMonth(month), bins })),
    storedBinWidthMilli,
  };
}

// scope가 요구하지 않는 축은 `is null`을 강제한다. mart의 check 제약과 같은 규칙을 조회에서도 닫아야
// 다른 모집단의 행이 이 코호트로 새지 않는다.
function axisPredicate(cohort: DistributionCohort): SQL {
  const region = cohortRegionCodeValueId(cohort);
  const organization = cohortOrganizationId(cohort);
  return sql`
    and summary.region_code_value_id ${region === null ? sql`is null` : sql`= ${region}::bigint`}
    and summary.organization_id ${organization === null ? sql`is null` : sql`= ${organization}::bigint`}`;
}

/**
 * 보유율은 build 전체가 아니라 요청한 (지역, 달)에 걸린 행만 봐야 한다. 기관 모집단은 분포 mart에
 * 기관→지역 축이 없어 그 기관의 회차가 어느 지역 수집에서 왔는지 말할 수 없으므로 그 달의 모든 지역
 * 판정 중 최악값을 쓴다. 전국 분모를 쓰면 가장 낙관적인 값을 고르는 것이다(설계 §5.3).
 */
function coverageAxisPredicate(cohort: DistributionCohort): SQL {
  if (cohort.scope === "organization") return sql``;
  const region = cohortRegionCodeValueId(cohort);
  return region === null
    ? sql`and worst.region_code_value_id is null`
    : sql`and worst.region_code_value_id = ${region}::bigint`;
}

export class DrizzleWinRateDistributionReader implements WinRateDistributionReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async cohortExists(cohort: DistributionCohort): Promise<boolean> {
    // 존재 확인은 파생물이 아니라 권위 있는 core 사실에서 읽어야 mart 빌드 지연이 404로 새지 않는다.
    const query = cohort.scope === "organization"
      ? sql`select 1 as present from core.organization where organization_id = ${cohort.organizationId} limit 1`
      : cohort.scope === "national"
        ? sql`select 1 as present`
        : sql`select 1 as present from core.code_value where code_value_id = ${cohort.regionCodeValueId}::bigint limit 1`;
    const result = await this.database.execute(query);
    return Array.isArray(result) && result.length > 0;
  }

  async readDistribution(query: WinRateDistributionQuery): Promise<DistributionReading> {
    const [rows, coverage, lineage] = await Promise.all([
      this.binRows(query),
      this.coverageRows(query),
      readActiveMartBuildLineage(this.database, WIN_RATE_DISTRIBUTION),
    ]);
    return { ...groupDistributionRows(rows), coverage, lineage };
  }

  private async binRows(query: WinRateDistributionQuery): Promise<DistributionRow[]> {
    const result = await this.database.execute(sql`
      select to_char(summary.month_kst, 'YYYY-MM') as month_kst,
             summary.bin_lower, summary.bin_width, summary.attempt_count
      from mart.win_rate_distribution_monthly summary
      where summary.build_id = ${activeMartBuildId(WIN_RATE_DISTRIBUTION)}
        and summary.scope = ${query.cohort.scope}
        ${axisPredicate(query.cohort)}
        and summary.floor_rate = ${query.floorRate}::numeric
        and summary.award_method_code_value_id = ${query.awardMethodCodeValueId}::bigint
        and summary.month_kst between ${kstMonthFirstDayText(query.period.from)}::date
                                  and ${kstMonthFirstDayText(query.period.to)}::date
      -- unique 코호트 key의 열 순서가 이 술어 순서와 같아 planner가 정렬 없이 index range scan을 쓴다.
      order by summary.month_kst, summary.bin_lower
    `);
    return Array.isArray(result) ? result as DistributionRow[] : [];
  }

  private async coverageRows(query: WinRateDistributionQuery): Promise<DistributionMonthCoverage[]> {
    const result = await this.database.execute(sql`
      select to_char(worst.month_kst, 'YYYY-MM') as month_kst,
             (array_agg(worst.coverage order by ${worstCoverageOrder(sql`worst.coverage`)}))[1] as coverage
      from mart.build_coverage worst
      where worst.build_id = ${activeMartBuildId(WIN_RATE_DISTRIBUTION)}
        and worst.month_kst between ${kstMonthFirstDayText(query.period.from)}::date
                                and ${kstMonthFirstDayText(query.period.to)}::date
        ${coverageAxisPredicate(query.cohort)}
      group by 1
    `);
    const rows = Array.isArray(result) ? result as CoverageRow[] : [];
    return rows.map(mapCoverageRow);
  }
}
