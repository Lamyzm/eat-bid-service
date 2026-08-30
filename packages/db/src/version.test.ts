import { describe, expect, test } from "bun:test";

import {
  expectedMigration,
  expectedMigrationTimestamp,
  migrationNameTimestamp,
} from "./version";

describe("검증 범위를 정의한다 — schema version", () => {
  test("상태를 검증한다 — is pinned to the committed foundation migration", () => {
    expect(expectedMigration).toBe("20260830021619_app_workspace_foundation");
  });

  test("사용 계약을 검증한다 — uses the UTC millisecond timestamp encoded in the migration name", () => {
    expect(expectedMigrationTimestamp).toBe(Date.UTC(2026, 7, 30, 2, 16, 19));
    expect(migrationNameTimestamp(expectedMigration)).toBe(expectedMigrationTimestamp);
  });

  test("거부 조건을 검증한다 — rejects migration names without a 14-digit UTC prefix", () => {
    expect(() => migrationNameTimestamp("core_validity_constraints")).toThrow(
      "migration name is invalid",
    );
  });
});
