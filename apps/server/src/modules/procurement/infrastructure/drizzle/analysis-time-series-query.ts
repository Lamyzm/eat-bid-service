/**
 * @module 책임: 분석 시간축 조회가 쓰는 회차 요약 술어와 실제 점·밀도 칸·교집합·보유율 SQL을 소유한다.
 *
 * 술어를 한 곳에 두는 이유는 같은 조건을 네 질의가 함께 걸기 때문이다. 어느 한 질의만 조건이 어긋나면
 * 화면은 "밀도 합과 표본 수가 다르다"는 형태로만 그 사실을 보게 되고 원인을 알 수 없다.
 */
import { sql, type SQL } from "drizzle-orm";
import { rateMilliText } from "../../application/distribution-statistics";
import type { AnalysisTimeSeriesQuery } from "../../application/analysis-time-series-reader";
import { KST_TIME_ZONE } from "../../domain/kst-month";
import { activeMartBuildId, ORG_ROUND_SUMMARY, worstCoverageOrder } from "./drizzle-mart-build-reader";

/** 밀도 칸 상한이다. 계약의 32,768을 넘기지 않으며 넘으면 잘렸다고 말한다. */
export const DENSITY_CELL_LIMIT = 32_768;

const ACTIVE_BUILD = activeMartBuildId(ORG_ROUND_SUMMARY);

/** X축이 쓰는 시각 열이다. 기간도 축도 같은 열을 써야 점이 자기 구간 밖에 서지 않는다. */
function dateColumn(dateBasis: "opened" | "announced"): SQL {
  return dateBasis === "opened" ? sql`summary.opened_at` : sql`summary.announced_at`;
}

/**
 * 두 집단에 똑같이 걸리는 조건이다.
 *
 * 격리된 회차와 낙찰 관측이 없는 회차를 먼저 빼는 이유는 이것이 분석의 모집단 정의이기 때문이다.
 * 격리 행을 남기면 업무적으로 불가능하다고 판정한 판이 분포를 만들고(EAT-199), 낙찰 관측이 없는 행은
 * 셀 값 자체가 없다. 그 둘을 뺀 모양이 `org_round_summary_analysis_cohort_idx`의 부분 인덱스와 같다.
 *
 * 명단 범위를 걸면 `list_count`가 null인 회차는 빠진다. 명단 크기를 모르는 판을 "범위 안"으로 세면
 * 미확인을 관측으로 바꾸는 것이다(AGENTS 3).
 */
export function analysisBasePredicate(query: AnalysisTimeSeriesQuery): SQL {
  const date = dateColumn(query.dateBasis);
  const parts: SQL[] = [
    sql`summary.build_id = ${ACTIVE_BUILD}`,
    sql`and summary.quarantine_reason is null`,
    sql`and summary.awarded_assessment_rate is not null`,
    sql`and summary.floor_rate = ${rateMilliText(query.floorRateMilli)}::numeric`,
    sql`and summary.award_method_code_value_id = ${query.awardMethodCodeValueId}::bigint`,
    sql`and ${date} >= ${query.from.toString()}::timestamptz`,
    sql`and ${date} < ${query.before.toString()}::timestamptz`,
  ];
  if (query.listCountMin !== null) parts.push(sql`and summary.list_count >= ${query.listCountMin}`);
  if (query.listCountMax !== null) parts.push(sql`and summary.list_count <= ${query.listCountMax}`);
  // 지금 보고 있는 회차는 두 집단 모두에서 뺀다. 자기 자신이 자기 분포를 만들면 안 된다(PDR-0006).
  if (query.excludeAttemptId !== null) {
    parts.push(sql`and summary.auction_attempt_id <> ${query.excludeAttemptId}::bigint`);
  }
  return sql.join(parts, sql` `);
}

/**
 * 기관 쪽에만 걸리는 조건이다. 품목이 여기 있는 이유는 비교군이 언제나 전체 품목이기 때문이다(PDR-0006).
 * 품목은 열이 아니라 다리표로 거는데, 원천 라벨 한 문자열이 원자 여럿이라 단일 열은 "첫 원자"라는
 * 거짓 정체성을 만든다(AGENTS 2, EAT-256).
 */
export function analysisTargetPredicate(query: AnalysisTimeSeriesQuery): SQL {
  const parts: SQL[] = [sql`and summary.organization_id = ${query.targetOrganizationId}::bigint`];
  if (query.targetItemCodeValueId !== null) {
    parts.push(sql`and exists (select 1 from mart.org_round_summary_item bridge
      where bridge.build_id = summary.build_id
        and bridge.auction_attempt_id = summary.auction_attempt_id
        and bridge.item_code_value_id = ${query.targetItemCodeValueId}::bigint)`);
  }
  return sql.join(parts, sql` `);
}

/**
 * 비교 모집단을 좁히는 조건이다. 전국은 좁히지 않으므로 빈 조각이다 — 지역 갈래는 mart의 공고지역
 * 열이 병합된 뒤에 여기 붙는다(EAT-198). 빈 조각을 두는 이유는 교집합 질의가 이 자리를 이미 쓰고 있어서,
 * 지역이 붙을 때 조건을 더할 곳이 한 군데로 남기 때문이다.
 */
