import { sql } from "drizzle-orm";
import { bigint, boolean, text } from "drizzle-orm/pg-core";

import { ingestSchema } from "../namespaces.js";

/**
 * 백필이 어느 창까지, 어느 단계까지 갔는지를 `ingest` 사실에서 파생한다. 진도를 따로 저장하지 않는
 * 이유는 같은 질문에 답하는 자리가 둘이 되면 언젠가 어긋나고, 어긋난 순간 그것을 알아낼 방법이 다시
 * 없어지기 때문이다(ADR 0052 결정 2).
 *
 * 정의를 여기 하나만 두는 이유는 소비자가 둘이기 때문이다. 전진 판단을 하는 dataplane과 크롤러
 * 대시보드가 같은 SQL을 각자 적으면 한쪽만 고쳐지는 날이 온다.
 *
 * 열이 단계를 따르는 이유는 어느 단계에 일이 남았는지가 곧 무엇을 해야 하는지이기 때문이다. 하나의
 * 진행률로 접으면 발행만 남은 창(소스 호출 0)과 아직 받지 않은 창(창 하나에 한 시간)을 구분하지
 * 못한다(ADR 0052 결정 3).
 *
 * 세는 단위는 공고 아이디다. 릴리스가 같은 창을 여러 번 덮으므로 요청 단위를 더하면 중복된다. 그리고
 * 목록과 상세는 서로 다른 run에 기록되므로(`discover --detail-run-id`) 릴리스를 거쳐 이어야 한다 —
 * run으로 직접 이으면 상세가 0으로 보인다.
 */
export const backfillCoverage = ingestSchema
  .view("backfill_coverage", {
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    discoveredIds: bigint("discovered_ids", { mode: "bigint" }).notNull(),
    capturedIds: bigint("captured_ids", { mode: "bigint" }).notNull(),
    uncapturedIds: bigint("uncaptured_ids", { mode: "bigint" }).notNull(),
    normalizedIds: bigint("normalized_ids", { mode: "bigint" }).notNull(),
    publishedIds: bigint("published_ids", { mode: "bigint" }).notNull(),
    isComplete: boolean("is_complete").notNull(),
  })
  .as(sql`
    with window_release as (
      select distinct
             (u.request_params ->> 'P_BID_BGNG_DT') as window_start,
             (u.request_params ->> 'P_BID_END_DT')  as window_end,
             sr.source_release_id
        from ingest.request_unit u
        join ingest.source_release_run sr on sr.run_id = u.run_id
       where u.endpoint = 'bid-list'
         and u.request_params ? 'P_BID_BGNG_DT'
         and u.request_params ? 'P_BID_END_DT'
    ),
    detail as (
      select w.window_start,
             w.window_end,
             (u.request_params ->> 'ELCTRN_BID_ID') as external_bid_id,
             u.status,
             nr.normalized_record_id,
             rev.auction_revision_id
        from window_release w
        join ingest.source_release_run sr on sr.source_release_id = w.source_release_id
        join ingest.request_unit u on u.run_id = sr.run_id and u.endpoint = 'bid-detail'
        left join ingest.raw_observation o on o.request_unit_id = u.request_unit_id
        left join ingest.normalized_record nr on nr.observation_id = o.observation_id
        left join core.auction_revision rev on rev.normalized_record_id = nr.normalized_record_id
    ),
    rolled as (
      select window_start,
             window_end,
             external_bid_id,
             bool_or(status = 'captured') as captured,
             bool_or(normalized_record_id is not null) as normalized,
             bool_or(auction_revision_id is not null) as published
        from detail
       group by window_start, window_end, external_bid_id
    )
    select window_start,
           window_end,
           count(*) as discovered_ids,
           count(*) filter (where captured) as captured_ids,
           count(*) filter (where not captured) as uncaptured_ids,
           count(*) filter (where normalized) as normalized_ids,
           count(*) filter (where published) as published_ids,
           count(*) filter (where published) = count(*) as is_complete
      from rolled
     group by window_start, window_end
  `);
