/**
 * @module 책임: 열린 공고 요약이 한 번의 스캔으로 탭·달력·하한 구성·기준 시각을 함께 세는 SQL을 소유한다.
 *
 * 세는 자리마다 조회를 나누지 않는다. 탭 셋·달력 칸·축 줄 건수·묶음 머리·0건 화면이 **같은 집합을
 * 다르게 센 것**이라, 나누면 화면 하나가 조회를 일곱 번 하고 그 일곱이 서로 다른 시각을 볼 수 있다.
 * 열림 판정은 목록과 같은 술어를 쓴다(`openScopePredicate`).
 */
import { AUCTION_ITEM_ATOMS, CODE_SCHEME_NAMES } from "@eatbid/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { OpenAuctionSummaryQuery } from "../../application/open-auction-summary-reader";
import { KST_TIME_ZONE } from "../../domain/kst-month";
import { bigintArrayLiteral, textArrayLiteral } from "../../../../platform/database/sql-values";
import { activeMartBuildId } from "./drizzle-mart-build-reader";
import {
  eligibilityAreaCodeCte,
  eligibilityMatchedExpression,
  eligibilityObservedExpression,
  matchedEligibilityAreaCte,
} from "./eligibility-area-sql";
import {
  itemLabelPredicate,
  OPEN_AUCTION_SNAPSHOT,
  openScopePredicate,
  searchPredicate,
} from "./open-auction-queries";

function instantParameter(value: { toString(): string }): string {
  return value.toString();
}

/**
 * 공고지역 코드의 최신 관측 라벨이다. 목록의 `regionReferenceJoin`과 같은 규칙(가장 최근 관측 하나)이라
 * 기둥의 이름과 행의 이름이 갈리지 않는다. 라벨이 없는 코드도 남는다 — 코드목록 수집(EAT-187)이 아직
 * 안 돈 DB에서 항목이 사라지면 그 지역의 공고가 기둥에서 보이지 않는다.
 */
function regionLabelCte(): SQL {
  return sql`
    region_label as (
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
       where scheme.namespace in (${CODE_SCHEME_NAMES.auctionLocationSido}, ${CODE_SCHEME_NAMES.auctionLocationSigungu})
    )
  `;
}

/**
 * 한 요청이 도는 조회 하나다. 스캔은 `open_scope` 한 번이고 그 위에서 집합 넷이 갈린다.
 *
 * - `region_scope` — 지역 축만 건 집합. 달력의 `releasedCount`가 센다.
 * - `region_released` — 지역만 풀고 품목·금액·제한지역은 건 집합. 기둥의 시도·시군구·지역 미상 배지가 센다.
 * - `item_released` — 품목만 풀고 지역·금액·제한지역은 건 집합. 기둥의 품목·품목 미상 배지가 센다.
 * - `scoped` — 전부 건 집합. 탭·달력 칸·하한 구성·기준 시각이 센다.
 *
 * 넷이 같은 스캔에서 나와야 `2건 · 7건 중`과 기둥의 `김해시 62`가 같은 시각을 본다. 배지가 "그 축 하나만
 * 푼 수"인 이유는 그것이 누르면 되는 수이기 때문이다 — 다른 축까지 풀면 약속이 깨진다.
 *
 * 집계는 `filter (where ...)`로 한 번에 접는다. 탭 셋을 따로 세면 같은 행을 세 번 읽는다.
 */
