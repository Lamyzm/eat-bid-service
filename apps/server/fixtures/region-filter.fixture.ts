/**
 * @module 책임: 참가제한지역 필터 통합 검사가 쓰는 일회용 PostgreSQL과 김해 실측 구조를 그대로 옮긴
 * 공고 seed를 빌려준다.
 *
 * 숫자는 build마다 달라지므로 복원본 값을 복사하지 않고 **같은 구조**를 만든다. 2026-09-09 build 212
 * 실측에서 김해 기준 `김해시만` 2건, `김해시 + 경남 전체` 9건, `경남 어디든` 31건, 제한지역 미관측 7건이
 * 나왔고, 이 seed는 그중 판정을 가르는 셋(2·9·7)을 그대로 재현한다.
 */
import { disposableDatabase } from "./disposable-database.fixture";

/** 열림 판정과 과거 창의 끝을 함께 정하는 기준 시각이다. */
export const REGION_FILTER_NOW = "2026-09-07T01:00:00Z";

export const AREA_SCHEME_ID = 21;
/** 코드 값 id는 문자열 코드가 아니라 이 숫자다. 화면과 저장은 이 id만 쓴다(AGENTS 2). */
export const GYEONGNAM_ALL = 9_100n;
export const GIMHAE = 9_101n;
export const CHANGWON = 9_102n;
export const GYEONGBUK_ALL = 9_200n;

/** 김해로 못 박은 공고 둘. `김해시만` 골랐을 때 남는 수와 같다. */
const GIMHAE_ONLY = [1001, 1002];
/** 도 전체로 열린 공고 일곱. 김해 업체도 낼 수 있어 `김해시 + 경남 전체`에서 2 + 7 = 9가 된다. */
const PROVINCE_WIDE = [1003, 1004, 1005, 1006, 1007, 1008, 1009];
/** 창원으로 못 박은 공고. 김해 설정에 들어오면 안 된다. */
const CHANGWON_ONLY = [1010];
/** 제한지역을 관측하지 못한 공고 일곱. 버리지 않고 목록에 남는다(ADR 0048 결정 3). */
const UNOBSERVED = [1011, 1012, 1013, 1014, 1015, 1016, 1017];

export const OPEN_ATTEMPT_IDS = [...GIMHAE_ONLY, ...PROVINCE_WIDE, ...CHANGWON_ONLY, ...UNOBSERVED];

/**
 * 마감은 안 지났지만 목록이 `공고취소`로 표시한 공고 하나다. 도 전체로 열려 있어 조건을 안 걸면
 * 열여덟 번째로 잡힐 자리인데 **열린 공고가 아니므로 목록에도 미리보기 분모에도 안 들어간다.**
 *
 * `OPEN_ATTEMPT_IDS`에 안 넣는 이유는 그 배열이 "이 build에서 열려 있는 수"를 뜻하고 여러 단언이
 * 그 길이를 쓰기 때문이다. 스냅샷 행은 따로 하나 만든다(EAT-203).
 */
const CANCELLED = 1018;

/**
 * 과거 창의 하루별 마감이다. 성수기 하루가 어떤 모양인지 묻는 질문이라 며칠을 서로 다른 크기로 둔다.
 * 마감(`deadline_at`) 기준인 이유는 사용자가 화면을 여는 날이 낼 것을 골라야 하는 날이기 때문이다.
 */
const PAST_DAYS: ReadonlyArray<{ readonly date: string; readonly attemptIds: readonly number[] }> = [
  { date: "2026-06-22", attemptIds: [2001, 2002, 2003] },
  { date: "2026-06-23", attemptIds: [2004, 2005] },
  { date: "2026-06-24", attemptIds: [2006] },
];
/** 창원 공고는 같은 창 안에 있어도 김해 설정의 성수기에 들어가면 안 된다. */
const PAST_CHANGWON = [2007];

export const PEAK_DATE = "2026-06-22";
export const PEAK_COUNT = 3;
export const DAYS_WITH_AUCTIONS = 3;
export const MEDIAN_DAY_COUNT = 2;

const RUN_ID = "00000000-0000-0000-0000-000000000167";
const RELEASE_ID = "00000000-0000-0000-0000-000000000267";
const BLOB = "c".repeat(64);
const OBSERVATION_ID = 3_167;
const BUILD_ID = 6_167;

const pastAttempts = [...PAST_DAYS.flatMap((day) => day.attemptIds), ...PAST_CHANGWON];
const allAttempts = [...OPEN_ATTEMPT_IDS, CANCELLED, ...pastAttempts];

const revisionOf = (attemptId: number) => attemptId + 500_000;
const recordOf = (attemptId: number) => attemptId + 700_000;
const digest = (attemptId: number) => attemptId.toString(16).padStart(64, "0");

function deadlineOf(attemptId: number): string {
  const day = PAST_DAYS.find((entry) => entry.attemptIds.includes(attemptId));
  if (day) return `${day.date}T05:00:00Z`;
  if (PAST_CHANGWON.includes(attemptId)) return "2026-06-24T05:00:00Z";
  // 열린 공고는 기준 시각보다 뒤에 마감한다 — 과거 창 조회에 섞이면 두 관측이 같은 행을 두 번 센다.
  return "2026-09-08T05:00:00Z";
}

