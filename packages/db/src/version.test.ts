import { describe, expect, test } from "bun:test";

import {
  expectedMigration,
  expectedMigrationInstant,
  migrationJournalInstant,
  migrationNameInstant,
} from "./version";

describe("schema version 검증", () => {
  test("commit된 ingest.run build_sha migration으로 고정한다", () => {
    expect(expectedMigration).toBe("20260905084009_ingest_run_build_sha_varchar");
  });

  test("migration 이름에 인코딩된 UTC Instant를 사용한다", () => {
    expect(expectedMigrationInstant.toString()).toBe("2026-09-05T08:40:09Z");
    expect(migrationNameInstant(expectedMigration).equals(expectedMigrationInstant)).toBe(true);
  });

  test("14자리 UTC prefix가 없는 migration 이름을 거부한다", () => {
    expect(() => migrationNameInstant("core_validity_constraints")).toThrow(
      "migration name is invalid",
    );
  });

  test("journal epoch millisecond 문자열을 Number 없이 lossless Instant로 복원한다", () => {
    expect(migrationJournalInstant("1788597609000").equals(expectedMigrationInstant)).toBe(true);
    expect(migrationJournalInstant(1_788_597_609_000n).equals(expectedMigrationInstant)).toBe(true);
    expect(() => migrationJournalInstant(1_788_597_609_000 as never)).toThrow("invalid timestamp");
    expect(() => migrationJournalInstant("1788597609000.0")).toThrow("invalid timestamp");
  });
});
