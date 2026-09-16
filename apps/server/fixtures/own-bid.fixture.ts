/**
 * @module 책임: 내 투찰 관측 검사가 쓰는 격리 PostgreSQL과 core·mart seed, 그리고 build 전환 절차를
 * 한 곳에서 빌려준다.
 *
 * seed를 한 곳에 두는 이유: 어댑터 검사와 HTTP 검사가 같은 사실을 봐야 두 검사가 같은 결론을 말한다.
 * 검사마다 seed를 복제하면 한쪽만 고쳐진 사실 위에서 통과하는 검사가 생긴다.
 */
import type postgres from "postgres";
import { disposableDatabase } from "./disposable-database.fixture";

/** 합성 사업자등록번호다. 검증번호 규칙만 만족하며 실재하는 업체의 번호가 아니다. */
export const myBusinessNumber = "9000000016";
/** 원본이 아직 관측하지 않은 번호다. 등록은 되지만 연결은 없다. */
export const unobservedBusinessNumber = "9000000020";
/** 같은 번호가 두 표기로 관측되어 서로 다른 party에 붙은 번호다. 하나를 고를 수 없다. */
export const conflictedBusinessNumber = "9000000035";

export const TARGET_ORGANIZATION_ID = 41n;
export const OTHER_ORGANIZATION_ID = 43n;
export const MY_SUPPLIER_PARTY_ID = 7701n;
export const ACTIVE_BUILD_ID = 601n;
export const NEXT_BUILD_ID = 602n;

/** 회차별 명단 상한이며 이 값을 넘긴 회차만 격리된다. batch 전체에 다시 걸리지 않는다. */
export const OVERSIZED_ROSTER_ROWS = 2049;

export const OBSERVED_AT = {
  attempt8101: "2026-09-05T03:04:05.123456Z",
  attempt8102: "2026-09-05T04:04:05.000001Z",
  attempt8103: "2026-09-05T05:04:05.000002Z",
  attempt8104: "2026-09-05T06:04:05.000003Z",
  attempt8107: "2026-09-05T08:04:05.000004Z",
  attempt8108: "2026-09-05T10:04:05.000005Z",
  attempt8109: "2026-09-05T11:04:05.000006Z",
} as const;

/** 고정 좌표로 seed하는 회차 수다. mart build의 행 수·coverage가 이 수와 대량 회차의 합이다. */
const FIXED_ATTEMPT_COUNT = 9;

const sha = (character: string) => character.repeat(64);
const roster = (count: number) =>
  `{"roster":{"submissions":[${Array.from({ length: count }, () => "{}").join(",")}],"sourceRosterSize":${count}}}`;

const identitySeed = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (7100, 'eat:organization', 'aT', 'source-managed', 'effective-dated'),
    (7200, 'eat:bid-status', 'aT', 'source-managed', 'effective-dated'),
    (7300, 'eat:supplier-account', 'aT', 'source-managed', 'effective-dated'),
    (7500, 'eat:business-number', 'eat', 'source-versioned', 'observed');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (7101, 7100, 'PURR-41'), (7102, 7100, 'PURR-43'),
    (7201, 7200, '005'), (7202, 7200, '002'),
    (7301, 7300, 'SHIPPER-1'), (7302, 7300, 'SHIPPER-2'), (7303, 7300, 'SHIPPER-3'),
    (7501, 7500, '${myBusinessNumber}'),
    (7502, 7500, '${conflictedBusinessNumber}');
  insert into core.supplier_party (supplier_party_id, type, business_number_code_value_id)
  overriding system value
  values (7701, 'company', 7501), (7703, 'company', 7502);
  insert into core.supplier_party (supplier_party_id, type, canonical_name)
  overriding system value
  values (7702, 'company', null);
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value
  values (${TARGET_ORGANIZATION_ID}, 'school', '창원 남산초등학교'), (${OTHER_ORGANIZATION_ID}, 'school', '다른 학교');
