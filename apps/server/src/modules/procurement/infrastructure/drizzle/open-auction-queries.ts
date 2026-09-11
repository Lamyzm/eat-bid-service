/**
 * @module 책임: 열린 공고 목록이 활성 스냅샷 build에서 "열림"을 판정하고 keyset·표본 수·(기관, 하한율) 회차 요약을 읽는 SQL 조각을 소유한다.
 *
 * 세 조회(anchor 확인·페이지·표본 수)가 같은 "열림" 정의를 써야 한다. 정의가 두 곳에 있으면 표본 수와
 * 행이 서로 다른 코호트를 말하게 되므로 CTE 하나를 여기서만 만든다.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Temporal } from "@eatbid/domain";
import type { OpenAuctionQuery } from "../../application/open-auction-reader";
import { activeMartBuildId } from "./drizzle-mart-build-reader";
import {
  eligibilityAreaCodeCte,
  eligibilityAreasLateral,
  eligibilityMatchedExpression,
  eligibilityObservedExpression,
  matchedEligibilityAreaCte,
} from "./eligibility-area-sql";

export const OPEN_AUCTION_SNAPSHOT = "open_auction_snapshot";
export const ORG_ROUND_SUMMARY = "org_round_summary";

// Instant는 driver가 모르는 타입이라 ISO 문자열로 넘기고 SQL 쪽에서 timestamptz로 닫는다. Date를 거치면
// 밀리초 아래가 잘리고 계층 경계를 `Date`로 통과시키는 셈이라 금지다(AGENTS 15).
function instantParameter(value: Temporal.Instant): string {
  return value.toString();
}

/**
 * 열림의 정의다. 활성 스냅샷 build에서 attempt마다 `observed_at`이 가장 큰 관측 하나를 고르고, 그중
 * `closes_at > asOf`인 행이 열린 공고다. 마감을 관측하지 못한 행(null)은 목록에 남기되 정렬 맨 뒤에
 * 두고, 기간 필터가 있으면 그 행은 **제외**한다 — 기간을 지정한 사용자에게 마감 미확인 행을 섞어 주면
 * 그 필터가 무엇을 골랐는지 알 수 없다.
 *
 * 지역은 활성 build가 선언한 체계의 code value id 하나로 거르며 시도·시군구 어느 축이든 그 id를 가진
 * 행이 남는다. 품목은 아직 code scheme이 없어 관측 라벨 완전일치다(EAT-39 판정 A·B).
 */
export function openRowsCte(query: OpenAuctionQuery): SQL {
  const asOf = instantParameter(query.asOf);
  const eligibility = query.eligibilityAreaCodeValueIds;
  // 필터가 없어도 두 판정 열은 그대로 만든다. 목록이 행마다 `제한지역 미관측`을 말해야 하고, 열이
  // 조건부로 생기면 세 조회가 서로 다른 CTE 모양을 보게 된다.
  const eligibilityFilter: SQL = eligibility === null
    ? sql``
    : sql` and (open_scope.eligibility_matched or not open_scope.eligibility_observed)`;
  return sql`
    with ${eligibilityAreaCodeCte()},
    ${matchedEligibilityAreaCte(eligibility ?? [])},
    snapshot as (
      select distinct on (snapshot.auction_attempt_id)
        snapshot.auction_attempt_id,
        snapshot.organization_id,
        snapshot.organization_label,
        snapshot.item_label,
        snapshot.floor_rate,
        snapshot.region_sido_code_value_id,
        snapshot.region_sigungu_code_value_id,
        snapshot.terms_revision_id,
        snapshot.closes_at,
        snapshot.base_amount,
        snapshot.currency,
        snapshot.bid_count,
        snapshot.observed_at,
        snapshot.source_last_changed_at
      from mart.open_auction_snapshot snapshot
      where snapshot.build_id = ${activeMartBuildId(OPEN_AUCTION_SNAPSHOT)}
      order by snapshot.auction_attempt_id, snapshot.observed_at desc
    ),
    open_scope as (
      select snapshot.*,
             ${eligibilityObservedExpression(sql`snapshot.terms_revision_id`)} as eligibility_observed,
             ${eligibilityMatchedExpression(sql`snapshot.terms_revision_id`)} as eligibility_matched
      from snapshot
    ),
    open_rows as (
      select open_scope.*
      from open_scope
      where (open_scope.closes_at is null or open_scope.closes_at > ${asOf}::timestamptz)
        and (${query.closesWithinHours}::int is null
             or (open_scope.closes_at is not null
                 and open_scope.closes_at <= ${asOf}::timestamptz + make_interval(hours => ${query.closesWithinHours}::int)))
        and (${query.baseAmountMin}::numeric is null or open_scope.base_amount >= ${query.baseAmountMin}::numeric)
        and (${query.baseAmountMax}::numeric is null or open_scope.base_amount <= ${query.baseAmountMax}::numeric)
        and (${query.regionCodeValueId}::bigint is null
             or open_scope.region_sido_code_value_id = ${query.regionCodeValueId}::bigint
             or open_scope.region_sigungu_code_value_id = ${query.regionCodeValueId}::bigint)
        and (${query.itemLabel}::text is null or open_scope.item_label = ${query.itemLabel}::text)${eligibilityFilter}
    )
  `;
}

