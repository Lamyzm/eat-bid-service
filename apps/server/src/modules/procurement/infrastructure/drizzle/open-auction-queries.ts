/**
 * @module 책임: 열린 공고 목록이 활성 스냅샷 build에서 "열림"을 판정하고 keyset·표본 수·(기관, 하한율) 회차 요약을 읽는 SQL 조각을 소유한다.
 *
 * 세 조회(anchor 확인·페이지·표본 수)가 같은 "열림" 정의를 써야 한다. 정의가 두 곳에 있으면 표본 수와
 * 행이 서로 다른 코호트를 말하게 되므로 CTE 하나를 여기서만 만든다.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Temporal } from "@eatbid/domain";
import type { OpenAuctionQuery } from "../../application/open-auction-reader";
import { KST_TIME_ZONE } from "../../domain/kst-month";
import { bigintArrayLiteral, textArrayLiteral } from "../../../../platform/database/sql-values";
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

/**
 * 목록이 이 라벨을 붙인 공고는 취소된 것이라 제출할 수 없다.
 *
 * 2026-09-13 build 436에서 마감 전 1,189행 중 **45행**이 이 상태였고 그대로 화면에 나왔다. 덕정초는
 * 같은 마감 시각에 여섯 행이 섰는데 셋은 취소분, 셋은 같은 조건의 재공고였다. 어느 쪽에 내야 하는지
 * 화면이 말할 수 없었다(EAT-203).
 *
 * **제외 목록으로 두고 허용 목록으로 뒤집지 않는다.** 허용 목록이면 소스에 새 라벨이 나타나는 순간
 * 낼 수 있는 공고가 조용히 사라진다. 놓친 판은 되돌릴 수 없고 헛클릭은 되돌릴 수 있다. 같은 이유로
 * 관측 못 한 상태(`null`)도 숨기지 않는다 — 이 열이 생기기 전 build의 행이 그렇다(AGENTS 3).
 *
 * 같은 관측에서 `저장중`도 8행 있었는데 제출할 수 있는 상태인지 아직 모르므로 빼지 않는다.
 */
const CANCELLED_STATUS_LABEL = "공고취소";

/**
 * 열림 판정의 술어 하나다. 지금 이걸 목록과 지역 미리보기 둘이 쓴다.
 *
 * 한 곳에 모으는 이유는 이 이슈가 그 위험을 실제로 보여 줬기 때문이다. 두 파일이 각자 `closes_at`
 * 조건을 적어 두었고, 취소 판정을 목록에만 더했다면 **같은 활성 build를 읽는 두 화면이 서로 다른
 * 전국 건수를 말했을 것이다.** 미리보기는 그 수로 "404건이 9건이 된다"를 적는다.
 *
 * `alias`는 `closes_at`과 `source_status_label`을 가진 CTE 이름이다.
 */
export function openScopePredicate(alias: SQL, asOf: string): SQL {
  return sql`(${alias}.closes_at is null or ${alias}.closes_at > ${asOf}::timestamptz)
    and (${alias}.source_status_label is null
         or ${alias}.source_status_label <> ${CANCELLED_STATUS_LABEL}::text)`;
}

/**
 * 품목 술어 하나다. **조각 하나라도 라벨 안에 들어 있으면 걸린다.**
 *
 * 완전일치를 쓰면 절반을 놓친다. 원천 라벨이 합성 문자열이라 한 칸에 `육류 , 가금류`가 함께 들어 있고
 * `= '육류'`는 그 행을 못 잡는다(2026-09-14 dev 실측: 열린 404행 중 98행이 합성).
 *
 * `like`가 아니라 `strpos`인 이유는 조각이 사용자 입력이기 때문이다. `like`는 `%`와 `_`가 패턴
 * 메타문자라 사용자가 적은 `100%`가 "무엇이든"으로 바뀐다. escape를 덧대는 대신 메타문자가 아예 없는
 * 연산을 쓴다.
 *
 * 라벨을 관측하지 못한 행은 어느 조각으로도 안 걸린다. 미관측을 "안 맞음"과 합치는 것이 아니라, 이
 * 축으로 물으면 답할 수 없는 행이라 빠지는 것이다(AGENTS 3).
 */
