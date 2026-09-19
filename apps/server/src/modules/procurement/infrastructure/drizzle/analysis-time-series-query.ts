/**
 * @module 책임: 분석 시간축 조회가 쓰는 회차 요약 술어와 실제 점·밀도 칸·교집합·보유율 SQL을 소유한다.
 *
 * 술어를 한 곳에 두는 이유는 같은 조건을 네 질의가 함께 걸기 때문이다. 어느 한 질의만 조건이 어긋나면
 * 화면은 "밀도 합과 표본 수가 다르다"는 형태로만 그 사실을 보게 되고 원인을 알 수 없다.
 */
import { sql, type SQL } from "drizzle-orm";
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import { bigintArrayLiteral, textArrayLiteral } from "../../../../platform/database/sql-values";
import { rateMilliText } from "../../application/distribution-statistics";
import type {
  AnalysisCohortQuery,
  AnalysisItemFilter,
  AnalysisTimeSeriesQuery,
} from "../../application/analysis-time-series-reader";
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
export function analysisBasePredicate(query: AnalysisCohortQuery): SQL {
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
  const item = itemPredicate(query.itemFilter);
  if (item !== null) parts.push(item);
  return sql.join(parts, sql` `);
}

/** 이 회차에 품목 다리 행이 하나도 없다는 술어다. `품목 미확인`의 정의가 여기 한 곳에만 있다. */
function itemBridgeAbsent(): SQL {
  return sql`not exists (
    select 1 from mart.org_round_summary_item bridge
     where bridge.build_id = summary.build_id
       and bridge.auction_attempt_id = summary.auction_attempt_id)`;
}

/**
 * 품목 술어다. **기본 술어에 있으므로 기관 점·비교 구름·겹침·밀도 전부에 같게 걸린다**(PDR-0007).
 *
 * 원자는 OR이다 — 하나라도 붙어 있으면 걸린다. 라벨 문자열이 아니라 코드로 조인하며 체계로 닫는다.
 * 코드 문자열은 여러 체계에 있을 수 있어 체계 없이 조인하면 다른 어휘의 같은 글자를 잡는다(AGENTS 2·6).
 */
function itemPredicate(filter: AnalysisItemFilter): SQL | null {
  if (filter.kind === "all") return null;
  if (filter.kind === "unknown") return sql`and ${itemBridgeAbsent()}`;
  const matched = sql`exists (
    select 1
      from mart.org_round_summary_item bridge
      join core.code_value value on value.code_value_id = bridge.item_code_value_id
      join core.code_scheme scheme on scheme.code_scheme_id = value.code_scheme_id
     where bridge.build_id = summary.build_id
       and bridge.auction_attempt_id = summary.auction_attempt_id
       and scheme.namespace = ${CODE_SCHEME_NAMES.auctionItem}
       and value.code = any(${textArrayLiteral(filter.atoms)}::text[]))`;
  // 미확인을 함께 보려는 요청은 그 회차가 조건에 안 맞는 것이 아니라 답할 수 없는 회차임을 아는 요청이다.
  return filter.unknown ? sql`and (${matched} or ${itemBridgeAbsent()})` : sql`and ${matched}`;
}

/** 기관 쪽에만 걸리는 조건이다. 품목은 이제 두 집단 공통이라 기본 술어가 갖는다(PDR-0007). */
export function analysisTargetPredicate(query: AnalysisCohortQuery): SQL {
  return sql`and summary.organization_id = ${query.targetOrganizationId}::bigint`;
}

/**
 * 비교 모집단을 좁히는 조건이다. 전국은 좁히지 않으므로 빈 조각이다.
 *
 * 지역은 **체계가 열을 고른다.** 시도와 시군구가 서로 다른 code scheme이라 mart도 두 열이며, 코드값
 * id만 보고 두 열을 함께 훑으면 같은 숫자가 두 체계의 구역으로 읽힌다(AGENTS 6, ADR 0035). 번역되지
 * 않아 null인 행은 그 지역 모집단에 들지 않는다 — 매핑 없음은 행의 부재다(ADR 0035 결정 6).
 */