export function analysisComparisonPredicate(_query: AnalysisTimeSeriesQuery): SQL {
  return sql``;
}

/** 사정률을 milli 정수로 올린 뒤 폭으로 내림한다. 나눗셈이 정수라 칸 경계가 행마다 흔들리지 않는다. */
function rateBucket(widthMilli: bigint): SQL {
  return sql`(floor((summary.awarded_assessment_rate * 1000) / ${widthMilli.toString()}::numeric)
    * ${widthMilli.toString()}::numeric)::bigint`;
}

/** KST 벽시계로 구간을 자른 뒤 다시 시각으로 되돌린다. UTC로 자르면 하루가 9시간 밀린다. */
function timeBucket(query: AnalysisTimeSeriesQuery): SQL {
  const resolution = sql.raw(`'${query.timeResolution}'`);
  return sql`(date_trunc(${resolution}, ${dateColumn(query.dateBasis)} at time zone ${KST_TIME_ZONE})
    at time zone ${KST_TIME_ZONE})`;
}

/**
 * 실제 점을 시간순으로 읽는다. `count(*) over ()`는 `limit`보다 먼저 계산되므로 한 질의가 잘린 목록과
 * 잘리기 전 전체 수를 함께 준다. 전체 수를 따로 물으면 두 질의 사이에 답이 갈릴 수 있다.
 */
export function analysisPointsSql(query: AnalysisTimeSeriesQuery, scope: "target" | "comparison", limit: number): SQL {
  const narrowing = scope === "target" ? analysisTargetPredicate(query) : analysisComparisonPredicate(query);
  const date = dateColumn(query.dateBasis);
  return sql`
    select summary.auction_attempt_id, summary.auction_revision_id,
           ${date} as plotted_at, summary.awarded_assessment_rate,
           count(*) over () as total_count
      from mart.org_round_summary summary
     where ${analysisBasePredicate(query)} ${narrowing}
     order by ${date}, summary.auction_attempt_id
     limit ${limit}`;
}

/**
 * 밀도 칸을 접는다. 칸 접기를 SQL이 하는 이유는 전국 5.7년이 회차 23만 건이고, 그것을 application으로
 * 올려 세면 인덱스만 읽고 끝날 일이 heap 전체 전송이 되기 때문이다(EAT-198 실측 16.5ms).
 *
 * `sum(count(*)) over ()`도 `limit`보다 먼저 계산되므로 잘린 칸 목록과 잘리기 전 전체 관측 수가 함께 온다.
 */
export function analysisDensitySql(query: AnalysisTimeSeriesQuery): SQL {
  return sql`
    select ${timeBucket(query)} as from_at,
           ${rateBucket(query.rateBinWidthMilli)} as rate_from_milli,
           count(*) as cell_count,
           sum(count(*)) over () as total_count
      from mart.org_round_summary summary
     where ${analysisBasePredicate(query)} ${analysisComparisonPredicate(query)}
     group by 1, 2
     order by 1, 2
     limit ${DENSITY_CELL_LIMIT + 1}`;
}

/**
 * 두 집단에 함께 드는 관측 수다. 전국 비교에서는 기관 관측이 모두 비교군 안에 있어 기관 표본 수와
 * 같아지지만, 그 등식을 여기서 가정하지 않고 두 술어를 실제로 겹쳐 센다. 지역 비교가 붙는 순간
 * 기관이 그 지역 밖일 수 있고, 그때 가정해 둔 등식은 조용히 틀린 수를 낸다.
 */
export function analysisOverlapSql(query: AnalysisTimeSeriesQuery): SQL {
  return sql`
    select count(*) as overlap_count
      from mart.org_round_summary summary
     where ${analysisBasePredicate(query)} ${analysisTargetPredicate(query)} ${analysisComparisonPredicate(query)}`;
}

/**
 * 요청 기간의 달별 보유율이다. 한 달에 여러 지역 행이 걸리므로 가장 나쁜 값을 고른다.
 *
 * 전국 비교군의 모집단은 모든 지역이라 기관 코호트와 같은 최악값을 쓴다. 분포 mart에 기관→지역 축이
 * 없어 그 기관의 회차가 어느 지역 수집에서 왔는지 말할 수 없는 사정도 같다. 전국 분모만 보면 가장
 * 낙관적인 값을 고르는 것이다.
 */
export function analysisCoverageSql(fromMonthFirstDay: string, toMonthFirstDay: string): SQL {
  return sql`
    select to_char(cov.month_kst, 'YYYY-MM') as month_kst,
           (array_agg(cov.coverage order by ${worstCoverageOrder(sql`cov.coverage`)}))[1] as coverage
      from mart.build_coverage cov
     where cov.build_id = ${ACTIVE_BUILD}
       and cov.month_kst >= ${fromMonthFirstDay}::date
       and cov.month_kst <= ${toMonthFirstDay}::date
     group by 1
     order by 1`;
}
