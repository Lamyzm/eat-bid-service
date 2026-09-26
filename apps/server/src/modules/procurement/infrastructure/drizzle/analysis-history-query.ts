/**
 * @module 책임: 분석 전체 개찰 이력의 한 페이지 SQL을 시간축과 같은 코호트 술어 위에 고정 build로 만든다.
 *
 * 코호트 술어를 다시 쓰지 않고 시간축의 것을 가져온다. 두 벌이면 한 벌만 고쳐져 표의 행과 그림의 표본이
 * 서로 다른 집합이 된다.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnalysisHistoryQuery } from "../../application/analysis-history-reader";
import {
  analysisBasePredicate,
  analysisComparisonPredicate,
  analysisTargetPredicate,
  dateColumn,
} from "./analysis-time-series-query";
import { organizationLabelSql } from "./organization-label-sql";

function populationPredicate(query: AnalysisHistoryQuery): SQL {
  return query.population === "target" ? analysisTargetPredicate(query) : analysisComparisonPredicate(query);
}

/**
 * 한 페이지다. 한 줄 더 읽어 뒤에 더 있는지 안다. 전체 수는 같은 집합에서 한 번 센다.
 *
 * 커서는 앞 페이지 마지막 줄의 회차 id다. 그 줄의 날짜를 **같은 build·같은 조건의 집합에서** 다시 읽어
 * `(날짜, 회차 id)` 튜플로 다음 자리를 정한다. 커서 회차가 그 집합에 없으면 `cursor_found`가 false이고
 * use case가 요청 오류로 닫는다 — 다른 목록의 커서로 엉뚱한 자리부터 읽지 않는다.
 *
 * 정렬은 조건의 날짜 기준 최신순이다. 같은 시각이 흔하므로(같은 날 개찰) 회차 id로 끝까지 순서를 닫는다.
 */
export function analysisHistoryPageSql(query: AnalysisHistoryQuery): SQL {
  const date = dateColumn(query.dateBasis);
  const cohort = sql`${analysisBasePredicate(query, sql`${query.buildId}::bigint`)} ${populationPredicate(query)}`;
  const cursorId = query.cursorAttemptId;
  return sql`
    with filtered as (
      select summary.build_id, summary.auction_attempt_id, summary.auction_revision_id, summary.organization_id,
             summary.announced_at, summary.opened_at, summary.awarded_assessment_rate,
             summary.runner_up_assessment_rate, summary.list_count, summary.below_day_floor_count,
             summary.winner_supplier_party_id, summary.base_amount, summary.currency,
             ${date} as sort_at
        from mart.org_round_summary summary
       where ${cohort}
    ),
    cursor_row as (
      select filtered.sort_at, filtered.auction_attempt_id
        from filtered
       where filtered.auction_attempt_id = ${cursorId ?? null}::bigint
    ),
    page as (
      select filtered.*
        from filtered
       where ${cursorId === null
         ? sql`true`
         : sql`(filtered.sort_at, filtered.auction_attempt_id)
               < (select cursor_row.sort_at, cursor_row.auction_attempt_id from cursor_row)`}
       order by filtered.sort_at desc, filtered.auction_attempt_id desc
       limit ${query.limit + 1}
    )
    select
      (select count(*) from filtered) as total_count,
      ${cursorId === null ? sql`true` : sql`exists (select 1 from cursor_row)`} as cursor_found,
      page.auction_attempt_id, page.auction_revision_id, page.organization_id,
      ${organizationLabelSql(sql`page.organization_id`)} as organization_name,
      page.announced_at, page.opened_at, page.awarded_assessment_rate, page.runner_up_assessment_rate,
      page.list_count, page.below_day_floor_count, page.winner_supplier_party_id,
      -- 업체 이름도 관측 라벨이다. 그 업체의 원천 계정 코드에 매달린 가장 나중 라벨을 쓴다(AGENTS 2).
      (select observation.label
         from core.source_supplier_account account
         join core.code_label_observation observation on observation.code_value_id = account.account_code_value_id
        where account.supplier_party_id = page.winner_supplier_party_id
        order by observation.observed_at desc, observation.code_label_observation_id desc
        limit 1) as winner_name,
      -- 품목 원자는 다리 행의 코드다. 다리 행이 없으면 null — 공고가 품목을 말하지 않은 것이다(PDR-0007).
      (select array_agg(code.code order by code.code)
         from mart.org_round_summary_item bridge
         join core.code_value code on code.code_value_id = bridge.item_code_value_id
        where bridge.build_id = page.build_id and bridge.auction_attempt_id = page.auction_attempt_id) as items,
      page.base_amount, page.currency
    from (select 1) anchor
    left join page on true
    order by page.sort_at desc nulls last, page.auction_attempt_id desc nulls last`;
}
