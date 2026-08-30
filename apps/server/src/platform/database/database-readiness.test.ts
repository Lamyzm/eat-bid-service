import { describe, expect, test } from "bun:test";

describe("검증 범위를 정의한다 — database readiness", () => {
  test("검사 결과를 검증한다 — checks exact migration and required/forbidden API privileges without mutation", async () => {
    const database = await import("./database-readiness").catch(() => undefined);
    expect(database, "database readiness must exist").toBeDefined();
    const queries: string[] = [];
    const readiness = database!.createDatabaseReadiness({
      execute: async (query: { queryChunks?: unknown[] }) => {
        queries.push(String(query));
        return [{
          migration_name: "20260830021619_app_workspace_foundation",
          migration_created_at: String(Date.UTC(2026, 7, 30, 2, 16, 19)),
          is_superuser: false,
          is_login: true,
          inherits_privileges: false,
          can_create_role: false,
          can_create_database: false,
          can_replicate: false,
          bypasses_rls: false,
          has_role_membership: false,
          can_set_role: false,
          owns_database: false,
          can_connect_database: true,
          can_create_in_database: false,
          can_temp_in_database: false,
          can_use_core: true,
          can_use_mart: true,
          can_use_app: true,
          can_use_ingest: false,
          can_use_drizzle: true,
          can_create_core: false,
          can_create_mart: false,
          can_create_app: false,
          can_create_ingest: false,
          can_create_drizzle: false,
          can_create_public: false,
          owns_relevant_objects: false,
          can_read_core: true,
          has_forbidden_core_table_privilege: false,
          can_read_mart: true,
          has_forbidden_mart_table_privilege: false,
          has_required_app_table_privileges: true,
          has_forbidden_app_table_privilege: false,
          has_sequence_privilege: false,
          has_ingest_table_privilege: false,
          can_read_migrations: true,
          has_forbidden_drizzle_table_privilege: false,
          has_public_table_privilege: false,
        }];
      },
    });
    await expect(readiness.isReady()).resolves.toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.toLowerCase()).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/);
  });

  test("실패 경계를 검증한다 — fails closed on migration mismatch, excessive privilege, or connection failure", async () => {
    const database = await import("./database-readiness").catch(() => undefined);
    expect(database, "database readiness must exist").toBeDefined();
    const baseline = {
      migration_name: "20260830021619_app_workspace_foundation",
      migration_created_at: String(Date.UTC(2026, 7, 30, 2, 16, 19)),
      is_superuser: false, is_login: true, inherits_privileges: false,
      can_create_role: false, can_create_database: false, can_replicate: false, bypasses_rls: false,
      has_role_membership: false, can_set_role: false, owns_database: false,
      can_connect_database: true, can_create_in_database: false, can_temp_in_database: false,
      can_use_core: true, can_use_mart: true, can_use_app: true, can_use_ingest: false,
      can_use_drizzle: true, can_create_core: false, can_create_mart: false, can_create_app: false,
      can_create_ingest: false, can_create_drizzle: false, can_create_public: false,
      owns_relevant_objects: false, can_read_core: true, has_forbidden_core_table_privilege: false,
      can_read_mart: true, has_forbidden_mart_table_privilege: false,
      has_required_app_table_privileges: true, has_forbidden_app_table_privilege: false,
      has_sequence_privilege: false, has_ingest_table_privilege: false, can_read_migrations: true,
      has_forbidden_drizzle_table_privilege: false, has_public_table_privilege: false,
    };
    for (const row of [
      { ...baseline, migration_name: "20260829002500_core_projection_lineage" },
      { ...baseline, can_create_app: true },
      { ...baseline, can_use_ingest: true },
      { ...baseline, can_temp_in_database: true },
      { ...baseline, has_role_membership: true },
      { ...baseline, has_sequence_privilege: true },
      { ...baseline, has_forbidden_app_table_privilege: true },
      { ...baseline, owns_relevant_objects: true },
    ]) {
      const readiness = database!.createDatabaseReadiness({ execute: async () => [row] });
      await expect(readiness.isReady()).resolves.toBe(false);
    }
    await expect(database!.createDatabaseReadiness({
      execute: async () => { throw new Error("offline"); },
    }).isReady()).resolves.toBe(false);
  });
});
