import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import request from "supertest";
import { auctionV1Operations, normalizedAuctionV1Schema } from "@eatbid/contracts";
import { expectedMigration, expectedMigrationInstant } from "@eatbid/db";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { createDatabaseReadiness } from "../platform/database/database-readiness";
import { createUnitOfWork, transactionDatabase } from "../platform/database/unit-of-work";
import { DrizzleAuctionReader, type AuctionReadDatabase } from "../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import { auctionId } from "../modules/procurement/domain/auction-id";
import {
  disposableDatabase,
  expectDenied,
  migrationFolder,
  provisioningSqlPath,
  repositoryRoot,
  sqlText,
} from "../../fixtures/disposable-database.fixture";

// 두 번 적용해도 journal이 커밋된 migration 수만큼만 늘어나는 것이 이 검증의 요점이다.
// 기대치를 상수로 박으면 migration을 더할 때마다 무관한 실패가 난다.
const committedMigrationCount = readdirSync(migrationFolder, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
const provisioningSql = readFileSync(provisioningSqlPath, "utf8");
const normalizedAuctionFixture = normalizedAuctionV1Schema.parse(JSON.parse(readFileSync(
  resolve(repositoryRoot, "packages/contracts/fixtures/ingestion-v1/normalized-auction.json"),
  "utf8",
)));
const canonicalNormalizedAuctionPayload = sqlText(JSON.stringify(normalizedAuctionFixture));

const { withDatabase: withDisposableDatabase, expectOwnedContainersCleanedUp } = disposableDatabase({
  task: "gate16-3",
  migrationApplyCount: 2,
  seed: async (owner) => {
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
        (9007199254740999, 9007199254740997, 'auction.v1',
         '${sqlText(normalizedAuctionFixture.identity.externalBidId)}',
         '${canonicalNormalizedAuctionPayload}',
         'eat-v1', '2026-08-30T00:00:40Z');
      insert into core.auction_attempt
        (auction_attempt_id, source_system, external_bid_id)
      overriding system value
      values (9007199254740993, 'eat',
        '${sqlText(normalizedAuctionFixture.identity.externalBidId)}');
      insert into core.auction_revision
        (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id,
         content_sha256, display_bid_no, source_status, title, announced_at, deadline_at,
         opened_at, base_amount, planned_amount, currency, source_payload)
      overriding system value
      values
        (9007199254740995, 9007199254740993, 9007199254740999, 9007199254740997,
         '${"d".repeat(64)}', null, '${sqlText(normalizedAuctionFixture.identity.status)}',
         '${sqlText(normalizedAuctionFixture.identity.title)}',
         '${sqlText(normalizedAuctionFixture.schedule.announcedAt!)}',
         '${sqlText(normalizedAuctionFixture.schedule.deadlineAt!)}', null, 1234567890.50,
         null, 'KRW',
         '${canonicalNormalizedAuctionPayload}');
      create table mart.api_read_probe (probe_id bigint primary key);
      insert into mart.api_read_probe values (1);
    `);
  },
});

describe("owner 범위 PostgreSQL 경계", () => {
  test("migration을 두 번 적용하고 API로 canonical auction을 읽어 최소 권한을 증명한다", async () => {
    await withDisposableDatabase(async ({ owner, api, apiUrl }) => {
      const journal = await api`
        select name, created_at from drizzle.__drizzle_migrations
        order by created_at desc, id desc limit 1
      `;
      expect(journal[0]).toMatchObject({
        name: expectedMigration,
        created_at: (expectedMigrationInstant.epochNanoseconds / 1_000_000n).toString(),
      });

      const reader = new DrizzleAuctionReader(drizzle({ client: api }));
      const auction = await reader.findById(auctionId(9_007_199_254_740_993n));
      expect(auction).toMatchObject({
        auctionId: 9_007_199_254_740_993n,
        revisionId: 9_007_199_254_740_995n,
        title: normalizedAuctionFixture.identity.title,
        baseAmount: { amount: "1234567890.50", currency: "KRW" },
        provenance: {
          observationId: 9_007_199_254_740_997n,
          normalizedRecordId: 9_007_199_254_740_999n,
        },
      });
      expect(auction?.announcedAt.toString()).toBe(normalizedAuctionFixture.schedule.announcedAt);
      expect(await owner`
        select normalized.record_type, normalized.normalized_payload, revision.source_payload
        from ingest.normalized_record normalized
        join core.auction_revision revision using (normalized_record_id)
        where normalized.normalized_record_id = 9007199254740999
      `).toEqual([{
        record_type: "auction.v1",
        normalized_payload: normalizedAuctionFixture,
        source_payload: normalizedAuctionFixture,
      }]);
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
        await expectDenied(name, attack);
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
        const response = await request(server).get(auctionV1Operations.find.buildPath({
          path: { auctionId: "9007199254740993" },
        }));
        expect(response.status).toBe(200);
        expect(response.body.identity.auctionId).toBe("9007199254740993");
        expect(response.body.pricing.baseAmount).toEqual({ amount: "1234567890.50", currency: "KRW" });
      } finally {
        await runtime.shutdown();
      }
      expect(await owner`select count(*)::int as count from drizzle.__drizzle_migrations`)
        .toEqual([{ count: committedMigrationCount }]);
    });
    await expectOwnedContainersCleanedUp();
  }, 120_000);

  test("identity insert는 sequence grant 없이 동작하고 readiness는 sequence 권한·소유권을 거부한다", async () => {
    await withDisposableDatabase(async ({ owner, api }) => {
      const readiness = createDatabaseReadiness(drizzle({ client: api }));
      expect(await readiness.isReady()).toBe(true);
      expect(await owner`
        select
          relation.relname as sequence_name,
          has_sequence_privilege('eatbid_api', relation.oid, 'USAGE') as has_usage,
          has_sequence_privilege('eatbid_api', relation.oid, 'SELECT') as has_select,
          has_sequence_privilege('eatbid_api', relation.oid, 'UPDATE') as has_update
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'app' and relation.relkind = 'S'
        order by relation.relname
      `).toEqual([
        {
          sequence_name: "identity_subject_identity_subject_id_seq",
          has_usage: false,
          has_select: false,
          has_update: false,
        },
        {
          sequence_name: "principal_principal_id_seq",
          has_usage: false,
          has_select: false,
          has_update: false,
        },
        {
          sequence_name: "registered_business_registered_business_id_seq",
          has_usage: false,
          has_select: false,
          has_update: false,
        },
        {
          sequence_name: "workspace_workspace_id_seq",
          has_usage: false,
          has_select: false,
          has_update: false,
        },
      ]);

      await api`insert into app.principal default values`;
      await api`delete from app.principal`;
      await expectDenied("direct identity nextval", () =>
        api`select nextval('app.principal_principal_id_seq')`);
      await expectDenied("direct identity sequence SELECT", () =>
        api`select last_value from app.principal_principal_id_seq`);
      await expectDenied("direct identity setval", () =>
        api`select setval('app.principal_principal_id_seq', 1, true)`);

      const sequenceBefore = (await owner`
        select last_value::text as last_value, is_called
        from app.principal_principal_id_seq
      `)[0]!;
      await owner`grant usage on sequence app.principal_principal_id_seq to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        await api`select nextval('app.principal_principal_id_seq')`;
      } finally {
        await owner`revoke usage on sequence app.principal_principal_id_seq from eatbid_api`;
        await owner`select setval(
          'app.principal_principal_id_seq',
          ${sequenceBefore.last_value}::bigint,
          ${sequenceBefore.is_called}::boolean
        )`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`grant select on sequence app.principal_principal_id_seq to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        expect(await api`select last_value::text as last_value from app.principal_principal_id_seq`)
          .toHaveLength(1);
      } finally {
        await owner`revoke select on sequence app.principal_principal_id_seq from eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`grant update on sequence app.principal_principal_id_seq to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        await api`select setval(
          'app.principal_principal_id_seq',
          ${sequenceBefore.last_value}::bigint,
          ${sequenceBefore.is_called}::boolean
        )`;
      } finally {
        await owner`revoke update on sequence app.principal_principal_id_seq from eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`alter table app.principal owner to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        expect(await owner`
          select pg_get_userbyid(relation.relowner) as owner
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'app' and relation.relname = 'principal_principal_id_seq'
        `).toEqual([{ owner: "eatbid_api" }]);
        await api`alter table app.principal add column owner_attack bigint`;
        await api`alter table app.principal drop column owner_attack`;
      } finally {
        await owner`alter table app.principal owner to eatbid_owner`;
        await owner`grant select, insert, update, delete on table app.principal to eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);
    });
    await expectOwnedContainersCleanedUp();
  }, 120_000);

  test("readiness가 database·schema·table·ownership·flag·role 권한 상승을 거부한다", async () => {
    await withDisposableDatabase(async ({ owner, api }) => {
      const readiness = createDatabaseReadiness(drizzle({ client: api }));
      const rejectsWhile = async (
        enable: string,
        restore: string,
        dangerousOperation?: () => Promise<unknown>,
      ): Promise<void> => {
        await owner.unsafe(enable);
        try {
          expect(await readiness.isReady()).toBe(false);
          await dangerousOperation?.();
        } finally {
          await owner.unsafe(restore);
        }
        expect(await readiness.isReady()).toBe(true);
      };

      expect(await readiness.isReady()).toBe(true);
      await rejectsWhile(
        "grant temporary on database eatbid_test to eatbid_api",
        "revoke temporary on database eatbid_test from eatbid_api",
        async () => {
          const session = await api.reserve();
          try {
            await session`create temporary table api_temp_attack (id bigint)`;
            await session`drop table api_temp_attack`;
          } finally {
            session.release();
          }
        },
      );

      for (const schema of ["core", "mart", "app", "ingest", "drizzle", "public"]) {
        await rejectsWhile(
          `grant create on schema ${schema} to eatbid_api`,
          `revoke create on schema ${schema} from eatbid_api`,
          schema === "ingest" ? undefined : async () => {
            await api.unsafe(`create table ${schema}.api_create_attack (id bigint)`);
            await api.unsafe(`drop table ${schema}.api_create_attack`);
          },
        );
      }

      for (const [table, capability] of [
        ["app.principal", "TRUNCATE"],
        ["app.workspace", "REFERENCES"],
        ["app.workspace", "TRIGGER"],
        ["core.auction_attempt", "TRUNCATE"],
        ["core.auction_attempt", "REFERENCES"],
        ["core.auction_attempt", "TRIGGER"],
        ["mart.api_read_probe", "TRUNCATE"],
        ["mart.api_read_probe", "REFERENCES"],
        ["mart.api_read_probe", "TRIGGER"],
        ["ingest.run", "TRUNCATE"],
        ["drizzle.__drizzle_migrations", "TRUNCATE"],
        ["drizzle.__drizzle_migrations", "REFERENCES"],
        ["drizzle.__drizzle_migrations", "TRIGGER"],
      ] as const) {
        await rejectsWhile(
          `grant ${capability} on table ${table} to eatbid_api`,
          `revoke ${capability} on table ${table} from eatbid_api`,
        );
      }

      await owner`grant truncate on table mart.api_read_probe to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        const rollback = new Error("rollback truncate attack");
        let rollbackObserved: unknown;
        try {
          await api.begin(async (transaction) => {
            await transaction`truncate table mart.api_read_probe`;
            throw rollback;
          });
        } catch (error) {
          rollbackObserved = error;
        }
        expect(rollbackObserved).toBe(rollback);
        expect(await api`select * from mart.api_read_probe`).toEqual([{ probe_id: "1" }]);
      } finally {
        await owner`revoke truncate on table mart.api_read_probe from eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`create table public.api_privilege_probe (id bigint)`;
      try {
        await rejectsWhile(
          "grant select on table public.api_privilege_probe to eatbid_api",
          "revoke select on table public.api_privilege_probe from eatbid_api",
          () => api`select * from public.api_privilege_probe`,
        );
      } finally {
        await owner`drop table public.api_privilege_probe`;
      }

      await owner`alter table mart.api_read_probe owner to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        await api`alter table mart.api_read_probe add column owner_attack bigint`;
        await api`alter table mart.api_read_probe drop column owner_attack`;
      } finally {
        await owner`alter table mart.api_read_probe owner to eatbid_owner`;
        await owner`grant select on table mart.api_read_probe to eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`alter table drizzle.__drizzle_migrations owner to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        await api`update drizzle.__drizzle_migrations set name = name`;
      } finally {
        await owner`alter table drizzle.__drizzle_migrations owner to eatbid_owner`;
        await owner`grant select on table drizzle.__drizzle_migrations to eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);

      for (const [enable, restore] of [
        ["superuser", "nosuperuser"],
        ["createdb", "nocreatedb"],
        ["createrole", "nocreaterole"],
        ["replication", "noreplication"],
        ["bypassrls", "nobypassrls"],
        ["inherit", "noinherit"],
        ["nologin", "login"],
      ] as const) {
        await rejectsWhile(
          `alter role eatbid_api ${enable}`,
          `alter role eatbid_api ${restore}`,
        );
      }

      await owner`create role api_escalation_target createrole`;
      await owner`grant api_escalation_target to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        const session = await api.reserve();
        try {
          await session`set role api_escalation_target`;
          expect(await session`select current_user`).toEqual([{ current_user: "api_escalation_target" }]);
          await session`reset role`;
        } finally {
          session.release();
        }
      } finally {
        await owner`revoke api_escalation_target from eatbid_api`;
        await owner`drop role api_escalation_target`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`create role api_transitive_target createrole`;
      await owner`create role api_escalation_hop`;
      await owner`grant api_transitive_target to api_escalation_hop`;
      await owner`grant api_escalation_hop to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        const session = await api.reserve();
        try {
          await session`set role api_transitive_target`;
          expect(await session`select current_user`).toEqual([{ current_user: "api_transitive_target" }]);
          await session`reset role`;
        } finally {
          session.release();
        }
      } finally {
        await owner`revoke api_escalation_hop from eatbid_api`;
        await owner`revoke api_transitive_target from api_escalation_hop`;
        await owner`drop role api_escalation_hop`;
        await owner`drop role api_transitive_target`;
      }
      expect(await readiness.isReady()).toBe(true);

      await owner`alter database eatbid_test owner to eatbid_api`;
      try {
        expect(await readiness.isReady()).toBe(false);
        await api`create schema api_database_owner_attack`;
        await api`drop schema api_database_owner_attack`;
      } finally {
        await owner`alter database eatbid_test owner to eatbid_owner`;
        await owner`grant connect on database eatbid_test to eatbid_api`;
      }
      expect(await readiness.isReady()).toBe(true);
    });
    await expectOwnedContainersCleanedUp();
  }, 120_000);

  test("readiness가 모든 유효 protected column 권한을 거부한다", async () => {
    await withDisposableDatabase(async ({ owner, api }) => {
      const readiness = createDatabaseReadiness(drizzle({ client: api }));
      const outcomes: Array<Readonly<{ attack: string; ready: boolean }>> = [];
      const rollback = async (work: (transaction: postgres.TransactionSql) => Promise<void>) => {
        const expected = new Error("rollback column privilege attack");
        let observed: unknown;
        try {
          await api.begin(async (transaction) => {
            await work(transaction);
            throw expected;
          });
        } catch (error) {
          observed = error;
        }
        expect(observed).toBe(expected);
      };
      const probe = async (
        table: string,
        column: string,
        capability: "SELECT" | "INSERT" | "UPDATE" | "REFERENCES",
        dangerousOperation?: () => Promise<void>,
        grantee: "eatbid_api" | "public" = "eatbid_api",
      ) => {
        const attack = `${table} ${capability}(${column})`;
        await owner.unsafe(
          `grant ${capability} (${column}) on table ${table} to ${grantee}`,
        );
        try {
          expect(await owner.unsafe(`
            select
              has_table_privilege('eatbid_api', '${table}', '${capability}') as table_capability,
              has_any_column_privilege(
                'eatbid_api', '${table}', '${capability}'
              ) as column_capability
          `), attack).toEqual([{ table_capability: false, column_capability: true }]);
          outcomes.push({ attack, ready: await readiness.isReady() });
          await dangerousOperation?.();
        } finally {
          await owner.unsafe(
            `revoke ${capability} (${column}) on table ${table} from ${grantee}`,
          );
        }
        expect(await readiness.isReady(), `${attack} restore`).toBe(true);
      };

      expect(await readiness.isReady()).toBe(true);

      await probe("core.auction_revision", "title", "UPDATE", () =>
        rollback(async (transaction) => {
          await transaction`update core.auction_revision set title = title`;
        }));
      await probe("core.auction_revision", "title", "INSERT");
      await probe("core.auction_revision", "auction_attempt_id", "REFERENCES");

      await probe("mart.api_read_probe", "probe_id", "INSERT", () =>
        rollback(async (transaction) => {
          await transaction`insert into mart.api_read_probe (probe_id) values (2)`;
        }));
      await probe("mart.api_read_probe", "probe_id", "UPDATE");
      await probe("mart.api_read_probe", "probe_id", "REFERENCES");

      await probe("ingest.run", "mode", "SELECT", async () => {
        await owner`grant usage on schema ingest to eatbid_api`;
        try {
          expect(await api`select mode from ingest.run`).toEqual([{ mode: "capture" }]);
        } finally {
          await owner`revoke usage on schema ingest from eatbid_api`;
        }
      });
      await probe("ingest.run", "run_id", "INSERT");
      await probe("ingest.run", "status", "UPDATE");
      await probe("ingest.run", "run_id", "REFERENCES");

      await probe("drizzle.__drizzle_migrations", "name", "UPDATE", () =>
        rollback(async (transaction) => {
          await transaction`update drizzle.__drizzle_migrations set name = name`;
        }));
      await probe("drizzle.__drizzle_migrations", "name", "INSERT");
      await probe("drizzle.__drizzle_migrations", "id", "REFERENCES");

      await probe("app.principal", "principal_id", "REFERENCES", async () => {
        await owner`grant create on schema public to eatbid_api`;
        try {
          await api`
            create table public.api_reference_attack (
              principal_id bigint references app.principal(principal_id)
            )
          `;
          await api`drop table public.api_reference_attack`;
        } finally {
          await owner`revoke create on schema public from eatbid_api`;
        }
      });

      await owner`create table public.api_column_probe (id bigint primary key)`;
      try {
        await probe("public.api_column_probe", "id", "SELECT", async () => {
          expect(await api`select id from public.api_column_probe`).toEqual([]);
        }, "public");
        await probe("public.api_column_probe", "id", "INSERT");
        await probe("public.api_column_probe", "id", "UPDATE");
        await probe("public.api_column_probe", "id", "REFERENCES");
      } finally {
        await owner`drop table public.api_column_probe`;
      }

      expect(outcomes).toEqual([
        { attack: "core.auction_revision UPDATE(title)", ready: false },
        { attack: "core.auction_revision INSERT(title)", ready: false },
        { attack: "core.auction_revision REFERENCES(auction_attempt_id)", ready: false },
        { attack: "mart.api_read_probe INSERT(probe_id)", ready: false },
        { attack: "mart.api_read_probe UPDATE(probe_id)", ready: false },
        { attack: "mart.api_read_probe REFERENCES(probe_id)", ready: false },
        { attack: "ingest.run SELECT(mode)", ready: false },
        { attack: "ingest.run INSERT(run_id)", ready: false },
        { attack: "ingest.run UPDATE(status)", ready: false },
        { attack: "ingest.run REFERENCES(run_id)", ready: false },
        { attack: "drizzle.__drizzle_migrations UPDATE(name)", ready: false },
        { attack: "drizzle.__drizzle_migrations INSERT(name)", ready: false },
        { attack: "drizzle.__drizzle_migrations REFERENCES(id)", ready: false },
        { attack: "app.principal REFERENCES(principal_id)", ready: false },
        { attack: "public.api_column_probe SELECT(id)", ready: false },
        { attack: "public.api_column_probe INSERT(id)", ready: false },
        { attack: "public.api_column_probe UPDATE(id)", ready: false },
        { attack: "public.api_column_probe REFERENCES(id)", ready: false },
      ]);
    });
    await expectOwnedContainersCleanedUp();
  }, 120_000);

  test("provisioning 뒤에 생긴 표에도 default privileges가 붙어 readiness가 유지된다", async () => {
    await withDisposableDatabase(async ({ owner, api }) => {
      const readiness = createDatabaseReadiness(drizzle({ client: api }));
      expect(await readiness.isReady()).toBe(true);

      // 다음 migration이 만드는 경로. migrator가 소유자이므로 FOR ROLE eatbid_migrator가 걸려야 한다.
      await owner.unsafe(`
        set role eatbid_migrator;
        create table core.late_core_probe (probe_id bigint primary key);
        create table mart.late_mart_probe (probe_id bigint primary key);
        create table app.late_app_probe
          (probe_id bigint generated always as identity primary key);
        reset role;
      `);
      expect(await readiness.isReady()).toBe(true);
      expect(await api`select count(*)::int as count from core.late_core_probe`)
        .toEqual([{ count: 0 }]);
      expect(await api`select count(*)::int as count from mart.late_mart_probe`)
        .toEqual([{ count: 0 }]);
      await api`insert into app.late_app_probe default values`;
      await api`delete from app.late_app_probe`;
      await expectDenied("late core write", () =>
        api`insert into core.late_core_probe (probe_id) values (1)`);
      await expectDenied("late app sequence", () =>
        api`select nextval('app.late_app_probe_probe_id_seq')`);

      // 덤프를 superuser로 복원한 경로. 소유자가 migrator가 아니어도 같은 readiness가 서야 한다.
      await owner`create table core.restored_core_probe (probe_id bigint primary key)`;
      expect(await readiness.isReady()).toBe(true);
      expect(await api`select count(*)::int as count from core.restored_core_probe`)
        .toEqual([{ count: 0 }]);

      // Sync hook은 매 sync마다 다시 돈다. 두 번째 실행이 권한을 바꾸면 readiness가 흔들린다.
      await owner.unsafe(provisioningSql);
      expect(await readiness.isReady()).toBe(true);
    });
    await expectOwnedContainersCleanedUp();
  }, 120_000);

  test("dataplane 역할이 mart를 쓰고 읽지만 mart에 표를 만들지는 못한다", async () => {
    await withDisposableDatabase(async ({ owner, api, dataplaneUrl }) => {
      const dataplane = postgres(dataplaneUrl, {
        max: 2,
        connect_timeout: 2,
        connection: { statement_timeout: 5_000, lock_timeout: 2_000 },
      });
      try {
        // mart 빌드가 실제로 쓰는 경로다. build 원장은 봉인될 입력 집합을 FK로 가리킨다.
        const releaseId = "3f4b0f7c-0a2f-4d5f-9d1e-0c6b7a8e9f01";
        await owner`
          insert into ingest.source_release
            (source_release_id, source, release_name, status, as_of)
          values (${releaseId}::uuid, 'eat', 'dataplane mart probe', 'planned', now())
        `;
        const inserted = await dataplane`
          insert into mart.build
            (mart_name, source_release_id, calc_version, builder_version, status, as_of, started_at)
          values ('org_round_summary', ${releaseId}::uuid, 'mart-r1', ${"a".repeat(40)},
                  'building', now(), now())
          returning build_id
        `;
        const buildId = inserted[0]?.build_id;
        expect(buildId).toBeDefined();
        await dataplane`update mart.build set row_count = 0 where build_id = ${buildId}`;
        await dataplane`delete from mart.build where build_id = ${buildId}`;
        expect(await dataplane`select count(*)::int as count from mart.org_round_summary`)
          .toEqual([{ count: 0 }]);
        // identity 키는 sequence ACL을 요구하지 않지만, mart 쪽 sequence 권한이 dataplane에는
        // 서 있어야 한다는 것이 이 배포 파일의 선언이다.
        expect(await dataplane`
          select count(*)::int as count from information_schema.role_usage_grants
          where object_schema = 'mart' and grantee = 'eatbid_dataplane'
        `).not.toEqual([{ count: 0 }]);

        // 런타임 DDL의 저작자는 Drizzle 하나뿐이다(AGENTS 10).
        await expectDenied("dataplane mart DDL", () =>
          dataplane`create table mart.dataplane_create_attack (id bigint)`);
        await expectDenied("dataplane app read", () => dataplane`select * from app.principal`);

        // provisioning 뒤에 생긴 mart 표에도 default privileges가 붙어야 다음 migration 하나에
        // 빌드가 권한 오류로 죽지 않는다.
        await owner.unsafe(`
          set role eatbid_migrator;
          create table mart.late_dataplane_probe (probe_id bigint primary key);
          reset role;
        `);
        await dataplane`insert into mart.late_dataplane_probe (probe_id) values (1)`;
        await dataplane`delete from mart.late_dataplane_probe`;
        // API는 그대로 mart 읽기 전용이다.
        expect(await api`select count(*)::int as count from mart.late_dataplane_probe`)
          .toEqual([{ count: 0 }]);
        await expectDenied("api mart write", () =>
          api`insert into mart.late_dataplane_probe (probe_id) values (1)`);
      } finally {
        await dataplane.end({ timeout: 1 }).catch(() => undefined);
      }
    });
    await expectOwnedContainersCleanedUp();
  }, 120_000);

  test("의도한 실패 뒤 task 소유 container를 정리한다", async () => {
    await expect(withDisposableDatabase(async () => {
      throw new Error("intentional cleanup probe");
    })).rejects.toThrow("intentional cleanup probe");
    await expectOwnedContainersCleanedUp();
  }, 120_000);
});
