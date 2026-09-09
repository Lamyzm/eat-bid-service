/** @module 책임: 선택 revision의 명단과 같은 원본 관측의 업체명·판정 라벨·관측 시각을 한 SQL snapshot으로 읽는다. */
import { sql, type SQL } from "drizzle-orm";
import type { AuctionRosterQuery } from "../../application/auction-roster-reader";

/**
 * 구매기관 코드의 소유 체계다. 같은 기관이 학교 코드처럼 다른 소유기관의 식별자도 가질 수 있고 그
 * 라벨은 다른 시각에 관측되므로, 명시적 매핑 없이 한 시각으로 섞지 않는다(AGENTS 6, ADR 0006).
 * 발행 경로에서 이 namespace를 쓰는 곳은 `apps/dataplane/src/eatbid/source/eat/code_schemes.py`다.
 */
const ORGANIZATION_CODE_SCHEME = "eat:organization";

/**
 * 명단의 공개 `observedAt`이 될 원본 관측 시각을 core 안에서만 찾는다.
 *
 * 왜 `ingest.raw_observation.fetched_at`을 읽지 않는가: API 역할은 `ingest`를 전혀 읽지 못하고
 * (`infra/product/db-provisioning.sql`) 그 금지는 의도된 경계다. 대신 projector가 같은 transaction에서
 * 필수 구매기관 라벨을 그 raw `fetched_at`으로 `core.code_label_observation.observed_at`에 투영하므로
 * (`postgres_projection_writer.apply` → `postgres_code_values.resolve_label`) 같은 값이 core에 이미 있다.
 *
 * 왜 revision의 `observation_id`로 좁히는가: `organization_identifier.observation_id`는 기관 정체성을
 * 처음 이은 관측이라 회차마다 다시 쓰이지 않고, 같은 코드의 다른 라벨 관측은 다른 회차의 사실이다.
 * 지금 읽는 revision이 나온 그 관측의 라벨만 이 회차의 관측 시각이다(ADR 0015, ADR 0041 결정 1·4).
 *
 * 왜 한 값으로 뭉개지 않는가: 후보 라벨이 하나의 시각으로 모이지 않으면 어느 쪽이 이 회차의 관측인지
 * 말할 수 없다. `min`/`max`로 하나를 고르면 모순을 성공 응답 뒤에 숨기게 되므로 개수를 함께 돌려주고
 * 판정은 reader가 한다. 후보가 없어도 revision 행 자체는 남아야 "없는 공고"와 구별된다.
 *
 * 왜 문자열로 건네는가: driver의 `Date`는 밀리초까지만 담아 raw 관측의 마이크로초를 잃는다.
 *
 * 왜 별칭을 인자로 받는가: 한 회차를 읽는 조회와 여러 회차를 한 번에 읽는 개인 조회가 같은 관측 시각
 * 규칙을 써야 한다. 두 벌로 두면 한쪽만 바뀔 때 같은 회차의 관측 시각이 화면마다 달라진다.
 */
export function purchaserObservedAtJoin(source: SQL) {
  return sql`
    left join lateral (
      select count(distinct label.observed_at)::integer as observed_at_count,
             case when count(distinct label.observed_at) = 1
               then to_char(min(label.observed_at) at time zone 'utc',
                            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as observed_at
        from core.auction_organization purchaser
        join core.organization_identifier identifier
          on identifier.organization_id = purchaser.organization_id
        join core.code_value organization_code
          on organization_code.code_value_id = identifier.code_value_id
        join core.code_scheme organization_scheme
          on organization_scheme.code_scheme_id = organization_code.code_scheme_id
         and organization_scheme.namespace = ${ORGANIZATION_CODE_SCHEME}
        join core.code_label_observation label
          on label.code_value_id = organization_code.code_value_id
         and label.observation_id = ${source}.observation_id
       where purchaser.auction_revision_id = ${source}.auction_revision_id
         and purchaser.role = 'purchaser'
    ) observation on true`;
}

export function auctionRosterQuery(query: AuctionRosterQuery) {
  return sql`
    with selected as (
      select r.*, a.source_system
      from core.auction_revision r
      join core.auction_attempt a using (auction_attempt_id)
      where r.auction_attempt_id = ${query.auctionId}
        and (${query.revisionId}::bigint is null or r.auction_revision_id = ${query.revisionId}::bigint)
      order by r.auction_revision_id desc limit 1
    ), chosen as (
      select selected.*, observation.observed_at_count, observation.observed_at,
        case when jsonb_typeof(selected.source_payload #> '{roster,submissions}') = 'array'
          then jsonb_array_length(selected.source_payload #> '{roster,submissions}') end as expected_count,
        (selected.source_payload #>> '{roster,sourceRosterSize}')::integer as source_roster_size
      from selected
      ${purchaserObservedAtJoin(sql.raw("selected"))}
    )
    select r.auction_attempt_id as auction_id, r.auction_revision_id as revision_id,
      r.observation_id, r.normalized_record_id, r.content_sha256, r.source_system,
      r.observed_at, r.observed_at_count, r.expected_count, r.source_roster_size,
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