export function analysisComparisonPredicate(query: AnalysisCohortQuery): SQL {
  const scope = query.comparisonScope;
  if (scope.kind === "national") return sql``;
  const column = scope.scheme === CODE_SCHEME_NAMES.auctionLocationSido
    ? sql`summary.region_sido_code_value_id`
    : sql`summary.region_sigungu_code_value_id`;
  return sql`and ${column} = ${scope.codeValueId}::bigint`;
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
 * 겹쳐 찍을 기관들의 점을 한 질의로 읽는다. 기관마다 따로 물으면 여섯 번의 왕복이 되고, 그 사이
 * build가 바뀌면 한 그림 안의 점들이 서로 다른 발행을 보게 된다(ADR 0034).
 *
 * 기관별 상한은 `row_number`로 건다 — 전체를 자르면 앞선 기관이 상한을 다 쓰고 뒤 기관이 한 점도 못
 * 받는다. 대상 기관 술어를 쓰지 않는 이유는 여기서 좁히는 것이 기관 축 하나뿐이기 때문이다.
 */
export function analysisOverlayPointsSql(query: AnalysisCohortQuery, limitPerOrganization: number): SQL {
  const date = dateColumn(query.dateBasis);
  const ids = bigintArrayLiteral(query.overlayOrganizationIds);
  return sql`
    select ranked.organization_id, ranked.auction_attempt_id, ranked.auction_revision_id,
           ranked.plotted_at, ranked.awarded_assessment_rate, ranked.total_count
      from (
        select summary.organization_id,
               summary.auction_attempt_id,
               summary.auction_revision_id,
               ${date} as plotted_at,
               summary.awarded_assessment_rate,
               count(*) over (partition by summary.organization_id) as total_count,
               row_number() over (partition by summary.organization_id order by ${date},
                                  summary.auction_attempt_id) as position
          from mart.org_round_summary summary
         where ${analysisBasePredicate(query)}
           and summary.organization_id = any(${ids}::bigint[])
      ) ranked
     where ranked.position <= ${limitPerOrganization}
     order by ranked.organization_id, ranked.plotted_at, ranked.auction_attempt_id`;
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
 * 기관 코호트는 그 달의 모든 지역 판정 중 최악값을 쓴다. 보유율 표에 기관 축이 없어 그 기관의 회차가
 * 어느 지역 수집에서 왔는지 말할 수 없기 때문이며, 전국 분모만 보면 가장 낙관적인 값을 고르는 것이다.
 * 전국 비교군의 모집단도 모든 지역이라 같은 값이고, 지역 비교군만 그 지역의 행으로 좁힌다.
 *
 * 지역 비교에서 그 달에 그 지역 행이 없으면 값이 없다. 그것을 기관 쪽 최악값으로 메우면 묻지 않은
 * 모집단의 판정을 그 지역의 판정이라고 말하는 것이므로, null로 두고 번역은 use case가 한다(PDR-0003).
 */
export function analysisCoverageSql(
  query: AnalysisTimeSeriesQuery,
  fromMonthFirstDay: string,
  toMonthFirstDay: string,
): SQL {
  const scope = query.comparisonScope;
  const worst = worstCoverageOrder(sql`cov.coverage`);
  const comparison = scope.kind === "national"
    ? sql`(array_agg(cov.coverage order by ${worst}))[1]`
    : sql`(array_agg(cov.coverage order by ${worst})
             filter (where cov.region_code_value_id = ${scope.codeValueId}::bigint))[1]`;
  return sql`
    select to_char(cov.month_kst, 'YYYY-MM') as month_kst,
           (array_agg(cov.coverage order by ${worst}))[1] as target_coverage,
           ${comparison} as comparison_coverage
      from mart.build_coverage cov
     where cov.build_id = ${ACTIVE_BUILD}
       and cov.month_kst >= ${fromMonthFirstDay}::date
       and cov.month_kst <= ${toMonthFirstDay}::date
     group by 1
     order by 1`;
}
