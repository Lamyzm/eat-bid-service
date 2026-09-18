/**
 * @module 책임: 분석 조건 막대의 지역·품목·기관 건수를 세는 SQL을 소유한다.
 *
 * 건수는 **그 축 하나만 푼 집합**에서 센다. 축을 푼다는 것은 그 조건을 `전체`로 바꿔 같은 술어 생성기에
 * 다시 넣는 것이고, 그래서 "이것으로 바꾸면 몇 건이 되나"라는 약속이 술어 한 벌에서 나온다(EAT-241).
 */
import { sql, type SQL } from "drizzle-orm";
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import type { AnalysisConditionOptionsQuery } from "../../application/analysis-condition-options-reader";
import type { AnalysisCohortQuery } from "../../application/analysis-time-series-reader";
import { analysisBasePredicate, analysisComparisonPredicate } from "./analysis-time-series-query";

/** 기관 이름 검색의 상한이다. 넘으면 잘렸다고 말하고 화면이 검색어를 더 적으라고 안내한다. */
export const ORGANIZATION_OPTION_LIMIT = 50;

/** 지역 축을 푼다. 비교 지역을 전국으로 되돌린 질의가 곧 "지역을 안 건 집합"이다. */
function withoutRegionAxis(query: AnalysisConditionOptionsQuery): AnalysisCohortQuery {
  return { ...query, comparisonScope: { kind: "national" } };
}

/** 품목 축을 푼다. 조건을 `전체`로 바꾸는 것이 곧 그 축을 안 건 집합이다. */
function withoutItemAxis(query: AnalysisConditionOptionsQuery): AnalysisCohortQuery {
  return { ...query, itemFilter: { kind: "all" } };
}

/**
 * 시도별 건수와 지역 미확인 수를 한 번에 낸다. `null` 행을 따로 세는 이유는 그 회차가 다른 지역의
 * 것이 아니라 **어느 지역인지 아직 번역되지 않은** 회차이기 때문이다(ADR 0035 결정 6).
 */
export function analysisSidoCountSql(query: AnalysisConditionOptionsQuery): SQL {
  const released = withoutRegionAxis(query);
  return sql`
    with ${regionLabelJoin()}
    select summary.region_sido_code_value_id as code_value_id,
           region.code as code,
           region.label as label,
           count(*) as row_count
      from mart.org_round_summary summary
      left join region_label region on region.code_value_id = summary.region_sido_code_value_id
     where ${analysisBasePredicate(released)}
     group by 1, 2, 3
     order by 4 desc, 2`;
}

/** 고른 시도 안의 시군구다. 시도를 안 골랐으면 부르지 않는다 — 전국 시군구를 한 번에 세우지 않는다. */
export function analysisSigunguCountSql(query: AnalysisConditionOptionsQuery, sido: bigint): SQL {
  const released = withoutRegionAxis(query);
  return sql`
    with ${regionLabelJoin()}
    select summary.region_sigungu_code_value_id as code_value_id,
           region.code as code,
           region.label as label,
           count(*) as row_count
      from mart.org_round_summary summary
      left join region_label region on region.code_value_id = summary.region_sigungu_code_value_id
     where ${analysisBasePredicate(released)}
       and summary.region_sido_code_value_id = ${sido}::bigint
       and summary.region_sigungu_code_value_id is not null
     group by 1, 2, 3
     order by 4 desc, 2`;
}

/**
 * 품목 원자별 건수와 `품목 미확인` 수다. 한 회차가 원자 여럿을 가지므로 합은 전체보다 클 수 있다.
 * 미확인은 다리 행이 하나도 없는 회차이며 `null` 원자 한 줄로 함께 온다.
 */
export function analysisItemCountSql(query: AnalysisConditionOptionsQuery): SQL {
  const released = withoutItemAxis(query);
  return sql`
    select atom.code as item_code, count(*) as row_count
      from mart.org_round_summary summary
      left join lateral (
        select value.code
          from mart.org_round_summary_item bridge
          join core.code_value value on value.code_value_id = bridge.item_code_value_id
          join core.code_scheme scheme on scheme.code_scheme_id = value.code_scheme_id
         where bridge.build_id = summary.build_id
           and bridge.auction_attempt_id = summary.auction_attempt_id
           and scheme.namespace = ${CODE_SCHEME_NAMES.auctionItem}
      ) atom on true
     where ${analysisBasePredicate(released)} ${analysisComparisonPredicate(released)}
     group by 1`;
}

/**
 * 고른 비교 지역 안에서 회차가 있는 기관이다. 검색어는 `strpos`로 판정한다 — 사용자 입력에 `like`
 * 메타문자를 열지 않는다(오늘 화면의 검색과 같은 규칙).
 *
 * 지역은 그 기관의 **가장 최근 회차**에서 관측한 시군구다. 한 기관의 회차가 여러 시군구에 걸릴 수 있어
 * 하나를 고를 수밖에 없고, 고른 근거를 최근성으로 못박는다. 상한보다 한 줄 더 읽어 잘렸는지를 안다.
 */
export function analysisOrganizationOptionSql(query: AnalysisConditionOptionsQuery): SQL {
  const search = query.organizationQuery === null
    ? sql``
    : sql`and strpos(organization.canonical_name, ${query.organizationQuery}) > 0`;
  return sql`
    with ${regionLabelJoin()}
    select summary.organization_id as organization_id,
           organization.canonical_name as organization_name,
           count(*) as row_count,
           (array_agg(summary.region_sigungu_code_value_id
                      order by summary.opened_at desc nulls last))[1] as region_code_value_id,
           (array_agg(region.code order by summary.opened_at desc nulls last))[1] as region_code,
           (array_agg(region.label order by summary.opened_at desc nulls last))[1] as region_label
      from mart.org_round_summary summary
      join core.organization organization on organization.organization_id = summary.organization_id
      left join region_label region on region.code_value_id = summary.region_sigungu_code_value_id
     where ${analysisBasePredicate(query)} ${analysisComparisonPredicate(query)} ${search}
     group by 1, 2
     order by 3 desc, 2
     limit ${query.organizationLimit + 1}`;
}

/**
 * 지역 라벨은 최신 관측 하나다. 목록·요약이 쓰는 규칙과 같아야 조건 막대의 이름과 그림의 이름이
 * 갈리지 않는다. 라벨이 없는 코드도 남긴다 — 코드목록 수집이 안 돈 DB에서 항목이 사라지면 그 지역의
 * 회차가 조건에서 보이지 않는다(AGENTS 3).
 */
function regionLabelJoin(): SQL {
  return sql`
    region_label as (
      select code.code_value_id,
             code.code,
             (select observation.label
                from core.code_label_observation observation
               where observation.code_value_id = code.code_value_id
               order by observation.observed_at desc, observation.code_label_observation_id desc
               limit 1) as label
        from core.code_value code
        join core.code_scheme scheme on scheme.code_scheme_id = code.code_scheme_id
       where scheme.namespace in (
         ${CODE_SCHEME_NAMES.auctionLocationSido}, ${CODE_SCHEME_NAMES.auctionLocationSigungu}
       )
    )`;
}