`;

const evidenceSeed = `
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values ('00000000-0000-0000-0000-000000000040', 'capture', 'published', '${sha("a")}',
    'eat-v3', '2026-09-05T00:00:00Z', '2026-09-05T00:01:00Z', null, 10, 10, 10);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values (1401, '00000000-0000-0000-0000-000000000040', 'eat', '/bid-detail', '{}',
    '${sha("b")}', 10, 10, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${sha("c")}', 'raw/eat/bid-detail/${sha("c")}.xml.gz', 10, 'application/xml', 'gzip',
    '2026-09-05T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values (6001, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '2026-08-01T00:00:00Z', 200, '${sha("c")}'),
    (6101, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8101}', 200, '${sha("c")}'),
    (6111, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '2026-09-07T03:04:05.000000Z', 200, '${sha("c")}'),
    (6102, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8102}', 200, '${sha("c")}'),
    (6103, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8103}', 200, '${sha("c")}'),
    (6104, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8104}', 200, '${sha("c")}'),
    (6105, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '2026-09-05T07:04:05Z', 200, '${sha("c")}'),
    (6106, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '2026-09-05T09:04:05Z', 200, '${sha("c")}'),
    (6107, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8107}', 200, '${sha("c")}'),
    (6108, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8108}', 200, '${sha("c")}'),
    (6109, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
      '${OBSERVED_AT.attempt8109}', 200, '${sha("c")}');
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (5101, 6101, 'auction.v2', 'external-8101', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5111, 6111, 'auction.v2', 'external-8101', '{}', 'eat-v3', '2026-09-07T00:01:00Z'),
    (5102, 6102, 'auction.v2', 'external-8102', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5103, 6103, 'auction.v2', 'external-8103', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5104, 6104, 'auction.v2', 'external-8104', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5105, 6105, 'auction.v2', 'external-8105', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5106, 6106, 'auction.v2', 'external-8106', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5107, 6107, 'auction.v2', 'external-8107', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5108, 6108, 'auction.v2', 'external-8108', '{}', 'eat-v3', '2026-09-05T00:01:00Z'),
    (5109, 6109, 'auction.v2', 'external-8109', '{}', 'eat-v3', '2026-09-05T00:01:00Z');
  insert into core.organization_identifier (organization_id, code_value_id, observation_id)
  values (${TARGET_ORGANIZATION_ID}, 7101, 6001), (${OTHER_ORGANIZATION_ID}, 7102, 6001);
  -- 회차의 관측 시각은 그 회차가 나온 관측에 매달린 구매기관 라벨이다. 8105는 한 관측에 시각이 둘이라
  -- 어느 쪽이 이 회차의 관측인지 말할 수 없다.
  insert into core.code_label_observation
    (code_value_id, label, language, observed_at, observation_id)
  values (7101, '남산초', 'und', '${OBSERVED_AT.attempt8101}', 6101),
    (7101, '남산초', 'und', '2026-09-07T03:04:05.000000Z', 6111),
    (7101, '남산초', 'und', '${OBSERVED_AT.attempt8102}', 6102),
    (7101, '남산초', 'und', '${OBSERVED_AT.attempt8103}', 6103),
    (7101, '남산초', 'und', '${OBSERVED_AT.attempt8104}', 6104),
    (7101, '모순 관측 가', 'und', '2026-09-05T07:04:05Z', 6105),
    (7101, '모순 관측 나', 'und', '2026-09-05T07:04:06Z', 6105),
    (7102, '다른 학교', 'und', '2026-09-05T09:04:05Z', 6106),
    (7101, '남산초', 'und', '${OBSERVED_AT.attempt8107}', 6107),
    (7101, '남산초', 'und', '${OBSERVED_AT.attempt8108}', 6108),
    (7101, '남산초', 'und', '${OBSERVED_AT.attempt8109}', 6109),
    (7201, '낙찰실패', 'und', '${OBSERVED_AT.attempt8101}', 6101),
    (7202, '낙찰', 'und', '${OBSERVED_AT.attempt8101}', 6101);
  insert into core.source_supplier_account
    (source_supplier_account_id, supplier_party_id, source_system, account_code_value_id, observation_id)
  overriding system value
  values (7801, 7701, 'eat', 7301, 6101), (7802, 7702, 'eat', 7302, 6101),
    (7803, 7701, 'eat', 7303, 6101);
`;

const auctionSeed = `
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (8101, 'eat', 'external-8101'), (8102, 'eat', 'external-8102'),
    (8103, 'eat', 'external-8103'), (8104, 'eat', 'external-8104'),
    (8105, 'eat', 'external-8105'), (8106, 'eat', 'external-8106'),
    (8107, 'eat', 'external-8107'), (8108, 'eat', 'external-8108'),
    (8109, 'eat', 'external-8109');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (9101, 8101, 5101, 6101, '${sha("d")}', null, 'CLOSED', '농산물 구매',
      '2026-09-01T00:00:00Z', null, '2026-09-05T05:00:00Z', 1000000.00, 990000.00, 'KRW', '${roster(3)}'),
    -- 같은 회차의 더 새로운 해석이다. mart가 고정한 9101 대신 이것을 읽으면 내 행이 사라진다.
    (9111, 8101, 5111, 6111, '${sha("e")}', null, 'CLOSED', '농산물 구매',
      '2026-09-01T00:00:00Z', null, '2026-09-05T05:00:00Z', 1000000.00, 990000.00, 'KRW', '${roster(1)}'),
    (9102, 8102, 5102, 6102, '${sha("f")}', null, 'CLOSED', '농산물 구매',
      '2026-09-02T00:00:00Z', null, '2026-09-06T05:00:00Z', 1000000.00, 990000.00, 'KRW', '${roster(2)}'),
    (9103, 8103, 5103, 6103, '${sha("0")}', null, 'OPEN', '명단 미관측 공고',
      '2026-09-03T00:00:00Z', null, null, 500000.00, null, 'KRW', '{}'),
    (9104, 8104, 5104, 6104, '${sha("1")}', null, 'CLOSED', '명단 수 불일치 공고',
      '2026-09-04T00:00:00Z', null, '2026-09-08T05:00:00Z', 500000.00, null, 'KRW', '${roster(3)}'),
    (9105, 8105, 5105, 6105, '${sha("2")}', null, 'CLOSED', '관측 시각 모순 공고',
      '2026-09-05T00:00:00Z', null, '2026-09-09T05:00:00Z', 500000.00, null, 'KRW', '${roster(1)}'),
    (9106, 8106, 5106, 6106, '${sha("3")}', null, 'CLOSED', '다른 기관 공고',
      '2026-09-06T00:00:00Z', null, '2026-09-10T05:00:00Z', 500000.00, null, 'KRW', '${roster(1)}'),
    (9107, 8107, 5107, 6107, '${sha("4")}', null, 'CLOSED', '상한 초과 명단 공고',
      '2026-09-07T00:00:00Z', null, '2026-09-11T05:00:00Z', 500000.00, null, 'KRW',
      jsonb_build_object('roster', jsonb_build_object(
        'submissions', (select jsonb_agg('{}'::jsonb) from generate_series(1, ${OVERSIZED_ROSTER_ROWS})),
        'sourceRosterSize', ${OVERSIZED_ROSTER_ROWS}))),
    -- 8108·8109는 명단 수·좌표·관측 시각이 모두 정상이고 제출 행 하나의 관측만 어긋난 회차다.
    (9108, 8108, 5108, 6108, '${sha("5")}', null, 'CLOSED', '내 행 관측 어긋난 공고',
      '2026-09-08T00:00:00Z', null, '2026-09-12T05:00:00Z', 500000.00, null, 'KRW', '${roster(2)}'),
    (9109, 8109, 5109, 6109, '${sha("6")}', null, 'CLOSED', '남의 행 관측 어긋난 공고',
      '2026-09-09T00:00:00Z', null, '2026-09-13T05:00:00Z', 500000.00, null, 'KRW', '${roster(2)}');
  insert into core.auction_organization (auction_revision_id, organization_id, role)
  values (9101, ${TARGET_ORGANIZATION_ID}, 'purchaser'), (9111, ${TARGET_ORGANIZATION_ID}, 'purchaser'),
    (9102, ${TARGET_ORGANIZATION_ID}, 'purchaser'), (9103, ${TARGET_ORGANIZATION_ID}, 'purchaser'),
    (9104, ${TARGET_ORGANIZATION_ID}, 'purchaser'), (9105, ${TARGET_ORGANIZATION_ID}, 'purchaser'),
    (9106, ${OTHER_ORGANIZATION_ID}, 'purchaser'), (9107, ${TARGET_ORGANIZATION_ID}, 'purchaser'),
    (9108, ${TARGET_ORGANIZATION_ID}, 'purchaser'), (9109, ${TARGET_ORGANIZATION_ID}, 'purchaser');
`;

const rosterSeed = `
  insert into core.bid_submission
    (auction_revision_id, auction_attempt_id, opened_at, roster_ordinal,
     source_supplier_account_id, supplier_party_id, submitted_at, amount, effective_amount,
     currency, bid_rate, rank, source_status_code_value_id, observation_id)
  values
    -- 8101은 낙찰 판정이 없는 회차이고 내 party가 서로 다른 원본 계정으로 두 번 제출했다.
    (9101, 8101, '2026-09-05T05:00:00Z', 0, 7802, 7702, '2026-09-05T04:59:00Z',
      43120181.00, 43120181.00, 'KRW', 89.002, 1, 7202, 6101),
    -- 실제 금액이 관측되지 않았고 계산 금액은 자리표시자다. 사정률은 100을 넘는다.
    (9101, 8101, '2026-09-05T05:00:00Z', 1, 7801, 7701, '2026-09-05T04:58:00Z',
      10000000043768.00, null, 'KRW', 101.975, null, 7201, 6101),
    (9101, 8101, '2026-09-05T05:00:00Z', 2, 7803, 7701, '2026-09-05T04:57:00Z',
      43120180.00, 43120180.00, 'KRW', 89.001, 2, 7201, 6101),
    -- 새 해석의 명단에는 내 party가 없다. mart 고정 revision을 읽으면 위 두 행이 남는다.
    (9111, 8101, '2026-09-05T05:00:00Z', 0, 7802, 7702, null,
      43120181.00, 43120181.00, 'KRW', 89.002, 1, 7202, 6111),
    (9102, 8102, '2026-09-06T05:00:00Z', 0, 7802, 7702, null,
      43120181.00, 43120181.00, 'KRW', 89.002, 1, 7202, 6102),
    (9102, 8102, '2026-09-06T05:00:00Z', 1, 7802, 7702, null,
      43120182.00, 43120182.00, 'KRW', 89.003, 2, 7201, 6102),
    -- 원본 배열은 3인데 발행된 행은 2다. 명단을 신뢰할 수 없는 회차다.
    (9104, 8104, '2026-09-08T05:00:00Z', 0, 7801, 7701, null,
      43120180.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6104),
    (9104, 8104, '2026-09-08T05:00:00Z', 1, 7802, 7702, null,
      43120181.00, 43120181.00, 'KRW', 89.002, 2, 7201, 6104),
    (9105, 8105, '2026-09-09T05:00:00Z', 0, 7801, 7701, null,
      43120180.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6105),
    (9106, 8106, '2026-09-10T05:00:00Z', 0, 7801, 7701, null,
      43120180.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6106),
    -- 8108: 내 party 행이 이 revision을 낳은 6108이 아니라 다른 유효 관측 6109를 가리킨다.
    (9108, 8108, '2026-09-12T05:00:00Z', 0, 7802, 7702, null,
      43120181.00, 43120181.00, 'KRW', 89.002, 2, 7201, 6108),
    (9108, 8108, '2026-09-12T05:00:00Z', 1, 7801, 7701, null,
      43120180.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6109),
    -- 8109: 내 행은 정상이고 다른 party의 행만 어긋난다. 내 행만 보면 통과해 버리는 경우다.
    (9109, 8109, '2026-09-13T05:00:00Z', 0, 7802, 7702, null,
      43120181.00, 43120181.00, 'KRW', 89.002, 2, 7201, 6108),
    (9109, 8109, '2026-09-13T05:00:00Z', 1, 7801, 7701, null,
      43120180.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6109);
  -- 상한을 넘긴 회차는 그 회차만 격리된다. batch 전체가 이 크기로 잘리지 않는다.
  insert into core.bid_submission
    (auction_revision_id, auction_attempt_id, opened_at, roster_ordinal,
     source_supplier_account_id, supplier_party_id, submitted_at, amount, effective_amount,
     currency, bid_rate, rank, source_status_code_value_id, observation_id)
  select 9107, 8107, '2026-09-11T05:00:00Z', ordinal, 7802, 7702, null,
      43120181.00, 43120181.00, 'KRW', 89.002, null, 7201, 6107
    from generate_series(0, ${OVERSIZED_ROSTER_ROWS - 1}) as ordinal;
`;

/**
 * 화면이 흐름 차트에 그리는 60회차를 한 요청으로 물을 수 있는지 확인하려면 그만큼의 회차가 실제로
 * 있어야 한다. 이 회차들은 명단 블록이 없는 회차이며 수를 채우는 것이 목적이다.
 */
export const BULK_ATTEMPT_COUNT = 60;
const BULK_ATTEMPT_BASE = 8200;
const BULK_REVISION_BASE = 9200;

export const bulkAttemptKeys = Array.from({ length: BULK_ATTEMPT_COUNT }, (_row, index) => ({
  attemptId: BigInt(BULK_ATTEMPT_BASE + index),
  revisionId: BigInt(BULK_REVISION_BASE + index),
}));

const bulkSeed = `
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  select 6200 + index, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}',
         '2026-09-05T00:00:00Z', 200, '${sha("c")}'
    from generate_series(0, ${BULK_ATTEMPT_COUNT - 1}) as index;
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  select 5200 + index, 6200 + index, 'auction.v2', 'external-' || (${BULK_ATTEMPT_BASE} + index),
         '{}', 'eat-v3', '2026-09-05T00:01:00Z'
    from generate_series(0, ${BULK_ATTEMPT_COUNT - 1}) as index;
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  select ${BULK_ATTEMPT_BASE} + index, 'eat', 'external-' || (${BULK_ATTEMPT_BASE} + index)
    from generate_series(0, ${BULK_ATTEMPT_COUNT - 1}) as index;
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, source_status, title, announced_at, base_amount, currency, source_payload)
  overriding system value
  select ${BULK_REVISION_BASE} + index, ${BULK_ATTEMPT_BASE} + index, 5200 + index, 6200 + index,
         md5(index::text) || md5(index::text || 'x'), 'CLOSED', '대량 회차',
         '2026-09-01T00:00:00Z', 500000.00, 'KRW', '{}'
    from generate_series(0, ${BULK_ATTEMPT_COUNT - 1}) as index;
  insert into core.auction_organization (auction_revision_id, organization_id, role)
  select ${BULK_REVISION_BASE} + index, ${TARGET_ORGANIZATION_ID}, 'purchaser'
    from generate_series(0, ${BULK_ATTEMPT_COUNT - 1}) as index;
