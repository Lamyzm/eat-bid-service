import { describe, expect, test } from "bun:test";

import {
  expectedMigration,
  expectedMigrationTimestamp,
  migrationNameTimestamp,
} from "./version";

describe("schema version 검증", () => {
  test("commit된 foundation migration으로 고정한다", () => {
    expect(expectedMigration).toBe("20260830021619_app_workspace_foundation");
  });

  test("migration 이름에 인코딩된 UTC millisecond timestamp를 사용한다", () => {
    expect(expectedMigrationTimestamp).toBe(Date.UTC(2026, 7, 30, 2, 16, 19));
    expect(migrationNameTimestamp(expectedMigration)).toBe(expectedMigrationTimestamp);
  });

  test("14자리 UTC prefix가 없는 migration 이름을 거부한다", () => {
    expect(() => migrationNameTimestamp("core_validity_constraints")).toThrow(
      "migration name is invalid",
    );
  });
});
