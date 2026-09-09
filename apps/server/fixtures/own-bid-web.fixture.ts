/**
 * @module 책임: 브라우저 인수용 seed — own-bid seed 위에 개찰일·낙찰값·현재 공고·같은 날 겹친 내 제출·다음 build의
 * 같은 회차를 얹어 결정 화면이 실제 Nest 위에서 내 투찰 점을 그릴 수 있게 한다.
 *
 * 시각은 실행 시각 상대값이다. 결정 화면의 기본 기간(12개월)이 절대 날짜에 걸려 어느 날 갑자기 표본이 비면
 * 검사가 코드가 아니라 달력 때문에 깨진다.
 */
import { expect } from "bun:test";
import type postgres from "postgres";
import { disposableDatabase } from "./disposable-database.fixture";
import { ACTIVE_BUILD_ID, BULK_ATTEMPT_COUNT, NEXT_BUILD_ID, TARGET_ORGANIZATION_ID, seedOwnBid } from "./own-bid.fixture";

/** 화면이 여는 공고. 회차 이력에서 자기 자신은 빠지므로 첫 페이지 60행이 전부 다른 회차가 된다. */
export const WEB_CURRENT_AUCTION_ID = 8110n;
/** 같은 날 같은 값(89.500)으로 두 회차에 제출한 경우다. 점이 완전히 겹친다. */
export const WEB_OVERLAP_ATTEMPTS = { first: 8201n, second: 8202n } as const;
/** 낙찰 판정이 없고 내 제출만 둘(101.975·89.001) 있는 회차다. own 점만으로 열려야 한다. */
export const WEB_OWN_ONLY_ATTEMPT_ID = 8101n;
const BULK_BASE = 8200;
/** 겹친 제출의 개찰 시각. 날 단위로 잘라 문장마다 now()가 달라도 같은 값이 되게 한다. */
const OVERLAP_OPENED_AT = "(date_trunc('day', now()) - interval '20 days')";

const sha = (character: string) => character.repeat(64);

