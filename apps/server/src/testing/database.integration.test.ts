import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import request from "supertest";
import { expectedMigration, expectedMigrationTimestamp } from "@eatbid/db";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { createDatabaseReadiness } from "../platform/database/database-readiness";
import { createUnitOfWork, transactionDatabase } from "../platform/database/unit-of-work";
import { DrizzleAuctionReader, type AuctionReadDatabase } from "../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import { auctionId } from "../modules/procurement/domain/auction-id";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";
const taskLabel = "eatbid.task=gate16-3";

async function docker(...args: string[]): Promise<string> {
  const process = Bun.spawn(["docker", ...args], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function taskContainers(): Promise<string[]> {
  const output = await docker("ps", "-a", "--filter", `label=${taskLabel}`, "--format", "{{.Names}}");
  return output ? output.split(/\r?\n/) : [];
}

interface DisposableDatabase {
  readonly ownerUrl: string;
  readonly apiUrl: string;
  readonly owner: ReturnType<typeof postgres>;
  readonly api: ReturnType<typeof postgres>;
}

async function withDisposableDatabase<A>(work: (database: DisposableDatabase) => Promise<A>): Promise<A> {
  const name = `eatbid-gate16-3-${process.pid}-${Date.now()}`;
  let owner: ReturnType<typeof postgres> | undefined;
  let api: ReturnType<typeof postgres> | undefined;
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
    const portOutput = await docker("port", name, "5432/tcp");
    const port = portOutput.match(/:(\d+)$/)?.[1];
    if (!port) throw new Error(`Could not determine PostgreSQL port from ${portOutput}`);
    const ownerUrl = `postgres://eatbid_owner:owner-test-secret@127.0.0.1:${port}/eatbid_test`;
    const apiUrl = `postgres://eatbid_api:api-test-secret@127.0.0.1:${port}/eatbid_test`;
    owner = postgres(ownerUrl, { max: 1, connect_timeout: 1, onnotice: () => undefined });
    const deadline = Date.now() + 30_000;
    while (true) {
      try {
        await owner`select 1`;
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await Bun.sleep(100);
      }
    }
    const ownerDatabase = drizzle({ client: owner });
    const first = await migrate(ownerDatabase, { migrationsFolder: migrationFolder });
    if (first) throw new Error(`First migration apply failed with ${first.exitCode}`);
    const second = await migrate(ownerDatabase, { migrationsFolder: migrationFolder });
    if (second) throw new Error(`Second migration apply failed with ${second.exitCode}`);

    await owner.unsafe(`
      insert into ingest.run
        (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
         failure_category, expected_count, captured_count, published_count)
      values
        ('00000000-0000-0000-0000-000000000001', 'capture', 'published', '${"a".repeat(64)}',
         'eat-v1', '2026-08-30T00:00:00Z', '2026-08-30T00:01:00Z', null, 1, 1, 1);
      insert into ingest.request_unit
        (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
         expected_count, observed_count, status)
      overriding system value
      values
        (9007199254740991, '00000000-0000-0000-0000-000000000001', 'eat', '/auction', '{}',
         '${"b".repeat(64)}', 1, 1, 'captured');
      insert into ingest.raw_blob
        (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
      values ('${"c".repeat(64)}', 'raw/eat/auction/${"c".repeat(64)}.xml.gz', 10,
        'application/xml', 'gzip', '2026-08-30T00:00:30Z');
      insert into ingest.raw_observation
        (observation_id, run_id, request_unit_id, source, endpoint, request_params,
         fetched_at, http_status, content_sha256)
      overriding system value
      values
        (9007199254740997, '00000000-0000-0000-0000-000000000001', 9007199254740991,
         'eat', '/auction', '{}', '2026-08-30T00:00:30Z', 200, '${"c".repeat(64)}');
      insert into ingest.normalized_record
        (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload,
         parser_version, normalized_at)
      overriding system value
      values
        (9007199254740999, 9007199254740997, 'auction', 'external-opaque-id', '{}',
         'eat-v1', '2026-08-30T00:00:40Z');
      insert into core.auction_attempt
        (auction_attempt_id, source_system, external_bid_id)
      overriding system value
      values (9007199254740993, 'eat', 'external-opaque-id');
      insert into core.auction_revision
        (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
         content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
         opened_at, base_amount, planned_amount, currency, source_payload)
      overriding system value
      values
        (9007199254740995, 9007199254740993, 9007199254740999, 9007199254740997,
         '${"d".repeat(64)}', null, 'OPEN', 'Fresh produce supply', '2026-08-30T00:00:00Z',
         null, null, 1234567890.50, null, 'KRW', '{"mustNotEscape":true}');
      create table mart.api_read_probe (probe_id bigint primary key);
      insert into mart.api_read_probe values (1);
      create role eatbid_api login password 'api-test-secret'
        nosuperuser nocreatedb nocreaterole noinherit;
      revoke all on database eatbid_test from eatbid_api;
      grant connect on database eatbid_test to eatbid_api;
      grant usage on schema core, mart, app, drizzle to eatbid_api;
      grant select on all tables in schema core, mart to eatbid_api;
      grant select, insert, update, delete on all tables in schema app to eatbid_api;
      grant usage, select on all sequences in schema app to eatbid_api;
      grant select on drizzle.__drizzle_migrations to eatbid_api;
    `);
    api = postgres(apiUrl, {
      max: 4,
      connect_timeout: 2,
      connection: { statement_timeout: 5_000, lock_timeout: 2_000 },
    });
    await api`select 1`;
    return await work({ ownerUrl, apiUrl, owner, api });
  } finally {
    if (api) await api.end({ timeout: 1 }).catch(() => undefined);
    if (owner) await owner.end({ timeout: 1 }).catch(() => undefined);
    await docker("rm", "--force", name).catch(() => undefined);
  }
}

describe("owner-scoped PostgreSQL boundary", () => {
  test("double-applies migrations, reads the canonical auction as API, and proves least privilege", async () => {
    await withDisposableDatabase(async ({ owner, api, apiUrl }) => {
      const journal = await api`
        select name, created_at from drizzle.__drizzle_migrations
        order by created_at desc, id desc limit 1
      `;
      expect(journal[0]).toMatchObject({
        name: expectedMigration,
        created_at: String(expectedMigrationTimestamp),
      });

      const reader = new DrizzleAuctionReader(drizzle({ client: api }));
      const auction = await reader.findById(auctionId(9_007_199_254_740_993n));
      expect(auction).toMatchObject({
        auctionId: 9_007_199_254_740_993n,
        revisionId: 9_007_199_254_740_995n,
        title: "Fresh produce supply",
        provenance: {
          observationId: 9_007_199_254_740_997n,
          normalizedRecordId: 9_007_199_254_740_999n,
        },
      });
      expect(await api`select count(*)::int as count from core.auction_attempt`).toEqual([{ count: 1 }]);
      expect(await api`select * from mart.api_read_probe`).toEqual([{ probe_id: "1" }]);
      await api`insert into app.principal default values`;
      expect(await api`select count(*)::int as count from app.principal`).toEqual([{ count: 1 }]);
      await api`delete from app.principal`;

      for (const [name, attack] of [
        ["app DDL", () => api`create table app.api_attack (id bigint)`],
        ["core write", () => api`insert into core.auction_attempt (source_system, external_bid_id) values ('x', 'x')`],
        ["mart write", () => api`update mart.api_read_probe set probe_id = 2`],
        ["ingest read", () => api`select * from ingest.run`],
        ["role change", () => api`create role api_escalation`],
        ["migration write", () => api`update drizzle.__drizzle_migrations set name = 'tampered'`],
      ] as const) {
        let denied = false;
        try {
          await attack();
        } catch {
          denied = true;
        }
        expect(denied, `${name} must be denied`).toBe(true);
      }

      const before = await owner`
        select
          (select count(*)::int from information_schema.tables
            where table_schema in ('app','core','ingest','mart','drizzle')) as table_count,
          (select count(*)::int from drizzle.__drizzle_migrations) as migration_count
      `;
      const readiness = createDatabaseReadiness(drizzle({ client: api }));
      await expect(readiness.isReady()).resolves.toBe(true);
      await owner`revoke delete on app.workspace_membership from eatbid_api`;
      await expect(readiness.isReady()).resolves.toBe(false);
      await owner`grant delete on app.workspace_membership to eatbid_api`;
      await expect(readiness.isReady()).resolves.toBe(true);
      await owner`revoke select on mart.api_read_probe from eatbid_api`;
      await expect(readiness.isReady()).resolves.toBe(false);
      await owner`grant select on mart.api_read_probe to eatbid_api`;
      await owner`grant update on mart.api_read_probe to eatbid_api`;
      await expect(readiness.isReady()).resolves.toBe(false);
      await owner`revoke update on mart.api_read_probe from eatbid_api`;
      await expect(readiness.isReady()).resolves.toBe(true);
      const after = await owner`
        select
          (select count(*)::int from information_schema.tables
            where table_schema in ('app','core','ingest','mart','drizzle')) as table_count,
          (select count(*)::int from drizzle.__drizzle_migrations) as migration_count
      `;
      expect(after).toEqual(before);

      const apiDatabase = drizzle({ client: api });
      const unitOfWork = createUnitOfWork({
        transaction: (work) => apiDatabase.transaction((transaction) => work(transaction)),
      });
      const handles: unknown[] = [];
      const typedFailure = Object.assign(new Error("typed failure"), { code: "EXPECTED_FAILURE" });
      await expect(unitOfWork.run(async (transaction) => {
        handles.push(transaction, transaction);
        const database = transactionDatabase(transaction) as AuctionReadDatabase;
        await database.execute(sql`insert into app.principal default values`);
        throw typedFailure;
      })).rejects.toBe(typedFailure);
      expect(handles[0]).toBe(handles[1]);
      expect(await api`select count(*)::int as count from app.principal`).toEqual([{ count: 0 }]);
      let defect: unknown;
      try {
        await unitOfWork.run(async (transaction) => {
        const database = transactionDatabase(transaction) as AuctionReadDatabase;
        await database.execute(sql`insert into app.principal default values`);
        throw new TypeError("defect");
        });
      } catch (error) {
        defect = error;
      }
      expect(defect).toBeInstanceOf(TypeError);
      expect(await api`select count(*)::int as count from app.principal`).toEqual([{ count: 0 }]);

      const runtime = await createApp({
        environment: parseEnvironment({
          NODE_ENV: "test",
          PORT: "0",
          DATABASE_URL: apiUrl,
        }),
        logWriter: () => undefined,
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        expect((await request(server).get("/health/ready")).status).toBe(200);
        const response = await request(server).get("/api/v1/auctions/9007199254740993");
        expect(response.status).toBe(200);
        expect(response.body.auctionId).toBe("9007199254740993");
      } finally {
        await runtime.shutdown();
      }
      expect(await owner`select count(*)::int as count from drizzle.__drizzle_migrations`)
        .toEqual([{ count: 7 }]);
    });
    expect(await taskContainers()).toEqual([]);
  }, 120_000);

  test("cleans the task-owned container after an intentional failure", async () => {
    await expect(withDisposableDatabase(async () => {
      throw new Error("intentional cleanup probe");
    })).rejects.toThrow("intentional cleanup probe");
    expect(await taskContainers()).toEqual([]);
  }, 120_000);
});
