/** @module 책임: 기관 회차 통합 테스트의 격리 PostgreSQL 수명주기와 활성화 전 fixture 준비를 소유한다. */
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";
export const taskLabel = "eatbid.task=eat37-org-attempts";

export async function docker(...args: string[]): Promise<string> {
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
  values (41, 'school', '창원 남산초등학교'), (43, 'school', '다른 학교');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (11, 'eatbid:auction-item', 'eatbid', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (7, 11, '육류'), (9, 11, '농산물');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (101, 'eat', 'external-101'), (102, 'eat', 'external-102'),
         (103, 'eat', 'external-103'), (104, 'eat', 'external-104'),
         (105, 'eat', 'external-105');
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values
    ('00000000-0000-0000-0000-000000000041', 'capture', 'published', '${"a".repeat(64)}',
     'eat-v1', '2026-09-03T00:00:00Z', '2026-09-03T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values
    (201, '00000000-0000-0000-0000-000000000041', 'eat', '/auction', '{}',
     '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${"c".repeat(64)}', 'raw/eat/auction/${"c".repeat(64)}.xml.gz', 10,
    'application/xml', 'gzip', '2026-09-03T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values
    (203, '00000000-0000-0000-0000-000000000041', 201, 'eat', '/auction', '{}',
     '2026-09-03T00:00:30Z', 200, '${"c".repeat(64)}');
  insert into ingest.normalized_record
    (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
     parser_version, normalized_at)
  overriding system value
  values (205, 203, 'auction.v1', 'external-103', '{}', 'eat-v1', '2026-09-03T00:00:40Z'),
         (206, 203, 'auction.v1', 'external-102', '{}', 'eat-v1', '2026-09-03T00:00:40Z'),
         (209, 203, 'auction.v1', 'external-101', '{}', 'eat-v1', '2026-09-03T00:00:40Z'),
         (210, 203, 'auction.v1', 'external-104', '{}', 'eat-v1', '2026-09-03T00:00:40Z'),
         (213, 203, 'auction.v1', 'external-105', '{}', 'eat-v1', '2026-09-03T00:00:40Z');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (207, 103, 205, 203, '${"d".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-03T00:00:00Z', null, null, 2761700.00, null, 'KRW', '{}'),
         (208, 102, 206, 203, '${"e".repeat(64)}', null, 'OPEN', '농산물 구매',
    '2026-09-02T00:00:00Z', null, '2026-09-04T05:00:00Z', 1000000.00, null, 'KRW', '{}'),
         (211, 101, 209, 203, '${"f".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-01T00:00:00Z', null, '2026-09-03T05:00:00Z', 500000.00, null, 'KRW', '{}'),
         (212, 104, 210, 203, '${"0".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-05T00:00:00Z', null, null, 900000.00, null, 'KRW', '{}'),
         (214, 105, 213, 203, '${"1".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-06T00:00:00Z', null, '2026-09-09T05:00:00Z', 700000.00, null, 'KRW', '{}');
  insert into core.auction_organization (auction_revision_id, organization_id, role)
  values (207, 41, 'purchaser'), (207, 43, 'supplier-contact');
  insert into core.supplier_party (supplier_party_id, type, canonical_name)
  overriding system value
  values (77, 'company', '어떤 업체');
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000141', 'eat', 'eat-2026-09-04', 'planned',
    '2026-09-04T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (501, 'org_round_summary', '00000000-0000-0000-0000-000000000141', 'mart-r1',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-04T00:00:00Z', '2026-09-04T00:05:00Z');
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst)
  values
    (501, 103, 207, 41, '축산', '2026-09-03T00:00:00Z', null,
     90.000, null, 2761700.00, null, 'KRW', null, null, null, null, null,
     17, 2, null, null, null, null, 'unknown', null),
    (501, 102, 208, 41, '농산', '2026-09-02T00:00:00Z', '2026-09-04T05:00:00Z',
     90.000, null, 1000000.00, 990000.00, 'KRW', 90.309, 90.412,
     891000.00, 89.1000, 89.4059, 5, 0, 0, 1, 77, null, 'observed', '2026-09-01'),
    (501, 101, 211, 41, null, '2026-09-01T00:00:00Z', '2026-09-03T05:00:00Z',
     null, null, 500000.00, null, 'KRW', 91.000, null, null, null, null,
     null, null, null, null, null, null, 'unknown', '2026-09-01'),
    (501, 104, 212, 43, '축산', '2026-09-05T00:00:00Z', null,
     90.000, null, 900000.00, null, 'KRW', null, null, null, null, null,
     null, null, null, null, null, null, 'unknown', null),
    (501, 105, 214, 41, '축산', '2026-09-06T00:00:00Z', '2026-09-09T05:00:00Z',
     90.000, null, 700000.00, null, 'KRW', null, null, null, null, null,
     null, null, null, null, null, null, 'unknown', '2026-09-01');
  -- 품목은 열이 아니라 다리표다. 라벨 없는 101은 다리 행도 없다(EAT-256).
  insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
  values (501, 103, 7), (501, 102, 9), (501, 104, 7), (501, 105, 7);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (501, null, '2026-08-01', 10, 10, 10, 0, 'complete'),
         (501, null, '2026-09-01', 10, 10, 10, 0, 'unknown');
`;


export async function withSeededDatabase(
  work: (context: { readonly url: string; readonly client: ReturnType<typeof postgres> }) => Promise<void>,
  beforeActivation?: (client: ReturnType<typeof postgres>) => Promise<void>,
): Promise<void> {
  const name = `eatbid-eat37-${process.pid}-${Date.now()}`;
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
    await beforeActivation?.(client);
    await client.unsafe(`
  update mart.build
     set status = 'verified', computed_at = '2026-09-04T00:10:00Z', row_count = 5
   where build_id = 501;
  update mart.build
     set status = 'active', activated_at = '2026-09-04T00:11:00Z'
   where build_id = 501;
`);
    await work({ url, client });
  } finally {
    if (client) await client.end({ timeout: 1 }).catch(() => undefined);
    await docker("rm", "--force", name).catch(() => undefined);
  }
}