export function openAuctionSummaryQuerySql(query: OpenAuctionSummaryQuery): SQL {
  const asOf = instantParameter(query.asOf);
  const sigungu = query.sigunguCodeValueIds === null ? null : bigintArrayLiteral(query.sigunguCodeValueIds);
  const eligibility = query.eligibilityAreaCodeValueIds;
  const eligibilityFilter: SQL = eligibility === null
    ? sql``
    : sql` and (scope.eligibility_matched or not scope.eligibility_observed)`;
  // 검색은 금액과 같은 자리의 축이다 — 기둥의 지역·품목 배지가 "그 축 하나만 푼 수"를 지키려면 검색은
  // 어느 배지에서도 풀리지 않아야 한다. 검색을 풀고 세면 배지가 검색 전 집합을 말한다.
  const amountFilter: SQL = sql`
        (${query.baseAmountMin}::numeric is null or scope.base_amount >= ${query.baseAmountMin}::numeric)
        and (${query.baseAmountMax}::numeric is null or scope.base_amount <= ${query.baseAmountMax}::numeric)
        and ${searchPredicate(sql`scope`, query.searchText)}`;
  // 여덟 원자를 어휘 순서대로 세운다. 0건인 원자도 항목으로 남아야 화면이 "오늘 없다"와 "어휘에 없다"를
  // 가른다. 부분일치 술어는 목록 필터와 같은 `strpos`다(`itemLabelPredicate`).
  const atoms = textArrayLiteral([...AUCTION_ITEM_ATOMS]);
  return sql`
    with ${eligibilityAreaCodeCte()},
    ${matchedEligibilityAreaCte(eligibility ?? [])},
    ${regionLabelCte()},
    snapshot as (
      select distinct on (snapshot.auction_attempt_id)
        snapshot.auction_attempt_id,
        snapshot.organization_id,
        snapshot.organization_label,
        snapshot.item_label,
        snapshot.title,
        snapshot.display_bid_no,
        snapshot.floor_rate,
        snapshot.region_sido_code_value_id,
        snapshot.region_sigungu_code_value_id,
        snapshot.terms_revision_id,
        snapshot.closes_at,
        snapshot.announced_at,
        snapshot.base_amount,
        snapshot.observed_at,
        snapshot.source_status_label
      from mart.open_auction_snapshot snapshot
      where snapshot.build_id = ${activeMartBuildId(OPEN_AUCTION_SNAPSHOT)}
      order by snapshot.auction_attempt_id, snapshot.observed_at desc
    ),
    open_scope as (
      select snapshot.*,
             (snapshot.closes_at at time zone ${KST_TIME_ZONE})::date as closes_on_kst,
             (snapshot.announced_at at time zone ${KST_TIME_ZONE})::date as announced_on_kst,
             ${eligibilityObservedExpression(sql`snapshot.terms_revision_id`)} as eligibility_observed,
             ${eligibilityMatchedExpression(sql`snapshot.terms_revision_id`)} as eligibility_matched
      from snapshot
      where ${openScopePredicate(sql`snapshot`, asOf)}
    ),
    region_scope as (
      select scope.*
      from open_scope scope
      where (${query.sidoCodeValueId}::bigint is null
             or scope.region_sido_code_value_id = ${query.sidoCodeValueId}::bigint)
        and (${sigungu}::text is null
             or scope.region_sigungu_code_value_id = any(${sigungu}::bigint[]))
    ),
    region_released as (
      select scope.*
      from open_scope scope
      where ${amountFilter}
        and ${itemLabelPredicate(sql`scope`, query.itemLabels, query.includeUnknownItem)}${eligibilityFilter}
    ),
    item_released as (
      select scope.*
      from region_scope scope
      where ${amountFilter}${eligibilityFilter}
    ),
    scoped as (
      select scope.*
      from item_released scope
      where ${itemLabelPredicate(sql`scope`, query.itemLabels, query.includeUnknownItem)}
    ),
    sido_counts as (
      select code.code_value_id, code.code, code.scheme, code.label, count(*)::int as count
        from region_released released
        join region_label code on code.code_value_id = released.region_sido_code_value_id
       group by code.code_value_id, code.code, code.scheme, code.label
    ),
    -- 시군구는 고른 시도 안에서만 센다. 시도 없이 전국 시군구를 세우는 화면은 없고, 짝은 활성 build에서
    -- 관측된 것뿐이라 0건인 시군구는 애초에 없다.
    sigungu_counts as (
      select code.code_value_id, code.code, code.scheme, code.label, count(*)::int as count
        from region_released released
        join region_label code on code.code_value_id = released.region_sigungu_code_value_id
       where ${query.sidoCodeValueId}::bigint is not null
         and released.region_sido_code_value_id = ${query.sidoCodeValueId}::bigint
       group by code.code_value_id, code.code, code.scheme, code.label
    ),
    item_counts as (
      select atoms.item,
             atoms.ordinal,
             (select count(*) from item_released released
               where released.item_label is not null and strpos(released.item_label, atoms.item) > 0)::int as count
        from unnest(${atoms}::text[]) with ordinality as atoms(item, ordinal)
    ),
    -- 두 집합을 날짜로 **한 번씩** 접는다. 달력 칸마다 세면 창 길이만큼 스캔이 늘어난다.
    scoped_by_day as (
      select scoped.closes_on_kst as date, count(*)::int as count from scoped group by 1
    ),
    released_by_day as (
      select scope.closes_on_kst as date, count(*)::int as count from region_scope scope group by 1
    ),
    -- 달력은 요청한 창의 날짜를 **전부** 낸다. 0건인 날을 빼면 화면이 "그날은 없다"와 "그날은 창 밖"을
    -- 구분하지 못하고, 사용자가 보는 것은 빈 칸이지 없는 칸이 아니다.
    calendar as (
      select day::date as date,
             coalesce(scoped_by_day.count, 0) as count,
             coalesce(released_by_day.count, 0) as released_count
        from generate_series(${query.calendarFrom}::date, ${query.calendarTo}::date, interval '1 day') as day
        left join scoped_by_day on scoped_by_day.date = day::date
        left join released_by_day on released_by_day.date = day::date
       order by day
    ),
    floors as (
      select scoped.floor_rate as rate, count(*)::int as count
        from scoped group by scoped.floor_rate order by count(*) desc, scoped.floor_rate
    ),
    -- 이 집합은 이미 열린 것만 담으므로(마감이 asOf보다 뒤이거나 미관측) 마감이 있는 가장 이른 날이
    -- 곧 다음 마감일이다. 날짜별 수를 다시 세지 않고 위에서 접은 것을 그대로 쓴다.
    next_day as (
      select date, count from scoped_by_day where date is not null order by date limit 1
    )
    select
      (select count(*) from scoped)::int as total_count,
      (select count(distinct scoped.organization_id) from scoped)::int as organization_count,
      (select count(*) from scoped
        where scoped.announced_on_kst = (${asOf}::timestamptz at time zone ${KST_TIME_ZONE})::date)::int
        as opened_today_count,
      -- 게시일은 목록 행이 주지 않아 상세를 딴 공고에만 있다. 못 센 수를 함께 내야 화면이 오늘 열린 수를
      -- 부분만 센 수로 말할 수 있고, 이 수가 전체와 같으면 아예 셀 수 없다는 뜻이다(AGENTS 3).
      (select count(*) from scoped where scoped.announced_at is null)::int as announced_unobserved_count,
      (select count(*) from scoped
        where scoped.closes_on_kst = (${asOf}::timestamptz at time zone ${KST_TIME_ZONE})::date)::int
        as closing_today_count,
      (select max(scoped.observed_at) from scoped) as latest_observed_at,
      (select jsonb_agg(jsonb_build_object('date', calendar.date, 'count', calendar.count,
                                           'releasedCount', calendar.released_count))
         from calendar) as calendar,
      -- 하한율을 문자열로 싣는다. jsonb 숫자로 내보내면 driver가 JSON을 파싱하며 90.000을 90으로 읽어
      -- 소수점 자리가 사라지고, 계약이 요구하는 scale 3에서 거부된다(AGENTS 15).
      (select jsonb_agg(jsonb_build_object('rate', floors.rate::text, 'count', floors.count))
         from floors) as floors,
      -- code_value_id는 문자열로 싣는다. JSON 숫자는 bigint를 무손실로 담지 못한다(ADR 0018). 순서는
      -- 많은 것부터이고 동률은 코드 순이라 실행마다 같다.
      (select jsonb_agg(jsonb_build_object('codeValueId', sido_counts.code_value_id::text, 'code', sido_counts.code,
                                           'scheme', sido_counts.scheme, 'label', sido_counts.label,
                                           'count', sido_counts.count)
                        order by sido_counts.count desc, sido_counts.code)
         from sido_counts) as sido_counts,
      (select jsonb_agg(jsonb_build_object('codeValueId', sigungu_counts.code_value_id::text, 'code', sigungu_counts.code,
                                           'scheme', sigungu_counts.scheme, 'label', sigungu_counts.label,
                                           'count', sigungu_counts.count)
                        order by sigungu_counts.count desc, sigungu_counts.code)
         from sigungu_counts) as sigungu_counts,
      (select count(*) from region_released where region_released.region_sido_code_value_id is null)::int
        as region_unobserved_count,
      (select jsonb_agg(jsonb_build_object('item', item_counts.item, 'count', item_counts.count)
                        order by item_counts.ordinal)
         from item_counts) as item_counts,
      (select count(*) from item_released where item_released.item_label is null)::int as item_unobserved_count,
      (select jsonb_build_object('date', next_day.date, 'count', next_day.count) from next_day) as next_closing_day
  `;
}
