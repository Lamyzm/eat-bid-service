/**
 * @module 책임: 조합 아홉(기본 넷과 저장된 다섯)의 열린 공고 건수를 한 번의 스캔으로 세는 SQL을 소유한다.
 *
 * 조합마다 요약을 부르면 아홉 번이고 그 아홉이 서로 다른 시각을 볼 수 있다. 여기서는 스캔 하나 위에
 * `count(*) filter (where ...)`를 아홉 개 얹어 아홉 수가 같은 행 집합에서 나오게 한다.
 */
import { sql, type SQL } from "drizzle-orm";

import type { OpenAuctionFilterSet, OpenAuctionFilterCountsQuery } from "../../application/count-open-auctions-for-filters";
import { KST_TIME_ZONE } from "../../domain/kst-month";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { activeMartBuildId } from "./drizzle-mart-build-reader";
import {
  eligibilityAreaCodeCte,
  eligibilityMatchedExpression,
  eligibilityObservedExpression,
  matchedEligibilityAreaCte,
} from "./eligibility-area-sql";
import {
  itemAtomCte,
  itemAtomPredicate,
  itemUnobservedPredicate,
  OPEN_AUCTION_SNAPSHOT,
  openScopePredicate,
  searchPredicate,
} from "./open-auction-queries";

function instantParameter(value: { toString(): string }): string {
  return value.toString();
}

/**
 * 필터 한 벌을 술어 하나로 편다. `base` CTE가 이미 열림과 관심 지역을 걸었으므로 여기서는 나머지 축만
 * 더한다 — 조합을 눌렀을 때의 목록과 같은 순서로 같은 축을 건다.
 */
function filterPredicate(filter: OpenAuctionFilterSet): SQL {
  const sigungu = filter.sigunguCodeValueIds === null || filter.sigunguCodeValueIds.length === 0
    ? null
    : bigintArrayLiteral(filter.sigunguCodeValueIds);
  return sql`(${filter.sidoCodeValueId}::bigint is null
        or base.region_sido_code_value_id = ${filter.sidoCodeValueId}::bigint)
    and (${sigungu}::text is null
        or base.region_sigungu_code_value_id = any(${sigungu}::bigint[]))
    and ${itemAtomPredicate(sql`base`, filter.itemAtoms)}
    and ${searchPredicate(sql`base`, filter.searchText)}
    and (${filter.baseAmountMin}::numeric is null or base.base_amount >= ${filter.baseAmountMin}::numeric)
    and (${filter.baseAmountMax}::numeric is null or base.base_amount <= ${filter.baseAmountMax}::numeric)`;
}

/**
 * 품목 축만 느슨하게 푼 술어다. `품목 미상 포함`이 세는 것은 **지금 조건에 라벨을 관측하지 못한 행을
 * 더한 수**다 — 품목 축을 걸지 않았으면 지금 조건과 같은 수가 된다.
 *
 * 미관측을 "안 맞음"에 넣지 않고 따로 셀 수 있게 하는 이유는 그 행이 낼 수 없는 공고가 아니기 때문이다.
 * 품목 축으로 좁힌 사용자는 미관측 행을 조용히 잃는데, 이 수가 얼마나 잃었는지를 말한다(AGENTS 3).
 */
function itemRelaxedPredicate(filter: OpenAuctionFilterSet): SQL {
  const sigungu = filter.sigunguCodeValueIds === null || filter.sigunguCodeValueIds.length === 0
    ? null
    : bigintArrayLiteral(filter.sigunguCodeValueIds);
  return sql`(${filter.sidoCodeValueId}::bigint is null
        or base.region_sido_code_value_id = ${filter.sidoCodeValueId}::bigint)
    and (${sigungu}::text is null
        or base.region_sigungu_code_value_id = any(${sigungu}::bigint[]))
    and (${itemUnobservedPredicate(sql`base`)} or ${itemAtomPredicate(sql`base`, filter.itemAtoms)})
    and ${searchPredicate(sql`base`, filter.searchText)}
    and (${filter.baseAmountMin}::numeric is null or base.base_amount >= ${filter.baseAmountMin}::numeric)
    and (${filter.baseAmountMax}::numeric is null or base.base_amount <= ${filter.baseAmountMax}::numeric)`;
}

