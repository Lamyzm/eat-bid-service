import { describe, expect, test } from "bun:test";

import {
  expectedMigration,
  expectedMigrationTimestamp,
  migrationNameTimestamp,
} from "./version";

describe("schema version", () => {
  test("is pinned to the committed foundation migration", () => {
    expect(expectedMigration).toBe("20260830021619_app_workspace_foundation");
  });

  test("uses the UTC millisecond timestamp encoded in the migration name", () => {
    expect(expectedMigrationTimestamp).toBe(Date.UTC(2026, 7, 30, 2, 16, 19));
    expect(migrationNameTimestamp(expectedMigration)).toBe(expectedMigrationTimestamp);
  });

  test("rejects migration names without a 14-digit UTC prefix", () => {
    expect(() => migrationNameTimestamp("core_validity_constraints")).toThrow(
      "migration name is invalid",
    );
  });
});