const webSeed = `
  -- 현재 공고: 열린 회차이며 mart에는 없다. 회차 이력은 자기 자신을 빼므로 첫 페이지가 다른 회차 60개가 된다.
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params, fetched_at, http_status, content_sha256)
  overriding system value
  values (6120, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}', now(), 200, '${sha("c")}');
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload, parser_version, normalized_at)
  overriding system value
  values (5120, 6120, 'auction.v2', 'external-8110', '{}', 'eat-v3', now());
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (${WEB_CURRENT_AUCTION_ID}, 'eat', 'external-8110');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id, content_sha256, display_bid_no,
     source_status, title, announced_at, deadline_at, opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (9110, ${WEB_CURRENT_AUCTION_ID}, 5120, 6120, '${sha("7")}', null, 'OPEN', '남산초 축산물 구매',
    now() - interval '1 day', now() + interval '1 day', now() + interval '1 day 3 hours', 2761700.00, null, 'KRW', '{}');
  insert into core.auction_organization (auction_revision_id, organization_id, role)
  values (9110, ${TARGET_ORGANIZATION_ID}, 'purchaser');

  -- 현재 공고에 하한율 조건이 없으므로 화면은 하한율 unknown(null)인 회차만 이력으로 읽는다.
  update mart.org_round_summary set floor_rate = null where organization_id = ${TARGET_ORGANIZATION_ID};
  -- 고정 회차의 개찰일을 최근으로 놓는다. 8103은 명단 미관측 열린 회차라 개찰일 없이 둔다.
  update mart.org_round_summary set opened_at = now() - interval '9 days', awarded_assessment_rate = null
   where auction_attempt_id = 8101;
  update mart.org_round_summary set opened_at = now() - interval '8 days', awarded_assessment_rate = 89.002,
    runner_up_assessment_rate = 89.003, list_count = 2, winner_supplier_party_id = 7702
   where auction_attempt_id = 8102;
  update mart.org_round_summary set opened_at = now() - interval '7 days'
   where auction_attempt_id in (8104, 8105, 8107, 8108, 8109);
  -- 대량 회차: 30일 전부터 하루씩 뒤로. 낙찰값을 실어 흐름 선이 그려지게 한다.
  update mart.org_round_summary s set
    announced_at = now() - ((33 + (s.auction_attempt_id - ${BULK_BASE})) || ' days')::interval,
    opened_at = now() - ((30 + (s.auction_attempt_id - ${BULK_BASE})) || ' days')::interval,
    awarded_assessment_rate = 89.000 + ((s.auction_attempt_id - ${BULK_BASE}) % 7) * 0.111,
    list_count = 5
   where s.auction_attempt_id between ${BULK_BASE} and ${BULK_BASE + BULK_ATTEMPT_COUNT - 1};
  -- 겹친 제출: 8201·8202를 같은 날로 놓고 내 party 행을 같은 값으로 넣는다. 명단 블록 수와 행 수를 맞춘다.
  -- 명단 행은 revision의 개찰 시각과 정확히 같은 opened_at에서만 그 명단으로 세므로 세 자리에 같은 값을 쓴다.
  update mart.org_round_summary set opened_at = ${OVERLAP_OPENED_AT}, awarded_assessment_rate = null,
    winner_supplier_party_id = null, list_count = 1
   where auction_attempt_id = ${WEB_OVERLAP_ATTEMPTS.first};
  update mart.org_round_summary set opened_at = ${OVERLAP_OPENED_AT}, awarded_assessment_rate = 89.600,
    winner_supplier_party_id = 7702, list_count = 2
   where auction_attempt_id = ${WEB_OVERLAP_ATTEMPTS.second};
  update core.auction_revision set opened_at = ${OVERLAP_OPENED_AT},
    source_payload = '{"roster":{"submissions":[{}],"sourceRosterSize":1}}'
   where auction_revision_id = 9201;
  update core.auction_revision set opened_at = ${OVERLAP_OPENED_AT},
    source_payload = '{"roster":{"submissions":[{},{}],"sourceRosterSize":2}}'
   where auction_revision_id = 9202;
  -- 회차의 관측 시각은 그 관측에 매달린 구매기관 라벨 하나에서 읽는다. 라벨이 없으면 명단이 있어도 시각을 말할 수 없다.
  insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
  values (7101, '남산초', 'und', ${OVERLAP_OPENED_AT}, 6201),
         (7101, '남산초', 'und', ${OVERLAP_OPENED_AT}, 6202);
  insert into core.bid_submission
    (auction_revision_id, auction_attempt_id, opened_at, roster_ordinal, source_supplier_account_id, supplier_party_id,
     submitted_at, amount, effective_amount, currency, bid_rate, rank, source_status_code_value_id, observation_id)
  values
    (9201, 8201, ${OVERLAP_OPENED_AT}, 0, 7801, 7701, null, 2472000.00, 2472000.00, 'KRW', 89.500, null, 7201, 6201),
    (9202, 8202, ${OVERLAP_OPENED_AT}, 0, 7801, 7701, null, 2472000.00, 2472000.00, 'KRW', 89.500, 2, 7201, 6202),
    (9202, 8202, ${OVERLAP_OPENED_AT}, 1, 7802, 7702, null, 2474762.00, 2474762.00, 'KRW', 89.600, 1, 7202, 6202);

  -- 다음 build: 8101은 새 해석(9111, 내 행 없음)을 그대로 두고 나머지 회차는 같은 revision을 복사한다.
  update mart.org_round_summary set opened_at = now() - interval '9 days', floor_rate = null
   where build_id = ${NEXT_BUILD_ID} and auction_attempt_id = 8101;
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id, item_code_value_id, item_label, announced_at,
     opened_at, floor_rate, award_method_code_value_id, base_amount, planned_amount, currency, awarded_assessment_rate,
     runner_up_assessment_rate, day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id, lineage_status,
     opened_month_kst)
  select ${NEXT_BUILD_ID}, auction_attempt_id, auction_revision_id, organization_id, item_code_value_id, item_label,
     announced_at, opened_at, floor_rate, award_method_code_value_id, base_amount, planned_amount, currency,
     awarded_assessment_rate, runner_up_assessment_rate, day_floor_amount, day_floor_bid_rate, awarded_bid_rate,
     list_count, below_day_floor_count, withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id,
     supersedes_attempt_id, lineage_status, opened_month_kst
    from mart.org_round_summary
   where build_id = ${ACTIVE_BUILD_ID} and organization_id = ${TARGET_ORGANIZATION_ID} and auction_attempt_id <> 8101;
`;

export const ownBidWebDatabase = disposableDatabase({
  task: "eat40-own-bid-web",
  migrationApplyCount: 1,
  // mart 행 수정은 build가 아직 building인 활성화 직전에만 허용된다(ADR 0034 trigger).
  seed: (owner) => seedOwnBid(owner, { beforeActivation: (client) => client.unsafe(webSeed) }),
});

/**
 * 본문과 container 정리를 모두 확인한다. 둘 다 실패하면 원래 오류를 정리 오류로 덮지 않는다
 * (account.fixture의 `withAccountDatabase`와 같은 규칙).
 */
export async function withOwnBidWebDatabase<A>(
  work: (database: Parameters<Parameters<typeof ownBidWebDatabase.withDatabase<A>>[0]>[0]) => Promise<A>,
): Promise<A> {
  let result: A | undefined;
  let bodyFailure: unknown;
  try {
    result = await ownBidWebDatabase.withDatabase(work);
  } catch (error) {
    bodyFailure = error;
  }
  let cleanupFailure: unknown;
  try {
    await ownBidWebDatabase.expectOwnedContainersCleanedUp();
  } catch (error) {
    cleanupFailure = error;
  }
  if (bodyFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError([bodyFailure, cleanupFailure], "검사 본문과 container 정리가 모두 실패했습니다.");
  }
  if (bodyFailure !== undefined) throw bodyFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  return result as A;
}

/** harness가 정리 확인 helper를 그대로 쓰도록 expect를 다시 내보낸다. */
export { expect as fixtureExpect };
export type OwnerClient = ReturnType<typeof postgres>;