export function itemLabelPredicate(
  alias: SQL,
  labels: readonly string[] | null,
  includeUnknown = false,
): SQL {
  if (labels === null) return sql`true`;
  const fragments = textArrayLiteral(labels);
  const matched = sql`exists (
    select 1 from unnest(${fragments}::text[]) as fragment
     where ${alias}.item_label is not null and strpos(${alias}.item_label, fragment) > 0
  )`;
  // 미관측을 함께 보려는 요청은 그 행이 안 맞는 것이 아니라 답할 수 없는 행임을 아는 요청이다.
  return includeUnknown ? sql`(${alias}.item_label is null or ${matched})` : matched;
}

/**
 * 검색 술어 하나다. **제목·기관 이름·공고번호 가운데 하나라도 검색어를 품으면 걸린다.**
 *
 * 세 열을 한 술어로 묶는 이유는 사용자가 무엇을 적을지 우리가 정하지 않기 때문이다. 학교 이름을 적는
 * 사람과 eaT에서 본 번호를 붙여 넣는 사람이 같은 칸을 쓰며, 칸을 나누면 "어느 칸에 적어야 하나"가 일이
 * 된다(U9 `학교 이름이나 공고로 찾기`). `strpos`인 이유는 품목 조각과 같다 — 사용자 입력에 `like`
 * 메타문자를 열지 않는다.
 *
 * 세 열이 전부 미관측인 행(아직 상세를 따지 않았고 기관 라벨도 없는 행)은 어떤 검색어로도 안 걸린다.
 * 검색은 "있는 글자에서 찾기"라 그 행이 안 맞는 것이 아니라 답할 수 없는 것이며, 그 사실은 검색 결과가
 * 아니라 계보 줄이 말한다(AGENTS 3).
 */
export function searchPredicate(alias: SQL, text: string | null): SQL {
  if (text === null) return sql`true`;
  return sql`(strpos(coalesce(${alias}.title, ''), ${text}::text) > 0
    or strpos(coalesce(${alias}.organization_label, ''), ${text}::text) > 0
    or strpos(coalesce(${alias}.display_bid_no, ''), ${text}::text) > 0)`;
}

// Instant는 driver가 모르는 타입이라 ISO 문자열로 넘기고 SQL 쪽에서 timestamptz로 닫는다. Date를 거치면
// 밀리초 아래가 잘리고 계층 경계를 `Date`로 통과시키는 셈이라 금지다(AGENTS 15).
function instantParameter(value: Temporal.Instant): string {
  return value.toString();
}

/**
 * 열림의 정의다. 활성 스냅샷 build에서 attempt마다 `observed_at`이 가장 큰 관측 하나를 고르고, 그중
 * `closes_at > asOf`이면서 **목록이 취소로 표시하지 않은** 행이 열린 공고다. 마감이 지난 행은 원래
 * 걸러졌지만 취소분은 안 걸러져서 화면에 나왔다(EAT-203).
 * 마감을 관측하지 못한 행(null)은 목록에 남기되 정렬 맨 뒤에
 * 두고, 기간 필터가 있으면 그 행은 **제외**한다 — 기간을 지정한 사용자에게 마감 미확인 행을 섞어 주면
 * 그 필터가 무엇을 골랐는지 알 수 없다.
 *
 * 지역은 활성 build가 선언한 체계의 code value id 하나로 거르며 시도·시군구 어느 축이든 그 id를 가진
 * 행이 남는다. 품목은 아직 code scheme이 없어 관측 라벨 완전일치다(EAT-39 판정 A·B).
 */
