// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.integration.test.ts`와 같은 관행을 따른다.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import request from "supertest";
import { auctionV1Operations } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  OpenAuctionListing,
  OpenAuctionPage,
  OpenAuctionQuery,
} from "../modules/procurement/application/open-auction-reader";
import { DrizzleOpenAuctionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-open-auction-reader";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";
const taskLabel = "eatbid.task=eat39-open-auctions";

// 시나리오: 201은 오늘 마감(관측 둘), 202는 내일 마감이고 상세가 아직 없음, 203은 기관·마감 미확인,
// 204는 이미 마감, 205는 사흘 뒤 마감. 기관 41의 회차 요약은 개찰 셋(101·102)·미관측(103)·개찰 예정(104)이다.
const NOW = Temporal.Instant.from("2026-09-07T01:00:00Z");

async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

const seed = `
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value
  values (41, 'unknown', null), (43, 'school', '다른 학교');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (11, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
         (12, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (41, 11, '48'), (43, 12, '48120'), (44, 12, '48250');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (101, 'eat', 'external-101'), (102, 'eat', 'external-102'),
         (103, 'eat', 'external-103'), (104, 'eat', 'external-104'),
         (201, 'eat', 'external-201'), (202, 'eat', 'external-202'),
         (203, 'eat', 'external-203'), (204, 'eat', 'external-204'),
         (205, 'eat', 'external-205');
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values
    ('00000000-0000-0000-0000-000000000041', 'capture', 'published', '${"a".repeat(64)}',
     'eat-v2', '2026-09-03T00:00:00Z', '2026-09-03T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values
    (301, '00000000-0000-0000-0000-000000000041', 'eat', 'bid-list', '{}',
     '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${"c".repeat(64)}', 'raw/eat/bid-list/${"c".repeat(64)}.xml.gz', 10,
    'application/xml', 'gzip', '2026-09-03T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values
    (303, '00000000-0000-0000-0000-000000000041', 301, 'eat', 'bid-list', '{}',
     '2026-09-07T00:00:00Z', 200, '${"c".repeat(64)}'),
    (304, '00000000-0000-0000-0000-000000000041', 301, 'eat', 'bid-list', '{}',
     '2026-09-07T00:30:00Z', 200, '${"c".repeat(64)}');
  insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
  values (41, '경상남도', 'ko', '2026-09-03T00:00:30Z', 303),
         (43, '창원시', 'ko', '2026-09-03T00:00:30Z', 303);
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (405, 303, 'auction.v2', 'external-101', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (406, 303, 'auction.v2', 'external-102', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (407, 303, 'auction.v2', 'external-103', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (408, 303, 'auction.v2', 'external-104', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (409, 303, 'auction.v2', 'external-201', '{}', 'eat-v2', '2026-09-03T00:00:40Z'),
         (410, 303, 'auction.v2', 'external-205', '{}', 'eat-v2', '2026-09-03T00:00:40Z');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (505, 101, 405, 303, '${"d".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-01T00:00:00Z', null, '2026-09-03T05:00:00Z', 1000000.00, 990000.00, 'KRW', '{}'),
         (506, 102, 406, 303, '${"e".repeat(64)}', null, 'OPEN', '농산물 구매',
    '2026-09-02T00:00:00Z', null, '2026-09-04T05:00:00Z', 2000000.00, null, 'KRW', '{}'),
         (507, 103, 407, 303, '${"f".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-03T00:00:00Z', null, null, 500000.00, null, 'KRW', '{}'),
         (508, 104, 408, 303, '${"0".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-06T00:00:00Z', null, '2026-09-09T05:00:00Z', 700000.00, null, 'KRW', '{}'),
         (509, 201, 409, 303, '${"1".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-05T00:00:00Z', '2026-09-07T05:00:00Z', '2026-09-07T08:00:00Z', 2761700.00, null, 'KRW', '{}'),
         (510, 205, 410, 303, '${"2".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-05T00:00:00Z', '2026-09-10T05:00:00Z', '2026-09-10T08:00:00Z', 43879200.00, null, 'KRW', '{}');
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000141', 'eat', 'eat-2026-09-07', 'planned',
    '2026-09-07T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (501, 'org_round_summary', '00000000-0000-0000-0000-000000000141', 'mart-r1',
    '${"a".repeat(40)}', null, 'building', '2026-09-07T00:00:00Z', '2026-09-07T00:05:00Z'),
         (601, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000141', 'mart-r2',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-07T00:00:00Z', '2026-09-07T00:05:00Z'),
         (602, 'open_auction_snapshot', '00000000-0000-0000-0000-000000000141', 'mart-r1',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-06T00:00:00Z', '2026-09-06T00:05:00Z');
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id, item_code_value_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst)
  values
    (501, 101, 505, 41, null, '축산', '2026-09-01T00:00:00Z', '2026-09-03T05:00:00Z',
     90.000, null, 1000000.00, 990000.00, 'KRW', 90.309, 90.412,
     891000.00, 89.1000, 89.4059, 5, 0, 0, 1, null, null, 'observed', '2026-09-01'),
    (501, 102, 506, 41, null, '농산', '2026-09-02T00:00:00Z', '2026-09-04T05:00:00Z',
     90.000, null, 2000000.00, 1980000.00, 'KRW', null, null,
     1782000.00, 88.0350, null, 17, 2, null, null, null, null, 'unknown', '2026-09-01'),
    (501, 103, 507, 41, null, '축산', '2026-09-03T00:00:00Z', null,
     90.000, null, 500000.00, null, 'KRW', null, null, null, null, null,
     9, 1, null, null, null, null, 'unknown', null),
    (501, 104, 508, 41, null, '축산', '2026-09-06T00:00:00Z', '2026-09-09T05:00:00Z',
     90.000, null, 700000.00, null, 'KRW', null, null, null, null, null,
     null, null, null, null, null, null, 'unknown', '2026-09-01');
  insert into mart.open_auction_snapshot
    (build_id, auction_attempt_id, observed_at, observation_id, organization_id, bid_count,
     source_last_changed_at, closes_at, base_amount, currency, item_label, floor_rate,
     region_sido_code_value_id, region_sigungu_code_value_id, organization_label, terms_revision_id)
  values
    (601, 201, '2026-09-07T00:00:00Z', 303, 41, 3, '2026-09-06T23:00:00Z', '2026-09-07T05:00:00Z',
     2761700.00, 'KRW', '축산', 90.000, 41, 43, '창원 남산초등학교', 509),
    (601, 201, '2026-09-07T00:30:00Z', 304, 41, 5, '2026-09-07T00:10:00Z', '2026-09-07T05:00:00Z',
     2761700.00, 'KRW', '축산', 90.000, 41, 43, '창원 남산초등학교', 509),
    (601, 202, '2026-09-07T00:30:00Z', 304, 43, 0, null, '2026-09-08T05:00:00Z',
     10000000.00, 'KRW', null, null, null, null, '다른 학교', null),
    (601, 203, '2026-09-07T00:30:00Z', 304, null, null, null, null,
     500000.00, 'KRW', null, null, null, null, null, null),
    (601, 204, '2026-09-07T00:30:00Z', 304, 41, 7, null, '2026-09-06T05:00:00Z',
     900000.00, 'KRW', '축산', 90.000, 41, 43, '창원 남산초등학교', 509),
    (601, 205, '2026-09-07T00:30:00Z', 304, 41, 2, null, '2026-09-10T05:00:00Z',
     43879200.00, 'KRW', '축산', 88.000, 41, 44, '창원 남산초등학교', 510),
    -- 물린 build의 행은 목록에 나오면 안 된다.
    (602, 202, '2026-09-06T00:30:00Z', 303, 43, 0, null, '2026-09-08T05:00:00Z',
     10000000.00, 'KRW', null, null, null, null, '다른 학교', null);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (501, null, '2026-09-01', 10, 10, 10, 0, 'unknown'),
         (601, null, '2026-09-01', 10, 10, 10, 0, 'partial');
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z', row_count = 4 where build_id = 501;
  update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z' where build_id = 501;
  update mart.build set status = 'verified', computed_at = '2026-09-06T00:10:00Z', row_count = 1 where build_id = 602;
  update mart.build set status = 'active', activated_at = '2026-09-06T00:11:00Z' where build_id = 602;
  update mart.build set status = 'superseded', superseded_at = '2026-09-07T00:11:00Z' where build_id = 602;
  update mart.build set status = 'verified', computed_at = '2026-09-07T00:10:00Z', row_count = 6 where build_id = 601;
  update mart.build set status = 'active', activated_at = '2026-09-07T00:11:00Z' where build_id = 601;
`;

async function withSeededDatabase(
  work: (context: { readonly url: string; readonly client: ReturnType<typeof postgres> }) => Promise<void>,
): Promise<void> {
  const name = `eatbid-eat39-${process.pid}-${Date.now()}`;
  let client: ReturnType<typeof postgres> | undefined;
  await docker(
    "run", "--detach", "--rm",
    "--name", name,
    "--label", taskLabel,
    "--env", "POSTGRES_USER=eatbid_owner",
    "--env", "POSTGRES_PASSWORD=owner-test-secret",
    "--env", "POSTGRES_DB=eatbid_test",
    "--publish", "127.0.0.1::5432",
    postgresImage,
  );
  try {
    const port = (await docker("port", name, "5432/tcp")).split(":").at(-1);
    const url = `postgres://eatbid_owner:owner-test-secret@127.0.0.1:${port}/eatbid_test`;
    client = postgres(url, { max: 4, connect_timeout: 2 });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await client`select 1`;
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    await client`select 1`;
    const failure = await migrate(drizzle({ client }), { migrationsFolder: migrationFolder });
    if (failure) throw new Error(`Migration apply failed with ${failure.exitCode}`);
    await client.unsafe(seed);
    await work({ url, client });
  } finally {
    if (client) await client.end({ timeout: 1 }).catch(() => undefined);
    await docker("rm", "--force", name).catch(() => undefined);
  }
}

function pageOf(listing: OpenAuctionListing): OpenAuctionPage {
  if (listing.kind !== "page") throw new Error(`expected a page but got ${listing.kind}`);
  return listing.page;
}

const baseQuery: OpenAuctionQuery = {
  asOf: NOW,
  regionCodeValueId: null,
  itemLabel: null,
  closesWithinHours: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null,
  limit: 50,
};

const ids = (page: OpenAuctionPage) => page.auctions.map((auction) => auction.auctionAttemptId);

describe("mart 열린 공고 목록 PostgreSQL 경계", () => {
  test("마감 임박 정렬·최신 관측 선택·필터·keyset 페이지·기관 요약이 실제 mart 행에서 맞는다", async () => {
    await withSeededDatabase(async ({ url, client }) => {
      const reader = new DrizzleOpenAuctionReader(drizzle({ client }));

      // 마감 임박 순이며 마감 미확인(203)은 맨 뒤, 이미 마감된 204와 물린 build의 행은 없다.
      const all = pageOf(await reader.listOpen(baseQuery));
      expect(ids(all)).toEqual([201n, 202n, 205n, 203n]);
      expect(all.sampleCount).toBe(4);
      expect(all.nextCursor).toBeNull();
      // 한 build 안 같은 공고의 관측이 여럿이면 가장 최근 관측 하나만 목록에 낸다.
      expect(all.auctions[0]).toMatchObject({
        bidCount: 5,
        floorRate: "90.000",
        itemLabel: "축산",
        termsRevisionId: 509n,
        organization: { organizationId: 41n, label: "창원 남산초등학교", type: "unknown" },
        region: {
          sido: { codeValueId: 41n, code: "48", scheme: "eat:auction-location-sido", label: "경상남도" },
          sigungu: { codeValueId: 43n, code: "48120", scheme: "eat:auction-location-sigungu", label: "창원시" },
        },
      });
      expect(all.auctions[0]!.observedAt.toString()).toBe("2026-09-07T00:30:00Z");
      // 기관 41의 요약: 회차 4, 명단 표본 [5, 17, 9] 중앙값 9, 최근 개찰 회차는 102(개찰 예정 104는 아직 아니다).
      expect(all.auctions[0]!.orgSummary).toMatchObject({
        attemptCount: 4,
        medianListCount: 9,
        listCountSampleCount: 3,
        lastRound: {
          auctionAttemptId: 102n,
          awardedBidRate: null,
          dayFloorBidRate: "88.0350",
          listCount: 17,
          belowDayFloorCount: 2,
        },
      });
      expect(all.auctions[0]!.orgSummary!.lastRound!.openedAt.toString()).toBe("2026-09-04T05:00:00Z");
      // 상세가 없는 202는 파생 열이 전부 null이고, 회차 요약이 없는 기관 43은 요약이 null이다.
      expect(all.auctions[1]).toMatchObject({
        organization: { organizationId: 43n, label: "다른 학교", type: "school" },
        itemLabel: null,
        floorRate: null,
        region: null,
        termsRevisionId: null,
        orgSummary: null,
      });
      // 라벨이 관측되지 않은 시군구 코드는 참조는 살고 라벨만 null이다.
      expect(all.auctions[2]!.region!.sigungu).toEqual({
        codeValueId: 44n, code: "48250", scheme: "eat:auction-location-sigungu", label: null,
      });
      expect(all.auctions[3]).toMatchObject({ organization: null, closesAt: null, orgSummary: null });
      expect(all.snapshotLineage).toMatchObject({ buildId: 601n, calcVersion: "mart-r2", coverage: "partial" });
      expect(all.orgSummaryLineage).toMatchObject({ buildId: 501n, calcVersion: "mart-r1", coverage: "unknown" });

      // 기간 필터는 마감 미확인 행을 제외한다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, closesWithinHours: 24 })))).toEqual([201n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, closesWithinHours: 72 })))).toEqual([201n, 202n]);
      // 기초금액 경계는 양끝을 포함한다.
      const upTo = pageOf(await reader.listOpen({ ...baseQuery, baseAmountMax: "2761700.00" }));
      expect(ids(upTo)).toEqual([201n, 203n]);
      expect(upTo.sampleCount).toBe(2);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, baseAmountMin: "3000000.00" })))).toEqual([202n, 205n]);
      // 지역은 시도·시군구 어느 축이든 그 id를 가진 행이다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, regionCodeValueId: 41n })))).toEqual([201n, 205n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, regionCodeValueId: 43n })))).toEqual([201n]);
      // 품목은 라벨 완전일치다.
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, itemLabel: "축산" })))).toEqual([201n, 205n]);
      expect(ids(pageOf(await reader.listOpen({ ...baseQuery, itemLabel: "축" })))).toEqual([]);

      // cursor 페이지 둘을 이어 붙여도 순서와 중복이 없고 표본 수는 cursor 위치와 무관하다.
      const first = pageOf(await reader.listOpen({ ...baseQuery, limit: 2 }));
      expect(ids(first)).toEqual([201n, 202n]);
      expect(first.nextCursor).toBe(202n);
      expect(first.sampleCount).toBe(4);
      const second = pageOf(await reader.listOpen({ ...baseQuery, limit: 2, cursor: first.nextCursor }));
      expect(ids(second)).toEqual([205n, 203n]);
      expect(second.nextCursor).toBeNull();
      expect(second.sampleCount).toBe(4);
      // 마감된 공고와 없는 공고를 가리키는 cursor는 빈 페이지가 아니라 명시적 실패다.
      expect(await reader.listOpen({ ...baseQuery, cursor: 204n })).toEqual({ kind: "cursor-not-found", cursor: 204n });
      expect(await reader.listOpen({ ...baseQuery, cursor: 9_007_199_254_740_993n }))
        .toEqual({ kind: "cursor-not-found", cursor: 9_007_199_254_740_993n });

      const runtime = await createApp({
        environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: url }),
        logWriter: () => undefined,
        clock: fixedClock(NOW),
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        const response = await request(server).get(
          auctionV1Operations.listOpen.buildPath({ path: {}, query: { limit: 1, item: "축산" } }),
        );
        expect(response.status).toBe(200);
        expect(response.body.auctions.map((auction: { auctionAttemptId: string }) => auction.auctionAttemptId)).toEqual(["201"]);
        expect(response.body.nextCursor).toBe("201");
        expect(response.body.meta).toEqual({
          sampleCount: 2,
          asOf: "2026-09-07T01:00:00Z",
          region: null,
          item: "축산",
          closesWithinHours: null,
          baseAmountMin: null,
          baseAmountMax: null,
          openAuctionSnapshotBuild: {
            buildId: "601",
            sourceReleaseId: "00000000-0000-0000-0000-000000000141",
            calcVersion: "mart-r2",
            computedAt: "2026-09-07T00:10:00Z",
            coverage: "partial",
            regionScheme: "eat:auction-location-sigungu",
          },
          orgRoundSummaryBuild: {
            buildId: "501",
            sourceReleaseId: "00000000-0000-0000-0000-000000000141",
            calcVersion: "mart-r1",
            computedAt: "2026-09-07T00:10:00Z",
            coverage: "unknown",
            regionScheme: null,
          },
        });
        const staleCursor = await request(server).get(
          auctionV1Operations.listOpen.buildPath({ path: {}, query: { cursor: "204" } }),
        );
        expect(staleCursor.status).toBe(400);
        expect(staleCursor.body.code).toBe("VALIDATION_ERROR");
      } finally {
        await runtime.shutdown();
      }
    });
    expect(await docker("ps", "-a", "--filter", `label=${taskLabel}`, "--format", "{{.Names}}")).toBe("");
  }, 180_000);
});
