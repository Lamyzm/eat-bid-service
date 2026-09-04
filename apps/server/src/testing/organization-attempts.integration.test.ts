// docker PostgreSQL이 필요한 통합 테스트이며 `database.integration.test.ts`와 같은 관행을 따른다.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import request from "supertest";
import { auctionV1Operations, organizationV1Operations } from "@eatbid/contracts";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  OrganizationAttemptListing,
  OrganizationAttemptPage,
} from "../modules/procurement/application/organization-attempt-reader";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { DrizzleOrganizationAttemptReader } from "../modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";
const taskLabel = "eatbid.task=eat37-org-attempts";

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
  values (41, 'school', '창원 남산초등학교'), (43, 'school', '다른 학교');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (11, 'eat.item', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (7, 11, 'livestock'), (9, 11, 'produce');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  values (101, 'eat', 'external-101'), (102, 'eat', 'external-102'),
         (103, 'eat', 'external-103'), (104, 'eat', 'external-104');
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
  values (205, 203, 'auction.v1', 'external-103', '{}', 'eat-v1', '2026-09-03T00:00:40Z');
  insert into core.auction_revision
    (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
     content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
     opened_at, base_amount, planned_amount, currency, source_payload)
  overriding system value
  values (207, 103, 205, 203, '${"d".repeat(64)}', null, 'OPEN', '축산물 구매',
    '2026-09-03T00:00:00Z', null, null, 2761700.00, null, 'KRW', '{}');
  insert into core.auction_organization (auction_revision_id, organization_id, role)
  values (207, 41, 'purchaser'), (207, 43, 'supplier-contact');
  insert into mart.org_round_summary
    (auction_attempt_id, organization_id, item_code_value_id, item_label, announced_at, opened_at,
     floor_rate, base_amount, currency, win_rate, second_rate, day_floor_rate,
     list_count, invalid_count, winner_supplier_party_id, supersedes_attempt_id,
     mart_release, computed_at, calc_version)
  values
    (103, 41, 7, '축산', '2026-09-03T00:00:00Z', null,
     90.000, 2761700.00, 'KRW', null, null, null, 17, 2, null, null,
     '2026-09-04T00', '2026-09-04T00:10:00Z', 'v1'),
    (102, 41, 9, '농산', '2026-09-02T00:00:00Z', '2026-09-04T05:00:00Z',
     90.000, 1000000.00, 'KRW', 90.309, 90.412, 88.500, 5, 0, 77, null,
     '2026-09-04T00', '2026-09-04T00:10:00Z', 'v1'),
    (101, 41, 7, null, '2026-09-01T00:00:00Z', '2026-09-03T05:00:00Z',
     null, 500000.00, 'KRW', 91.000, null, null, null, null, null, null,
     '2026-09-03T00', '2026-09-03T00:10:00Z', 'v1'),
    (104, 43, 7, '축산', '2026-09-05T00:00:00Z', null,
     90.000, 900000.00, 'KRW', null, null, null, null, null, null, null,
     '2026-09-04T00', '2026-09-04T00:10:00Z', 'v1');
`;

async function withSeededDatabase(
  work: (context: { readonly url: string; readonly client: ReturnType<typeof postgres> }) => Promise<void>,
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
    await work({ url, client });
  } finally {
    if (client) await client.end({ timeout: 1 }).catch(() => undefined);
    await docker("rm", "--force", name).catch(() => undefined);
  }
}

function pageOf(listing: OrganizationAttemptListing): OrganizationAttemptPage {
  if (listing.kind !== "page") throw new Error(`expected a page but got ${listing.kind}`);
  return listing.page;
}

describe("mart 기관 회차 이력 PostgreSQL 경계", () => {
  test("keyset 페이징과 품목 필터가 실제 mart 행에서 표본 수와 순서를 보존한다", async () => {
    await withSeededDatabase(async ({ url, client }) => {
      const reader = new DrizzleOrganizationAttemptReader(drizzle({ client }));
      expect(await reader.exists(organizationId(41n))).toBe(true);
      expect(await reader.exists(organizationId(9_007_199_254_740_993n))).toBe(false);

      const first = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: null,
        limit: 2,
      }));
      expect(first.attempts.map((attempt) => attempt.attemptId)).toEqual([103n, 102n]);
      expect(first.nextCursor).toBe(102n);
      expect(first.sampleCount).toBe(3);
      expect(first.attempts[0]).toMatchObject({
        item: { codeValueId: 7n, label: "축산" },
        floorRate: "90.000",
        baseAmount: { amount: "2761700.00", currency: "KRW" },
        winRate: null,
        listCount: 17,
        invalidCount: 2,
        martRelease: "2026-09-04T00",
        calcVersion: "v1",
      });
      expect(first.attempts[0]!.announcedAt.toString()).toBe("2026-09-03T00:00:00Z");
      expect(first.attempts[1]).toMatchObject({
        winRate: "90.309",
        secondRate: "90.412",
        dayFloorRate: "88.500",
        winnerSupplierPartyId: 77n,
      });

      const second = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: first.nextCursor,
        limit: 2,
      }));
      // 라벨 없는 품목은 코드가 있어도 unknown으로 남으며 표본 수는 cursor와 무관하게 같다.
      expect(second.attempts.map((attempt) => attempt.attemptId)).toEqual([101n]);
      expect(second.attempts[0]!.item).toBeNull();
      expect(second.nextCursor).toBeNull();
      expect(second.sampleCount).toBe(3);

      const filtered = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: 7n,
        cursor: null,
        limit: 12,
      }));
      expect(filtered.attempts.map((attempt) => attempt.attemptId)).toEqual([103n, 101n]);
      expect(filtered.sampleCount).toBe(2);

      const empty = pageOf(await reader.listAttempts({
        organizationId: organizationId(43n),
        itemCodeValueId: 9n,
        cursor: null,
        limit: 12,
      }));
      expect(empty.attempts).toEqual([]);
      expect(empty.sampleCount).toBe(0);

      // 104는 기관 43의 회차이고 9007199254740993은 존재하지 않는다. 둘 다 빈 페이지가 아니라 명시적 실패다.
      expect(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: 104n,
        limit: 12,
      })).toEqual({ kind: "cursor-not-found", cursor: 104n });
      expect(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: 9_007_199_254_740_993n,
        limit: 12,
      })).toEqual({ kind: "cursor-not-found", cursor: 9_007_199_254_740_993n });

      const runtime = await createApp({
        environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: url }),
        logWriter: () => undefined,
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        const response = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "41" },
            query: { limit: 1 },
          }),
        );
        expect(response.status).toBe(200);
        expect(response.body.attempts).toEqual([{
          attemptId: "103",
          announcedAt: "2026-09-03T00:00:00Z",
          openedAt: null,
          item: { codeValueId: "7", label: "축산" },
          floorRate: { value: "90.000", unit: "percentage-points" },
          baseAmount: { amount: "2761700.00", currency: "KRW" },
          winRate: null,
          secondRate: null,
          dayFloorRate: null,
          listCount: 17,
          invalidCount: 2,
          winnerSupplierPartyId: null,
          supersedesAttemptId: null,
        }]);
        expect(response.body.nextCursor).toBe("103");
        expect(response.body.meta).toEqual({
          sampleCount: 3,
          item: null,
          martRelease: "2026-09-04T00",
          computedAt: "2026-09-04T00:10:00Z",
          calcVersion: "v1",
        });
        const foreignCursor = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "41" },
            query: { cursor: "104" },
          }),
        );
        expect(foreignCursor.status).toBe(400);
        expect(foreignCursor.body.code).toBe("VALIDATION_ERROR");
        const auction = await request(server).get(
          auctionV1Operations.find.buildPath({ path: { auctionId: "103" } }),
        );
        expect(auction.status).toBe(200);
        expect(auction.body.organization).toEqual({
          organizationId: "41",
          name: "창원 남산초등학교",
          type: "school",
        });
        const missing = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "9007199254740993" },
          }),
        );
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe("ORGANIZATION_NOT_FOUND");
      } finally {
        await runtime.shutdown();
      }
    });
    expect(await docker("ps", "-a", "--filter", `label=${taskLabel}`, "--format", "{{.Names}}")).toBe("");
  }, 180_000);
});
