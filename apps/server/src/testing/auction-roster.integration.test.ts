// docker PostgreSQL이 필요한 통합 테스트이며 `database.integration.test.ts`와 같은 harness·관행을 따른다.
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { DrizzleAuctionRosterReader } from "../modules/procurement/infrastructure/drizzle/drizzle-auction-roster-reader";
import { auctionId } from "../modules/procurement/domain/auction-id";
import { disposableDatabase } from "../../fixtures/disposable-database.fixture";

// raw `fetched_at`이 그대로 code label 증거의 `observed_at`이 되는 발행 경로를 fixture가 재현한다.
// API 역할은 `ingest`를 읽지 못하므로 이 값이 core로 투영돼 있는지가 명단 조회 성공의 조건이다.
const REVISION_9002_OBSERVED_AT = "2026-09-05T03:04:05.123456Z";
const REVISION_9003_OBSERVED_AT = "2026-09-06T07:08:09.654321Z";
const EMPTY_ROSTER_OBSERVED_AT = "2026-09-04T11:22:33.000001Z";
// 같은 관측에 매달렸지만 소유 체계가 다른 라벨이다. 섞이면 관측 시각이 둘이 되어 조회가 실패해야 한다.
const UNRELATED_SCHEME_OBSERVED_AT = "2026-09-05T09:09:09Z";

