import { describe, expect, test } from "bun:test";

describe("database readiness", () => {
  test("checks exact migration and required/forbidden API privileges without mutation", async () => {
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
          can_create_role: false,
          can_create_database: false,
          owns_database: false,
          can_create_in_database: false,
          can_use_core: true,
          can_use_mart: true,
          can_use_app: true,
          can_use_ingest: false,
          can_create_core: false,
          can_create_mart: false,
          can_create_app: false,
          can_read_core: true,
          can_write_core: false,
          can_read_mart: true,
          can_write_mart: false,
          can_write_app: true,
          can_read_ingest: false,
          can_write_migrations: false,
        }];
      },
    });
    await expect(readiness.isReady()).resolves.toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.toLowerCase()).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/);
  });

  test("fails closed on migration mismatch, excessive privilege, or connection failure", async () => {
    const database = await import("./database-readiness").catch(() => undefined);
    expect(database, "database readiness must exist").toBeDefined();
    const baseline = {
      migration_name: "20260830021619_app_workspace_foundation",
      migration_created_at: String(Date.UTC(2026, 7, 30, 2, 16, 19)),
      is_superuser: false, can_create_role: false, can_create_database: false, owns_database: false,
      can_create_in_database: false, can_use_core: true, can_use_mart: true, can_use_app: true,
      can_use_ingest: false, can_create_core: false, can_create_mart: false, can_create_app: false,
      can_read_core: true, can_write_core: false, can_read_mart: true, can_write_mart: false,
      can_write_app: true, can_read_ingest: false,
      can_write_migrations: false,
    };
    for (const row of [
      { ...baseline, migration_name: "20260829002500_core_projection_lineage" },
      { ...baseline, can_create_app: true },
      { ...baseline, can_use_ingest: true },
    ]) {
      const readiness = database!.createDatabaseReadiness({ execute: async () => [row] });
      await expect(readiness.isReady()).resolves.toBe(false);
    }
    await expect(database!.createDatabaseReadiness({
      execute: async () => { throw new Error("offline"); },
    }).isReady()).resolves.toBe(false);
  });
});