export function cursorAnchorQuery(query: OpenAuctionQuery, cursor: bigint): SQL {
  return sql`
    ${openRowsCte(query)}
    select 1 as present from open_rows where open_rows.auction_attempt_id = ${cursor}::bigint limit 1
  `;
}

export function sampleCountQuery(query: OpenAuctionQuery): SQL {
  // 표본 수는 cursor와 무관해야 하므로 페이지 조건을 뺀 같은 CTE를 한 번 더 센다. 참가제한지역 판정
  // 분해를 같은 조회에서 함께 세는 이유는, 따로 세면 화면이 말한 "9건 + 미관측 7건"의 합이 표시 행 수와
  // 어긋날 수 있기 때문이다. 두 판정은 서로 배타적이다 — 관측하지 못한 행은 매칭될 수 없다.
  return sql`
    ${openRowsCte(query)}
    select count(*)::int as sample_count,
           count(*) filter (where open_rows.eligibility_matched)::int as eligibility_matched_count,
           count(*) filter (where not open_rows.eligibility_observed)::int as eligibility_unobserved_count
      from open_rows
  `;
}

/**
 * 지역 코드 참조 하나를 lateral 1행으로 닫는다. 라벨은 정체성이 아니므로 가장 나중에 관측된 것 하나만
 * 싣고, 체계 이름을 함께 실어 화면이 이 코드가 어느 체계의 것인지 build 계보와 대조할 수 있게 한다(AGENTS 6).
 */
function regionReferenceJoin(column: SQL, alias: string): SQL {
  return sql`
    left join lateral (
      select code.code_value_id,
             code.code,
             scheme.namespace as scheme,
             (select observation.label
                from core.code_label_observation observation
               where observation.code_value_id = code.code_value_id
               order by observation.observed_at desc, observation.code_label_observation_id desc
               limit 1) as label
        from core.code_value code
        join core.code_scheme scheme on scheme.code_scheme_id = code.code_scheme_id
       where code.code_value_id = ${column}
    ) ${sql.raw(alias)} on true`;
}

