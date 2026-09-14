import { describe, expect, test } from "bun:test";

import {
  expectedMigration,
  expectedMigrationInstant,
  migrationJournalInstant,
  migrationNameInstant,
} from "./version";

describe("schema version 검증", () => {
  test("commit된 마지막 migration으로 고정한다", () => {
    expect(expectedMigration).toBe("20260914123330_workspace_filter_combination");
  });

  test("migration 이름에 인코딩된 UTC Instant를 사용한다", () => {
    expect(expectedMigrationInstant.toString()).toBe("2026-09-14T12:33:30Z");
    expect(migrationNameInstant(expectedMigration).equals(expectedMigrationInstant)).toBe(true);
  });

  test("14자리 UTC prefix가 없는 migration 이름을 거부한다", () => {
    expect(() => migrationNameInstant("core_validity_constraints")).toThrow(
      "migration name is invalid",
    );
  });

  test("journal epoch millisecond 문자열을 Number 없이 lossless Instant로 복원한다", () => {
    // epoch millisecond를 손으로 적으면 migration을 낼 때마다 이 단언이 함께 깨진다. 기준에서 파생해
    // 무엇을 검증하는지(문자열·BigInt 둘 다 무손실로 복원되는지)만 남긴다.
    const 기대밀리 = expectedMigrationInstant.epochMilliseconds;
    expect(migrationJournalInstant(기대밀리.toString()).equals(expectedMigrationInstant)).toBe(true);
    expect(migrationJournalInstant(BigInt(기대밀리)).equals(expectedMigrationInstant)).toBe(true);
    expect(() => migrationJournalInstant(기대밀리 as never)).toThrow("invalid timestamp");
    expect(() => migrationJournalInstant(`${기대밀리}.0`)).toThrow("invalid timestamp");
  });
});
