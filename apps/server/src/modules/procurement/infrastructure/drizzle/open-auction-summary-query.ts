/**
 * @module 책임: 열린 공고 요약이 한 번의 스캔으로 탭·달력·하한 구성·기준 시각을 함께 세는 SQL을 소유한다.
 *
 * 세는 자리마다 조회를 나누지 않는다. 탭 셋·달력 칸·축 줄 건수·묶음 머리·0건 화면이 **같은 집합을
 * 다르게 센 것**이라, 나누면 화면 하나가 조회를 일곱 번 하고 그 일곱이 서로 다른 시각을 볼 수 있다.
 * 열림 판정은 목록과 같은 술어를 쓴다(`openScopePredicate`).
 */
import { sql, type SQL } from "drizzle-orm";

import type { OpenAuctionSummaryQuery } from "../../application/open-auction-summary-reader";
import { KST_TIME_ZONE } from "../../domain/kst-month";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { activeMartBuildId } from "./drizzle-mart-build-reader";
import {
  eligibilityAreaCodeCte,
  eligibilityMatchedExpression,
  eligibilityObservedExpression,
  matchedEligibilityAreaCte,
} from "./eligibility-area-sql";
import { OPEN_AUCTION_SNAPSHOT, openScopePredicate } from "./open-auction-queries";

function instantParameter(value: { toString(): string }): string {
  return value.toString();
}

/**
 * 한 요청이 도는 조회 하나다. 스캔은 `region_scope` 한 번이고 그 위에서 두 집합이 갈린다.
 *
 * `region_scope`는 **지역 축만 건 집합**이고 `scoped`는 거기에 품목·금액·제한지역을 더한 집합이다.
 * 달력의 `releasedCount`가 앞을 세고 나머지가 전부 뒤를 세므로 두 집합이 같은 스캔에서 나와야
 * `2건 · 7건 중`의 두 수가 같은 시각을 본다.
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
  return sql`
    with ${eligibilityAreaCodeCte()},
    ${matchedEligibilityAreaCte(eligibility ?? [])},
    snapshot as (
      select distinct on (snapshot.auction_attempt_id)
        snapshot.auction_attempt_id,
        snapshot.organization_id,
        snapshot.item_label,
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
    region_scope as (
      select snapshot.*,
             (snapshot.closes_at at time zone ${KST_TIME_ZONE})::date as closes_on_kst,
             (snapshot.announced_at at time zone ${KST_TIME_ZONE})::date as announced_on_kst,
             ${eligibilityObservedExpression(sql`snapshot.terms_revision_id`)} as eligibility_observed,
             ${eligibilityMatchedExpression(sql`snapshot.terms_revision_id`)} as eligibility_matched
      from snapshot
      where ${openScopePredicate(sql`snapshot`, asOf)}
        and (${query.sidoCodeValueId}::bigint is null
             or snapshot.region_sido_code_value_id = ${query.sidoCodeValueId}::bigint)
        and (${sigungu}::text is null
             or snapshot.region_sigungu_code_value_id = any(${sigungu}::bigint[]))
    ),
    scoped as (
      select scope.*
      from region_scope scope
      where (${query.baseAmountMin}::numeric is null or scope.base_amount >= ${query.baseAmountMin}::numeric)
        and (${query.baseAmountMax}::numeric is null or scope.base_amount <= ${query.baseAmountMax}::numeric)
        and (${query.itemLabel}::text is null or scope.item_label = ${query.itemLabel}::text)${eligibilityFilter}
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
      (select jsonb_build_object('date', next_day.date, 'count', next_day.count) from next_day) as next_closing_day
  `;
}