export function pageQuery(query: OpenAuctionQuery): SQL {
  const asOf = instantParameter(query.asOf);
  const orgBuild = activeMartBuildId(ORG_ROUND_SUMMARY);
  return sql`
    ${openRowsCte(query)}
    select
      open_rows.auction_attempt_id,
      open_rows.organization_id,
      open_rows.organization_label,
      organization.type as organization_type,
      open_rows.item_label,
      open_rows.floor_rate,
      open_rows.terms_revision_id,
      open_rows.closes_at,
      open_rows.base_amount,
      open_rows.currency,
      open_rows.bid_count,
      open_rows.observed_at,
      open_rows.source_last_changed_at,
      region_sido.code_value_id as region_sido_code_value_id,
      region_sido.code as region_sido_code,
      region_sido.scheme as region_sido_scheme,
      region_sido.label as region_sido_label,
      region_sigungu.code_value_id as region_sigungu_code_value_id,
      region_sigungu.code as region_sigungu_code,
      region_sigungu.scheme as region_sigungu_scheme,
      region_sigungu.label as region_sigungu_label,
      eligibility.areas as eligibility_areas,
      summary.attempt_count,
      summary.median_list_count,
      summary.list_count_sample_count,
      last_round.auction_attempt_id as last_round_attempt_id,
      last_round.opened_at as last_round_opened_at,
      last_round.awarded_bid_rate as last_round_awarded_bid_rate,
      last_round.day_floor_bid_rate as last_round_day_floor_bid_rate,
      last_round.list_count as last_round_list_count,
      last_round.below_day_floor_count as last_round_below_day_floor_count
    from open_rows
    left join core.organization organization on organization.organization_id = open_rows.organization_id
    ${regionReferenceJoin(sql`open_rows.region_sido_code_value_id`, "region_sido")}
    ${regionReferenceJoin(sql`open_rows.region_sigungu_code_value_id`, "region_sigungu")}
    ${eligibilityAreasLateral(sql`open_rows.terms_revision_id`, "eligibility")}
    -- 요약의 grain은 기관이 아니라 (기관, 하한율)이다. 하한율이 다르면 그날 하한이 다른 자리에 서서
    -- 낙찰 투찰률도 참여 규모도 겹치지 않는 판이 되므로 한 기관 안에서도 섞지 않는다
    -- (screen-system §6.4.1, PDR-0004). 품목은 반대로 좁히지 않는다 — 하한율과 명단 크기를 고정하면
    -- 품목별 낙찰 사정률 중앙값이 0.041 안에 들어와 표본만 줄고 갈리는 것이 없다(2026-09-11 실측).
    -- 활성 org_round_summary build 하나만 읽으며, percentile_disc는 실제 관측된 명단 수 하나를 고르는
    -- 것이지 평균이 아니고 명단이 미관측인 회차는 표본에서 빠진다(AGENTS 7).
    left join lateral (
      select count(*)::int as attempt_count,
             (percentile_disc(0.5) within group (order by summary_row.list_count)
                filter (where summary_row.list_count is not null))::int as median_list_count,
             count(summary_row.list_count)::int as list_count_sample_count
        from mart.org_round_summary summary_row
       where summary_row.build_id = ${orgBuild}
         and summary_row.organization_id = open_rows.organization_id
         and summary_row.floor_rate = open_rows.floor_rate
    ) summary on open_rows.organization_id is not null and open_rows.floor_rate is not null
    -- 최근 회차의 다섯 값은 반드시 같은 회차에서 오고, 그 회차의 하한율은 이 행의 하한율과 같아야 한다.
    -- 개찰 시각이 기준 시각을 지난 회차만 "개찰됨"이며 미관측(null)은 개찰됐다고 단정할 수 없어 빠진다(AGENTS 3).
    left join lateral (
      select round_row.auction_attempt_id,
             round_row.opened_at,
             round_row.awarded_bid_rate,
             round_row.day_floor_bid_rate,
             round_row.list_count,
             round_row.below_day_floor_count
        from mart.org_round_summary round_row
       where round_row.build_id = ${orgBuild}
         and round_row.organization_id = open_rows.organization_id
         and round_row.floor_rate = open_rows.floor_rate
         and round_row.opened_at is not null
         and round_row.opened_at <= ${asOf}::timestamptz
       order by round_row.opened_at desc, round_row.auction_attempt_id desc
       limit 1
    ) last_round on open_rows.organization_id is not null and open_rows.floor_rate is not null
    -- null 마감을 infinity로 접어 정렬과 cursor 튜플 비교의 의미를 하나로 맞춘다. cursor 값은
    -- auctionAttemptId 하나이며 복합 문자열 cursor를 만들지 않는다(AGENTS 2).
    where (${query.cursor}::bigint is null
           or (coalesce(open_rows.closes_at, 'infinity'::timestamptz), open_rows.auction_attempt_id)
              > (select coalesce(anchor.closes_at, 'infinity'::timestamptz), anchor.auction_attempt_id
                   from open_rows anchor
                  where anchor.auction_attempt_id = ${query.cursor}::bigint))
    order by open_rows.closes_at asc nulls last, open_rows.auction_attempt_id asc
    limit ${query.limit + 1}
  `;
}
