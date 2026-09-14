import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectedMigration,
  expectedMigrationInstant,
  migrationJournalInstant,
  migrationNameInstant,
} from "./version";

describe("schema version 검증", () => {
  // 이름을 손으로 적으면 migration을 낼 때마다 이 파일이 함께 깨지고, 그때 숫자만 고치면 무엇을
  // 검증하는지가 흐려진다. 검증할 것은 "어느 migration인가"가 아니라 "커밋된 마지막 것과 같은가"다.
  test("commit된 마지막 migration 디렉터리와 같다", () => {
    const folder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
    const committed = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);

    expect(expectedMigration).toBe(committed);
  });

  test("migration 이름에 인코딩된 UTC Instant를 사용한다", () => {
    expect(migrationNameInstant(expectedMigration).equals(expectedMigrationInstant)).toBe(true);
    expect(expectedMigrationInstant.toString()).toBe(
      `${expectedMigration.slice(0, 4)}-${expectedMigration.slice(4, 6)}-${expectedMigration.slice(6, 8)}`
      + `T${expectedMigration.slice(8, 10)}:${expectedMigration.slice(10, 12)}:${expectedMigration.slice(12, 14)}Z`,
    );
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
