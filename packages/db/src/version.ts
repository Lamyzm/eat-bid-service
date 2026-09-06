/** @module 책임: 커밋된 Drizzle migration journal과 runtime schema version 비교에 쓰는 기준 시점을 소유한다. */
import { parseInstantText, Temporal } from "@eatbid/domain";

export const expectedMigration = "20260906030828_ingest_request_unit_attempt_count" as const;

export function migrationNameInstant(name: string): Temporal.Instant {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name);
  if (!match) {
    throw new Error(`Expected migration name is invalid: ${name}`);
  }

  const [, year, month, day, hour, minute, second] = match;
  try {
    return parseInstantText(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  } catch {
    throw new Error(`Expected migration name is invalid: ${name}`);
  }
}

export function migrationJournalInstant(value: unknown): Temporal.Instant {
  const epochMilliseconds = typeof value === "bigint"
    ? value
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)
      ? BigInt(value)
      : undefined;
  if (epochMilliseconds === undefined || epochMilliseconds < 0n) {
    throw new Error("Migration journal has an invalid timestamp");
  }

  try {
    // Drizzle journal은 epoch millisecond를 bigint로 저장하므로 nanosecond로 확장할 때도 Number를 거치지 않는다.
    return Temporal.Instant.fromEpochNanoseconds(epochMilliseconds * 1_000_000n);
  } catch {
    throw new Error("Migration journal has an invalid timestamp");
  }
}

export const expectedMigrationInstant = migrationNameInstant(expectedMigration);