`;

const bulkSummarySeed = `
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     announced_at, floor_rate, base_amount, currency, lineage_status)
  select ${ACTIVE_BUILD_ID}, ${BULK_ATTEMPT_BASE} + index, ${BULK_REVISION_BASE} + index,
         ${TARGET_ORGANIZATION_ID}, '2026-09-01T00:00:00Z', 90.000, 500000.00, 'KRW', 'observed'
    from generate_series(0, ${BULK_ATTEMPT_COUNT - 1}) as index;
`;

const summaryRow = (buildId: bigint, attempt: number, revision: number, organization: bigint, announced: string) =>
  `(${buildId}, ${attempt}, ${revision}, ${organization}, null, '${announced}', null,`
  + " 90.000, null, 500000.00, null, 'KRW', null, null, null, null, null, null, null,"
  + " null, null, null, null, 'observed', null)";

const martSeed = `
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000401', 'eat', 'eat-2026-09-05', 'planned', '2026-09-05T00:00:00Z'),
    ('00000000-0000-0000-0000-000000000402', 'eat', 'eat-2026-09-07', 'planned', '2026-09-07T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (${ACTIVE_BUILD_ID}, 'org_round_summary', '00000000-0000-0000-0000-000000000401', 'mart-r1',
      '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building', '2026-09-05T00:00:00Z',
      '2026-09-05T00:05:00Z'),
    (${NEXT_BUILD_ID}, 'org_round_summary', '00000000-0000-0000-0000-000000000402', 'mart-r2',
      '${"b".repeat(40)}', 'eat:auction-location-sido', 'building', '2026-09-07T00:00:00Z',
      '2026-09-07T00:05:00Z');
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst)
  values
    ${summaryRow(ACTIVE_BUILD_ID, 8101, 9101, TARGET_ORGANIZATION_ID, "2026-09-01T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8102, 9102, TARGET_ORGANIZATION_ID, "2026-09-02T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8103, 9103, TARGET_ORGANIZATION_ID, "2026-09-03T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8104, 9104, TARGET_ORGANIZATION_ID, "2026-09-04T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8105, 9105, TARGET_ORGANIZATION_ID, "2026-09-05T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8106, 9106, OTHER_ORGANIZATION_ID, "2026-09-06T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8107, 9107, TARGET_ORGANIZATION_ID, "2026-09-07T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8108, 9108, TARGET_ORGANIZATION_ID, "2026-09-08T00:00:00Z")},
    ${summaryRow(ACTIVE_BUILD_ID, 8109, 9109, TARGET_ORGANIZATION_ID, "2026-09-09T00:00:00Z")},
    -- 다음 build는 같은 회차를 새 해석으로 요약한다. build를 바꿔 읽으면 다른 명단을 보게 된다.
    ${summaryRow(NEXT_BUILD_ID, 8101, 9111, TARGET_ORGANIZATION_ID, "2026-09-01T00:00:00Z")};
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (${ACTIVE_BUILD_ID}, null, '2026-09-01', ${FIXED_ATTEMPT_COUNT + BULK_ATTEMPT_COUNT},
      ${FIXED_ATTEMPT_COUNT + BULK_ATTEMPT_COUNT}, ${FIXED_ATTEMPT_COUNT + BULK_ATTEMPT_COUNT}, 0, 'complete'),
    (${NEXT_BUILD_ID}, null, '2026-09-01', 1, 1, 1, 0, 'complete');
  ${bulkSummarySeed}
`;

// mart 행은 build가 building일 때만 쓸 수 있다(ADR 0034 trigger). 검증·활성화는 행 쓰기가 전부 끝난 뒤 한 번에 한다.
const martActivationSeed = `
  update mart.build set status = 'verified', computed_at = '2026-09-05T00:10:00Z',
    row_count = ${FIXED_ATTEMPT_COUNT + BULK_ATTEMPT_COUNT}
   where build_id = ${ACTIVE_BUILD_ID};
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z', row_count = 1
   where build_id = ${NEXT_BUILD_ID};
  update mart.build set status = 'active', activated_at = '2026-09-05T00:11:00Z'
   where build_id = ${ACTIVE_BUILD_ID};
`;

/**
 * 어댑터·HTTP 검사와 브라우저 harness가 같은 사실 위에서 돌도록 seed를 함수로 빌려준다. mart 행을 더 얹어야
 * 하는 harness는 `beforeActivation`에서 쓴다 — build가 verified·active가 된 뒤에는 trigger가 행 쓰기를 막는다.
 */
export async function seedOwnBid(
  owner: ReturnType<typeof postgres>,
  options: { readonly beforeActivation?: (owner: ReturnType<typeof postgres>) => Promise<void> } = {},
): Promise<void> {
  await owner.unsafe(identitySeed);
  await owner.unsafe(evidenceSeed);
  await owner.unsafe(auctionSeed);
  await owner.unsafe(bulkSeed);
  await owner.unsafe(rosterSeed);
  await owner.unsafe(martSeed);
  await options.beforeActivation?.(owner);
  await owner.unsafe(martActivationSeed);
}

export const ownBidDatabase = disposableDatabase({
  task: "eat40-own-bid",
  migrationApplyCount: 1,
  seed: (owner) => seedOwnBid(owner),
});

/**
 * 이미 등록된 번호를 원본이 나중에 하이픈 표기로도 관측했고 그 code value가 다른 party에 붙은 상태다.
 * 등록 시점에는 하나였으므로 등록은 성공했고, 그 뒤에 증거가 갈린다. 처음부터 갈려 있으면 등록 자체가
 * 실패해 이 상태를 조회에서 볼 수 없다(ADR 0033 §1).
 */
export async function observeConflictingSupplier(client: ReturnType<typeof postgres>): Promise<void> {
  await client.unsafe(`
    insert into core.code_value (code_value_id, code_scheme_id, code)
    overriding system value
    values (7503, 7500, '900-00-00035');
    insert into core.supplier_party (supplier_party_id, type, business_number_code_value_id)
    overriding system value
    values (7704, 'company', 7503);
  `);
}

/**
 * 이전 active를 `superseded`로, 다음 build를 `active`로 바꾸는 한 트랜잭션이다. ADR 0034가 정한
 * 발행 그 자체이며, 두 UPDATE 사이에 활성 build가 없는 순간을 다른 세션에 보이지 않게 한다.
 */
export async function publishNextBuild(client: ReturnType<typeof postgres>): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction.unsafe(`
      update mart.build set status = 'superseded', superseded_at = '2026-09-07T00:11:00Z'
       where build_id = ${ACTIVE_BUILD_ID};
    `);
    await transaction.unsafe(`
      update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z'
       where build_id = ${NEXT_BUILD_ID};
    `);
  });
}