const seed = `
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values ('00000000-0000-0000-0000-000000000114', 'capture', 'published', '${"a".repeat(64)}',
     'eat-v3', '2026-09-06T00:00:00Z', '2026-09-06T00:01:00Z', null, 6, 6, 6);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values (1141, '00000000-0000-0000-0000-000000000114', 'eat', '/bid-detail', '{}',
     '${"b".repeat(64)}', 6, 6, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${"c".repeat(64)}', 'raw/eat/bid-detail/${"c".repeat(64)}.xml.gz', 10,
     'application/xml', 'gzip', '2026-09-06T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values (6001, '00000000-0000-0000-0000-000000000114', 1141, 'eat', '/bid-detail', '{}',
     '2026-08-01T00:00:00Z', 200, '${"c".repeat(64)}'),
    (6002, '00000000-0000-0000-0000-000000000114', 1141, 'eat', '/bid-detail', '{}',
     '${REVISION_9002_OBSERVED_AT}', 200, '${"c".repeat(64)}'),
    (6003, '00000000-0000-0000-0000-000000000114', 1141, 'eat', '/bid-detail', '{}',
     '${REVISION_9003_OBSERVED_AT}', 200, '${"c".repeat(64)}'),
    (6004, '00000000-0000-0000-0000-000000000114', 1141, 'eat', '/bid-detail', '{}',
     '${EMPTY_ROSTER_OBSERVED_AT}', 200, '${"c".repeat(64)}'),
    (6005, '00000000-0000-0000-0000-000000000114', 1141, 'eat', '/bid-detail', '{}',
     '2026-09-03T00:00:00Z', 200, '${"c".repeat(64)}'),
    (6006, '00000000-0000-0000-0000-000000000114', 1141, 'eat', '/bid-detail', '{}',
     '2026-09-02T00:00:00Z', 200, '${"c".repeat(64)}');
  -- 같은 관측을 새 parser가 다시 해석하면 별도 normalized record이고 별도 revision이다(ADR 0015).
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (5001, 6002, 'auction.v2', 'external-8001', '{}', 'eat-v2', '2026-09-06T00:01:00Z'),
    (5002, 6002, 'auction.v2', 'external-8001', '{}', 'eat-v3', '2026-09-06T00:01:00Z'),
    (5003, 6003, 'auction.v2', 'external-8001', '{}', 'eat-v3', '2026-09-06T00:01:00Z'),
    (5004, 6004, 'auction.v2', 'external-8002', '{}', 'eat-v3', '2026-09-06T00:01:00Z'),
    (5005, 6005, 'auction.v2', 'external-8003', '{}', 'eat-v3', '2026-09-06T00:01:00Z'),
    (5006, 6006, 'auction.v2', 'external-8004', '{}', 'eat-v3', '2026-09-06T00:01:00Z');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (7100, 'eat:organization', 'aT', 'source-managed', 'effective-dated'),
    (7200, 'eat:bid-status', 'aT', 'source-managed', 'effective-dated'),
    (7300, 'eat:supplier-account', 'aT', 'source-managed', 'effective-dated'),
    (7400, 'neis:school', 'Korea Education and Research Information Service',
     'source-managed', 'effective-dated');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (7101, 7100, 'PURR-8001'), (7102, 7100, 'PURR-8002'),
    (7103, 7100, 'PURR-8003'), (7104, 7100, 'PURR-8004'),
    (7201, 7200, '005'), (7202, 7200, '002'),
    (7301, 7300, 'SHIPPER-1'), (7302, 7300, 'SHIPPER-2'),
    (7401, 7400, 'NEIS-8001');
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value
  values (9101, 'unknown', null), (9102, 'unknown', null),
    (9103, 'unknown', null), (9104, 'unknown', null);
  -- 기관 정체성은 최초 관측(6001)에 매달리고 회차마다 다시 쓰지 않는다. 명단의 관측 시각을 여기서
  -- 읽으면 모든 회차가 2026-08-01이 된다. 기관 9101은 다른 소유 체계의 식별자도 함께 갖는다.
  insert into core.organization_identifier (organization_id, code_value_id, observation_id)
  values (9101, 7101, 6001), (9101, 7401, 6001),
    (9102, 7102, 6004), (9103, 7103, 6005), (9104, 7104, 6006);
  insert into core.code_label_observation
    (code_value_id, label, language, observed_at, observation_id)
  values (7101, '옛 이름 초등학교', 'und', '2026-08-01T00:00:00Z', 6001),
    (7101, '현재 이름 초등학교', 'und', '${REVISION_9002_OBSERVED_AT}', 6002),
    (7101, '바뀐 이름 초등학교', 'und', '${REVISION_9003_OBSERVED_AT}', 6003),
    (7401, '학교 코드 라벨', 'und', '${UNRELATED_SCHEME_OBSERVED_AT}', 6002),
    (7102, '빈 명단 기관', 'und', '${EMPTY_ROSTER_OBSERVED_AT}', 6004),
    (7104, '모순 관측 기관 가', 'und', '2026-09-02T00:00:00Z', 6006),
    (7104, '모순 관측 기관 나', 'und', '2026-09-02T00:00:01Z', 6006),
    (7301, '가 업체', 'und', '${REVISION_9002_OBSERVED_AT}', 6002),
    (7302, '나 업체', 'und', '${REVISION_9002_OBSERVED_AT}', 6002),
    (7301, '가 업체', 'und', '${REVISION_9003_OBSERVED_AT}', 6003),
    (7302, '나 업체', 'und', '${REVISION_9003_OBSERVED_AT}', 6003),
    (7201, '낙찰실패', 'und', '${REVISION_9003_OBSERVED_AT}', 6003),
    (7202, '낙찰', 'und', '${REVISION_9003_OBSERVED_AT}', 6003);
  insert into core.supplier_party (supplier_party_id, type, canonical_name)
  overriding system value
  values (7701, 'company', null), (7702, 'company', null);
  insert into core.source_supplier_account
    (source_supplier_account_id, supplier_party_id, source_system, account_code_value_id, observation_id)
  overriding system value
  values (7801, 7701, 'eat', 7301, 6002), (7802, 7702, 'eat', 7302, 6002);
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (8001, 'eat', 'external-8001'), (8002, 'eat', 'external-8002'),
    (8003, 'eat', 'external-8003'), (8004, 'eat', 'external-8004');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (9001, 8001, 5001, 6002, '${"d".repeat(64)}', null, 'OPEN', '농산물 구매',
     '2026-09-01T00:00:00Z', null, '2026-09-05T05:00:00Z', 1000000.00, 990000.00, 'KRW',
     '{"roster":{"submissions":[{},{}],"sourceRosterSize":2}}'),
    (9002, 8001, 5002, 6002, '${"e".repeat(64)}', null, 'OPEN', '농산물 구매',
     '2026-09-01T00:00:00Z', null, '2026-09-05T05:00:00Z', 1000000.00, 990000.00, 'KRW',
     '{"roster":{"submissions":[{},{}],"sourceRosterSize":2}}'),
    (9003, 8001, 5003, 6003, '${"f".repeat(64)}', null, 'CLOSED', '농산물 구매',
     '2026-09-01T00:00:00Z', null, '2026-09-05T05:00:00Z', 1000000.00, 990000.00, 'KRW',
     '{"roster":{"submissions":[{},{}],"sourceRosterSize":2}}'),
    (9004, 8002, 5004, 6004, '${"0".repeat(64)}', null, 'OPEN', '명단 미관측 공고',
     '2026-09-01T00:00:00Z', null, null, 500000.00, null, 'KRW', '{}'),
    (9005, 8003, 5005, 6005, '${"1".repeat(64)}', null, 'OPEN', '라벨 없는 기관 공고',
     '2026-09-01T00:00:00Z', null, null, 500000.00, null, 'KRW', '{}'),
    (9006, 8004, 5006, 6006, '${"2".repeat(64)}', null, 'OPEN', '모순 관측 공고',
     '2026-09-01T00:00:00Z', null, null, 500000.00, null, 'KRW', '{}');
  insert into core.auction_organization (auction_revision_id, organization_id, role)
  values (9001, 9101, 'purchaser'), (9002, 9101, 'purchaser'), (9003, 9101, 'purchaser'),
    (9004, 9102, 'purchaser'), (9005, 9103, 'purchaser'), (9006, 9104, 'purchaser');
  insert into core.bid_submission
    (auction_revision_id, auction_attempt_id, opened_at, roster_ordinal,
     source_supplier_account_id, supplier_party_id, submitted_at, amount, effective_amount,
     currency, bid_rate, rank, source_status_code_value_id, observation_id)
  values (9001, 8001, '2026-09-05T05:00:00Z', 0, 7801, 7701, null,
     10000000043768.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6002),
    (9001, 8001, '2026-09-05T05:00:00Z', 1, 7802, 7702, null,
     10000000043769.00, 43120181.00, 'KRW', 89.002, 2, 7201, 6002),
    (9002, 8001, '2026-09-05T05:00:00Z', 0, 7801, 7701, null,
     10000000043768.00, 43120180.00, 'KRW', 89.001, 1, 7201, 6002),
    (9002, 8001, '2026-09-05T05:00:00Z', 1, 7802, 7702, null,
     10000000043769.00, 43120181.00, 'KRW', 89.002, 2, 7201, 6002),
    (9003, 8001, '2026-09-05T05:00:00Z', 0, 7801, 7701, null,
     10000000043768.00, 43120180.00, 'KRW', 89.001, 1, 7202, 6003),
    (9003, 8001, '2026-09-05T05:00:00Z', 1, 7802, 7702, null,
     10000000043769.00, 43120181.00, 'KRW', 89.002, 2, 7201, 6003);
  insert into core.award_decision
    (auction_revision_id, auction_attempt_id, awarded_roster_ordinal, source_supplier_account_id,
     supplier_party_id, awarded_at, awarded_amount, currency, awarded_rate, runner_up_rate,
     source_status_code_value_id, observation_id)
  values (9003, 8001, 0, 7801, 7701, '2026-09-05T00:00:00Z', 43120180.00, 'KRW',
     89.001, 89.002, 7202, 6003);
`;