/**
 * 조합 하나가 `saved_<n>` 열 하나가 된다. 이름이 아니라 위치로 잇는 이유는 조합 이름이 사용자 문자열이라
 * 열 이름이 될 수 없기 때문이다(AGENTS 2). 호출부가 같은 순서로 다시 짝짓는다.
 */
function savedCountColumns(filters: readonly OpenAuctionFilterSet[]): SQL {
  if (filters.length === 0) return sql``;
  const columns = filters.map((filter, index) =>
    sql`, count(*) filter (where ${filterPredicate(filter)})::int as ${sql.raw(`saved_${index}`)}`);
  return sql.join(columns, sql``);
}

export function openAuctionFilterCountsQuerySql(query: OpenAuctionFilterCountsQuery): SQL {
  const asOf = instantParameter(query.asOf);
  const eligibility = query.eligibilityAreaCodeValueIds;
  const eligibilityFilter: SQL = eligibility === null
    ? sql``
    : sql` and (base.eligibility_matched or not base.eligibility_observed)`;
  const today = sql`(${asOf}::timestamptz at time zone ${KST_TIME_ZONE})::date`;
  return sql`
    with ${eligibilityAreaCodeCte()},
    ${matchedEligibilityAreaCte(eligibility ?? [])},
    ${itemAtomCte()},
    snapshot as (
      select distinct on (snapshot.auction_attempt_id)
        snapshot.open_auction_snapshot_id,
        snapshot.auction_attempt_id,
        snapshot.item_label,
        snapshot.title,
        snapshot.organization_label,
        snapshot.display_bid_no,
        snapshot.bid_count,
        snapshot.region_sido_code_value_id,
        snapshot.region_sigungu_code_value_id,
        snapshot.terms_revision_id,
        snapshot.closes_at,
        snapshot.base_amount,
        snapshot.source_status_label
      from mart.open_auction_snapshot snapshot
      where snapshot.build_id = ${activeMartBuildId(OPEN_AUCTION_SNAPSHOT)}
      order by snapshot.auction_attempt_id, snapshot.observed_at desc
    ),
    -- 아홉 수 전부의 바닥이다. 열림 판정과 워크스페이스의 관심 지역까지만 걸고 나머지 축은 조합마다
    -- 달라서 filter (where ...) 로 얹는다. 관심 지역을 바닥에 두는 이유는 화면이 언제나 그 안에서만
    -- 목록을 내기 때문이다 — 빼면 조합 옆의 수와 눌렀을 때의 목록이 어긋난다.
    base as (
      select base.*
      from (
        select snapshot.*,
               (snapshot.closes_at at time zone ${KST_TIME_ZONE})::date as closes_on_kst,
               ${eligibilityObservedExpression(sql`snapshot.terms_revision_id`)} as eligibility_observed,
               ${eligibilityMatchedExpression(sql`snapshot.terms_revision_id`)} as eligibility_matched
        from snapshot
        where ${openScopePredicate(sql`snapshot`, asOf)}
      ) base
      where true${eligibilityFilter}
    )
    select
      count(*)::int as region_all,
      count(*) filter (where base.closes_on_kst = ${today})::int as region_closing_today,
      -- 참여 수 미관측은 0이 아니다. 아무도 안 들어온 판과 못 센 판은 사용자가 할 일이 다르다(AGENTS 3).
      count(*) filter (where ${filterPredicate(query.current)} and base.bid_count = 0)::int as no_bids,
      count(*) filter (where ${itemRelaxedPredicate(query.current)})::int as item_unknown_included
      ${savedCountColumns(query.saved)}
    from base
  `;
}
