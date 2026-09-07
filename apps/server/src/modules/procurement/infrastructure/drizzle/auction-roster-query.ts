/** @module 책임: 선택 revision의 명단과 같은 원본 관측의 업체명·판정 라벨을 한 SQL snapshot으로 읽는다. */
import { sql } from "drizzle-orm";
import type { AuctionRosterQuery } from "../../application/auction-roster-reader";

export function auctionRosterQuery(query: AuctionRosterQuery) {
  return sql`
    with chosen as (
      select r.*, a.source_system, o.fetched_at,
        case when jsonb_typeof(r.source_payload #> '{roster,submissions}') = 'array'
          then jsonb_array_length(r.source_payload #> '{roster,submissions}') end as expected_count,
        (r.source_payload #>> '{roster,sourceRosterSize}')::integer as source_roster_size
      from core.auction_revision r
      join core.auction_attempt a using (auction_attempt_id)
      join ingest.raw_observation o on o.observation_id = r.observation_id
      where r.auction_attempt_id = ${query.auctionId}
        and (${query.revisionId}::bigint is null or r.auction_revision_id = ${query.revisionId}::bigint)
      order by r.auction_revision_id desc limit 1
    )
    select r.auction_attempt_id as auction_id, r.auction_revision_id as revision_id,
      r.observation_id, r.normalized_record_id, r.content_sha256, r.source_system,
      r.fetched_at, r.expected_count, r.source_roster_size,
      b.bid_submission_id as submission_id, b.roster_ordinal, b.supplier_party_id,
      b.source_supplier_account_id, b.amount, b.effective_amount, b.currency,
      b.bid_rate, b.rank, b.submitted_at, supplier_label.label as supplier_name,
      status.code_value_id as status_id, status.code as status_code,
      status_scheme.namespace as status_scheme, status_label.label as status_label,
      withdrawal.code_value_id as withdrawal_id, withdrawal.code as withdrawal_code,
      withdrawal_scheme.namespace as withdrawal_scheme, withdrawal_label.label as withdrawal_label,
      award.awarded_roster_ordinal, award.awarded_amount, award.currency as award_currency,
      award.awarded_rate, award.runner_up_rate
    from chosen r
    left join core.bid_submission b on b.auction_revision_id = r.auction_revision_id
      and b.auction_attempt_id = r.auction_attempt_id and b.opened_at is not distinct from r.opened_at
    left join core.source_supplier_account account on account.source_supplier_account_id = b.source_supplier_account_id
    left join lateral (
      select label from core.code_label_observation
      where code_value_id = account.account_code_value_id and observation_id = b.observation_id
      order by code_label_observation_id desc limit 1
    ) supplier_label on true
    left join core.code_value status on status.code_value_id = b.source_status_code_value_id
    left join core.code_scheme status_scheme on status_scheme.code_scheme_id = status.code_scheme_id
    left join lateral (
      select label from core.code_label_observation
      where code_value_id = status.code_value_id and observation_id = b.observation_id
      order by code_label_observation_id desc limit 1
    ) status_label on true
    left join core.code_value withdrawal on withdrawal.code_value_id = b.withdrawal_code_value_id
    left join core.code_scheme withdrawal_scheme on withdrawal_scheme.code_scheme_id = withdrawal.code_scheme_id
    left join lateral (
      select label from core.code_label_observation
      where code_value_id = withdrawal.code_value_id and observation_id = b.observation_id
      order by code_label_observation_id desc limit 1
    ) withdrawal_label on true
    left join core.award_decision award on award.auction_revision_id = r.auction_revision_id
    order by b.roster_ordinal asc
    limit 2049
  `;
}