const { withDatabase, expectOwnedContainersCleanedUp } = disposableDatabase({
  task: "eat114-roster-provenance",
  migrationApplyCount: 1,
  seed: async (owner) => { await owner.unsafe(seed); },
});

describe("실제 API 역할의 회차 명단 관측 시각", () => {
  test("ingest 접근 없이 선택 revision의 구매기관 라벨 관측 시각을 마이크로초까지 읽는다", async () => {
    await withDatabase(async ({ owner, api }) => {
      const reader = new DrizzleAuctionRosterReader(drizzle({ client: api }));

      // 최신 revision은 그 해석의 관측 시각을 쓴다. 기관 정체성이 매달린 최초 관측(2026-08-01)이 아니다.
      const latest = await reader.find({ auctionId: auctionId(8001n), revisionId: null });
      expect(latest?.revisionId).toBe(9003n);
      expect(latest?.rows).toHaveLength(2);
      expect(latest?.observedAt.toString()).toBe(REVISION_9003_OBSERVED_AT);
      expect(latest?.award?.rosterOrdinal).toBe(0);
      expect(latest?.rows.map((row) => row.supplierName)).toEqual(["가 업체", "나 업체"]);

      // 지정한 revision은 그 revision의 관측으로 되돌아간다. 기관명이 바뀐 뒤에도 과거를 덮지 않는다.
      const pinned = await reader.find({ auctionId: auctionId(8001n), revisionId: 9001n });
      expect(pinned?.revisionId).toBe(9001n);
      expect(pinned?.observedAt.toString()).toBe(REVISION_9002_OBSERVED_AT);

      // 같은 관측을 새 parser가 다시 해석한 revision도 원본 관측 시각은 같다.
      const reinterpreted = await reader.find({ auctionId: auctionId(8001n), revisionId: 9002n });
      expect(reinterpreted?.revisionId).toBe(9002n);
      expect(reinterpreted?.observedAt.toString()).toBe(REVISION_9002_OBSERVED_AT);
      // 다른 소유 체계의 라벨이 섞였다면 관측 시각이 둘이 되어 위 조회가 실패했을 값이다.
      expect(reinterpreted?.observedAt.toString()).not.toBe(UNRELATED_SCHEME_OBSERVED_AT);

      // 명단이 관측되지 않은 회차도 증거가 있으면 조회에 성공한다.
      const notObserved = await reader.find({ auctionId: auctionId(8002n), revisionId: null });
      expect(notObserved?.rows).toEqual([]);
      expect(notObserved?.observedAt.toString()).toBe(EMPTY_ROSTER_OBSERVED_AT);

      // 공개한 시각이 보존된 raw 관측과 정확히 같은 값인지는 owner만 확인할 수 있다.
      expect(await owner`
        select to_char(fetched_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as fetched_at
        from ingest.raw_observation where observation_id in (6002, 6003, 6004)
        order by observation_id
      `).toEqual([
        { fetched_at: REVISION_9002_OBSERVED_AT },
        { fetched_at: REVISION_9003_OBSERVED_AT },
        { fetched_at: EMPTY_ROSTER_OBSERVED_AT },
      ]);

      // 같은 연결에서 ingest 직접 조회는 계속 거절된다. 명단 성공이 권한을 넓혀 얻은 결과가 아니다.
      let denied: unknown;
      try {
        await api`select observation_id from ingest.raw_observation limit 1`;
      } catch (error) {
        denied = error;
      }
      expect((denied as { code?: string } | undefined)?.code).toBe("42501");
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);

  test("관측 시각 증거가 없거나 하나로 모이지 않으면 없는 공고가 아니라 결함으로 낸다", async () => {
    await withDatabase(async ({ apiUrl }) => {
      const runtime = await createApp({
        environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: apiUrl }),
        logWriter: () => undefined,
      });
      const server = await runtime.listen(0, "127.0.0.1");
      const rosterPath = (attempt: string) =>
        auctionV1Operations.roster.buildPath({ path: { auctionId: attempt }, query: {} });
      try {
        const observed = await request(server).get(rosterPath("8001"));
        expect(observed.status).toBe(200);
        expect(observed.body.revisionId).toBe("9003");
        expect(observed.body.meta).toMatchObject({ rowCount: 2, sourceRosterSize: 2 });
        expect(observed.body.meta.observedAt).toBe(REVISION_9003_OBSERVED_AT);

        // 라벨 관측이 없는 회차와 한 관측에 시각이 둘인 회차는 404도 503도 아니다.
        expect((await request(server).get(rosterPath("8003"))).status).toBe(500);
        expect((await request(server).get(rosterPath("8004"))).status).toBe(500);
        expect((await request(server).get(rosterPath("8999"))).status).toBe(404);
      } finally {
        await runtime.shutdown();
      }
    });
    await expectOwnedContainersCleanedUp();
  }, 180_000);
});