export function openRowsCte(query: OpenAuctionQuery, extraCte: SQL = sql``): SQL {
  const asOf = instantParameter(query.asOf);
  // 빈 배열은 계약이 막으므로 여기 오는 것은 `null`이거나 하나 이상이다. null을 그대로 넘기면 위
  // 술어의 `is null` 가지가 필터 없음을 뜻한다.
  const sigungu = query.sigunguCodeValueIds === null ? null : bigintArrayLiteral(query.sigunguCodeValueIds);
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
        snapshot.title,
        snapshot.display_bid_no,
        snapshot.floor_rate,
        snapshot.region_sido_code_value_id,
        snapshot.region_sigungu_code_value_id,
        snapshot.terms_revision_id,
        snapshot.closes_at,
        snapshot.announced_at,
        snapshot.base_amount,
        snapshot.currency,
        snapshot.bid_count,
        snapshot.observed_at,
        snapshot.source_last_changed_at,
        snapshot.source_status_label
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
      where ${openScopePredicate(sql`open_scope`, asOf)}
        and (${query.closesWithinHours}::int is null
             or (open_scope.closes_at is not null
                 and open_scope.closes_at <= ${asOf}::timestamptz + make_interval(hours => ${query.closesWithinHours}::int)))
        and (${query.baseAmountMin}::numeric is null or open_scope.base_amount >= ${query.baseAmountMin}::numeric)
        and (${query.baseAmountMax}::numeric is null or open_scope.base_amount <= ${query.baseAmountMax}::numeric)
        and (${query.closesOnKst}::date is null
             or (open_scope.closes_at at time zone ${KST_TIME_ZONE})::date = ${query.closesOnKst}::date)
        -- 게시일은 상세에서만 온다. 상세를 아직 따지 않은 공고는 이 축으로 못 걸리며 그것이 0건과
        -- 다른 사실이라는 것은 화면이 말한다(AGENTS 3).
        and (${query.announcedOnKst}::date is null
             or (open_scope.announced_at at time zone ${KST_TIME_ZONE})::date = ${query.announcedOnKst}::date)
        -- 시도 하나가 담는 그릇이고 시군구는 그 안에서만 좁힌다. 시군구가 비면 그 시도 전체다.
        and (${query.sidoCodeValueId}::bigint is null
             or open_scope.region_sido_code_value_id = ${query.sidoCodeValueId}::bigint)
        and (${sigungu}::text is null
             or open_scope.region_sigungu_code_value_id = any(${sigungu}::bigint[]))
        and ${itemLabelPredicate(sql`open_scope`, query.itemLabels, query.includeUnknownItem)}
        and ${searchPredicate(sql`open_scope`, query.searchText)}
        and (not ${query.onlyWithoutBids}::boolean or open_scope.bid_count = 0)${eligibilityFilter}
    )${extraCte}
  `;
}

/**
 * 한 페이지에 실릴 행을 laterals보다 **먼저** 고른다. `extraCte`로 받아 `with` 목록 안에 들어간다.
 *
 * 이 CTE가 없으면 keyset 조건과 `limit`이 join 뒤에 걸려서, 라벨·요약·최근 회차 lateral이 열린 공고
 * 전량에 대해 돌고 나서 그중 101행만 남는다. 비용이 페이지 크기가 아니라 열린 공고 수를 따라 커지는
 * 모양이라 성수기 하루(실측 하루 최대 117건 마감, 열린 집합은 그보다 크다)에 그대로 드러난다.
 * 복원본 build 212 실측에서 열린 공고 302건 중 101행 페이지를 뽑을 때 lateral이 302번 아닌 101번만
 * 돌게 된다.
 *
 * 정렬 키는 바깥 select와 같아야 한다. 다르면 잘라 온 101행과 최종 순서가 어긋나 cursor가 건너뛴다.
 */
function pageRowsCte(query: OpenAuctionQuery): SQL {
  return sql`,
    page_rows as (
      select open_rows.*
        from open_rows
       -- null 마감을 infinity로 접어 정렬과 cursor 튜플 비교의 의미를 하나로 맞춘다. cursor 값은
       -- auctionAttemptId 하나이며 복합 문자열 cursor를 만들지 않는다(AGENTS 2).
       where (${query.cursor}::bigint is null
              or (coalesce(open_rows.closes_at, 'infinity'::timestamptz), open_rows.auction_attempt_id)
                 > (select coalesce(anchor.closes_at, 'infinity'::timestamptz), anchor.auction_attempt_id
                      from open_rows anchor
                     where anchor.auction_attempt_id = ${query.cursor}::bigint))
       order by open_rows.closes_at asc nulls last, open_rows.auction_attempt_id asc
       limit ${query.limit + 1}
    )`;
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
    ${openRowsCte(query, pageRowsCte(query))}
    select
      page_rows.auction_attempt_id,
      page_rows.organization_id,
      page_rows.organization_label,
      organization.type as organization_type,
      page_rows.item_label,
      page_rows.display_bid_no,
      page_rows.floor_rate,
      page_rows.terms_revision_id,
      page_rows.closes_at,
      page_rows.base_amount,
      page_rows.currency,
      page_rows.bid_count,
      page_rows.observed_at,
      page_rows.source_last_changed_at,
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
    from page_rows
    left join core.organization organization on organization.organization_id = page_rows.organization_id
    ${regionReferenceJoin(sql`page_rows.region_sido_code_value_id`, "region_sido")}
    ${regionReferenceJoin(sql`page_rows.region_sigungu_code_value_id`, "region_sigungu")}
    ${eligibilityAreasLateral(sql`page_rows.terms_revision_id`, "eligibility")}
    -- 요약의 grain은 기관이 아니라 (기관, 하한율)이다. 하한율이 다르면 그날 하한이 다른 자리에 서서
    -- 낙찰 투찰률도 참여 규모도 겹치지 않는 판이 되므로 한 기관 안에서도 섞지 않는다
    -- (screen-system §6.4.1, PDR-0004). 품목은 반대로 좁히지 않는다 — 하한율과 명단 크기를 고정하면
    -- 품목별 낙찰 사정률 중앙값이 0.041 안에 들어와 표본만 줄고 갈리는 것이 없다(2026-09-11 실측).
    -- 활성 org_round_summary build 하나만 읽으며, percentile_disc는 실제 관측된 명단 수 하나를 고르는
    -- 것이지 평균이 아니고 명단이 미관측인 회차는 표본에서 빠진다(AGENTS 7).
    --
    -- 개찰 시각이 기준 시각을 지난 회차만 센다. mart에는 아직 안 열린 회차가 함께 실려 있어(2026-09-14
    -- 실측: build 213의 75,721행 중 183행이 미래, 최대 2028-08-08) 자르지 않으면 아직 일어나지 않은
    -- 판이 보통 참여의 모집단에 들어간다. 표본이 부풀고 중앙값이 옮겨 간다 — 덕정초가 자르기 전 20회,
    -- 자른 뒤 14회다. 개찰 시각 미관측도 개찰됐다고 단정할 수 없어 함께 빠진다(AGENTS 3).
    left join lateral (
      select count(*)::int as attempt_count,
             (percentile_disc(0.5) within group (order by summary_row.list_count)
                filter (where summary_row.list_count is not null))::int as median_list_count,
             count(summary_row.list_count)::int as list_count_sample_count
        from mart.org_round_summary summary_row
       where summary_row.build_id = ${orgBuild}
         and summary_row.organization_id = page_rows.organization_id
         and summary_row.floor_rate = page_rows.floor_rate
         and summary_row.opened_at is not null
         and summary_row.opened_at <= ${asOf}::timestamptz
    ) summary on page_rows.organization_id is not null and page_rows.floor_rate is not null
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
         and round_row.organization_id = page_rows.organization_id
         and round_row.floor_rate = page_rows.floor_rate
         and round_row.opened_at is not null
         and round_row.opened_at <= ${asOf}::timestamptz
       order by round_row.opened_at desc, round_row.auction_attempt_id desc
       limit 1
    ) last_round on page_rows.organization_id is not null and page_rows.floor_rate is not null
    -- cursor 조건과 limit은 page_rows가 이미 걸었다. 여기서 다시 걸면 두 곳이 같은 규칙을 따로 갖게
    -- 된다. 정렬만 되풀이하는 이유는 lateral join이 CTE의 순서를 보존한다고 약속하지 않기 때문이다.
    order by page_rows.closes_at asc nulls last, page_rows.auction_attempt_id asc
  `;
}