function areaOf(attemptId: number): readonly bigint[] {
  if (GIMHAE_ONLY.includes(attemptId)) return [GIMHAE];
  if (PROVINCE_WIDE.includes(attemptId)) return [GYEONGNAM_ALL];
  if (CHANGWON_ONLY.includes(attemptId) || PAST_CHANGWON.includes(attemptId)) return [CHANGWON];
  // 취소된 공고도 도 전체로 열려 있다. 안 걸러지면 `matchedCount`와 `nationwideCount`가 함께 하나씩
  // 늘어나므로 두 숫자가 동시에 이 행을 지킨다.
  if (attemptId === CANCELLED) return [GYEONGNAM_ALL];
  if (pastAttempts.includes(attemptId)) return [GIMHAE];
  return [];
}

const areaLinks = allAttempts
  .flatMap((attemptId) => areaOf(attemptId).map((area) => `(${revisionOf(attemptId)}, ${area}, 'eligibility_area')`))
  .join(",\n         ");

export const regionFilterSeed = `
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value values (41, 'school', '김해 어느 학교');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (${AREA_SCHEME_ID}, 'eat:eligibility-area', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (${GYEONGNAM_ALL}, ${AREA_SCHEME_ID}, '15000'),
         (${GIMHAE}, ${AREA_SCHEME_ID}, '15653'),
         (${CHANGWON}, ${AREA_SCHEME_ID}, '15714'),
         (${GYEONGBUK_ALL}, ${AREA_SCHEME_ID}, '14000');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values ${allAttempts.map((id) => `(${id}, 'eat', 'external-${id}')`).join(",\n         ")};
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values ('${RUN_ID}', 'capture', 'published', '${"a".repeat(64)}', 'eat-v2',
    '2026-09-06T00:00:00Z', '2026-09-06T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values (3167, '${RUN_ID}', 'eat', 'bid-list', '{}', '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${BLOB}', 'raw/eat/bid-list/${BLOB}.xml.gz', 10, 'application/xml', 'gzip',
    '2026-09-06T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values (${OBSERVATION_ID}, '${RUN_ID}', 3167, 'eat', 'bid-list', '{}',
    '2026-09-07T00:30:00Z', 200, '${BLOB}');
  insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
  values (${GYEONGNAM_ALL}, '경남/전체', 'ko', '2026-09-06T00:00:30Z', ${OBSERVATION_ID}),
         (${GIMHAE}, '경남/김해시', 'ko', '2026-09-06T00:00:30Z', ${OBSERVATION_ID}),
         (${CHANGWON}, '경남/창원시', 'ko', '2026-09-06T00:00:30Z', ${OBSERVATION_ID});
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values ${allAttempts
    .map((id) => `(${recordOf(id)}, ${OBSERVATION_ID}, 'auction.v2', 'external-${id}', '{}', 'eat-v2', '2026-09-06T00:00:40Z')`)
    .join(",\n         ")};
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values ${allAttempts
    .map((id) => `(${revisionOf(id)}, ${id}, ${recordOf(id)}, ${OBSERVATION_ID}, '${digest(id)}', null, 'OPEN',
      '급식 식재료 구매', '2026-06-01T00:00:00Z', '${deadlineOf(id)}', null, 1000000.00, null, 'KRW', '{}')`)
    .join(",\n         ")};
  insert into core.auction_revision_code_value (auction_revision_id, code_value_id, role)
  values ${areaLinks};
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('${RELEASE_ID}', 'eat', 'eat-2026-09-07', 'planned', '2026-09-07T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (${BUILD_ID}, 'open_auction_snapshot', '${RELEASE_ID}', 'mart-r3', '${"a".repeat(40)}',
    'eat:auction-location-sigungu', 'building', '2026-09-07T00:00:00Z', '2026-09-07T00:05:00Z');
  insert into mart.open_auction_snapshot
    (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count,
     source_last_changed_at, closes_at, base_amount, currency, item_label, floor_rate,
     region_sido_code_value_id, region_sigungu_code_value_id, organization_label, terms_revision_id,
     source_status_label)
  values ${OPEN_ATTEMPT_IDS
    .map((id) => `(${BUILD_ID}, ${id}, '2026-09-07T00:30:00Z', ${OBSERVATION_ID}, 41, 3, null,
      '2026-09-08T05:00:00Z', 1000000.00, 'KRW', '축산', 90.000, null, null, '김해 어느 학교', ${revisionOf(id)},
      '진행중')`)
    .join(",\n         ")},
         (${BUILD_ID}, ${CANCELLED}, '2026-09-07T00:30:00Z', ${OBSERVATION_ID}, 41, 1, null,
      '2026-09-08T05:00:00Z', 1000000.00, 'KRW', '축산', 90.000, null, null, '김해 어느 학교',
      ${revisionOf(CANCELLED)}, '공고취소');
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z',
    row_count = ${OPEN_ATTEMPT_IDS.length + 1} where build_id = ${BUILD_ID};
  update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z' where build_id = ${BUILD_ID};
`;

export const regionFilterDatabase = disposableDatabase({
  task: "eat167-region-filter",
  migrationApplyCount: 1,
  seed: async (owner) => { await owner.unsafe(regionFilterSeed); },
});
