/**
 * @module 책임: 고정한 build의 회차 목록에서 명단 전체의 완전성 근거와 한 party의 제출 행을 집합 SQL
 * 하나로 읽는다.
 *
 * 회차마다 조회를 반복하지 않는 이유는 그 반복이 서로 다른 시점을 보기 때문이다. 명단 수·좌표·관측
 * 시각은 내 행을 고르기 전에 확인해야 하는 근거이므로 같은 문장에서 나온다(ADR 0041 §5).
 */
import { sql, type SQL } from "drizzle-orm";
import type { OwnBidAttemptKey } from "../../application/own-bid-reader";
import { purchaserObservedAtJoin } from "./auction-roster-query";

/**
 * 요청 조합을 그대로 관계로 만든다. `IN` 두 개로 나누면 A회차의 revision과 B회차의 revision이 서로
 * 교차한 조합까지 통과해, 다른 회차의 해석을 요청한 요청이 조용히 성공한다.
 */
function requestedAttempts(attempts: readonly OwnBidAttemptKey[]): SQL {
  return sql.join(
    attempts.map((attempt) => sql`(${attempt.attemptId}::bigint, ${attempt.revisionId}::bigint)`),
    sql`, `,
  );
}

export function ownBidQuery(input: {
  /** 미관측 사업자는 null이며 그 조건은 어떤 명단 행과도 일치하지 않는다. */
  readonly supplierPartyId: bigint | null;
  readonly organizationId: bigint;
  readonly buildId: bigint;
  readonly attempts: readonly OwnBidAttemptKey[];
}): SQL {
  return sql`
    with requested (auction_attempt_id, auction_revision_id) as (
      values ${requestedAttempts(input.attempts)}
    ), chosen as (
      -- 조합이 이 build와 이 기관의 요약에 실제로 있어야 읽는다. 최신 revision으로 넓히지 않는다.
      select requested.auction_attempt_id,
             requested.auction_revision_id,
             revision.opened_at,
             revision.observation_id,
             revision.normalized_record_id,
             revision.content_sha256,
             attempt.source_system,
             case when jsonb_typeof(revision.source_payload #> '{roster,submissions}') = 'array'
               then jsonb_array_length(revision.source_payload #> '{roster,submissions}') end as expected_count
        from requested
        join mart.org_round_summary summary
          on summary.build_id = ${input.buildId}::bigint
         and summary.organization_id = ${input.organizationId}::bigint
         and summary.auction_attempt_id = requested.auction_attempt_id
         and summary.auction_revision_id = requested.auction_revision_id
        join core.auction_revision revision
          on revision.auction_revision_id = requested.auction_revision_id
        join core.auction_attempt attempt
          on attempt.auction_attempt_id = requested.auction_attempt_id
    ), counted as (
      -- 명단 전체를 먼저 센다. 내 행만 세면 원본 배열과 발행 행 수가 어긋난 회차를 정상으로 읽는다.
      select chosen.*, roster.row_count, roster.ordinal_count, roster.foreign_observation_count,
             observation.observed_at, observation.observed_at_count
        from chosen
        left join lateral (
          select count(*)::integer as row_count,
                 count(distinct roster_row.roster_ordinal)::integer as ordinal_count,
                 -- 발행 경로는 명단 행의 observation_id를 revision과 같은 관측으로 앉힌다
                 -- (dataplane의 RosterProjectionWriter). 어긋난 행은 FK가 잡지 못하는 불변식
                 -- 위반이며, 내 party 행만 보면 다른 행의 위반을 놓친 채 미참여를 확정한다.
                 count(*) filter (
                   where roster_row.observation_id is distinct from chosen.observation_id
                 )::integer as foreign_observation_count
            from core.bid_submission roster_row
           where roster_row.auction_revision_id = chosen.auction_revision_id
             and roster_row.auction_attempt_id = chosen.auction_attempt_id
             and roster_row.opened_at is not distinct from chosen.opened_at
        ) roster on true
        ${purchaserObservedAtJoin(sql.raw("chosen"))}
    )
    select counted.auction_attempt_id, counted.auction_revision_id,
           counted.observation_id, counted.normalized_record_id, counted.content_sha256,
           counted.source_system, counted.expected_count, counted.row_count, counted.ordinal_count,
           counted.foreign_observation_count, counted.observed_at, counted.observed_at_count,
           own.bid_submission_id as submission_id, own.roster_ordinal, own.supplier_party_id,
           own.source_supplier_account_id, own.amount, own.effective_amount, own.currency,
           own.bid_rate, own.rank, own.submitted_at,
           status.code_value_id as status_id, status.code as status_code,
           status_scheme.namespace as status_scheme, status_label.label as status_label
      from counted
      -- 내 party의 행만 고른다. 같은 회차의 여러 원본 계정과 여러 제출은 그대로 여러 행으로 남는다.
      left join core.bid_submission own
        on own.auction_revision_id = counted.auction_revision_id
       and own.auction_attempt_id = counted.auction_attempt_id
       and own.opened_at is not distinct from counted.opened_at
       and own.supplier_party_id = ${input.supplierPartyId}::bigint
      left join core.code_value status on status.code_value_id = own.source_status_code_value_id
      left join core.code_scheme status_scheme on status_scheme.code_scheme_id = status.code_scheme_id
      left join lateral (
        select label from core.code_label_observation
        where code_value_id = status.code_value_id and observation_id = own.observation_id
        order by code_label_observation_id desc limit 1
      ) status_label on true
     order by counted.auction_attempt_id, own.roster_ordinal nulls first
  `;
}
