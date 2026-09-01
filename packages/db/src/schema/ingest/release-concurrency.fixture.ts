/** @module 책임: source release PostgreSQL 동시성 integration test의 전용 DB lifecycle과 fixture를 소유한다. */
import { randomUUID } from "node:crypto";

import postgres from "postgres";

export const databaseUrl = process.env.EATBID_RELEASE_TEST_DATABASE_URL;
const disposableDatabaseUrl = databaseUrl !== undefined
  && process.env.EATBID_RELEASE_TEST_DISPOSABLE === "1"
  && new URL(databaseUrl).hostname === "127.0.0.1"
  && new URL(databaseUrl).pathname === "/eatbid_task1"
  ? databaseUrl
  : undefined;
export const disposableDatabase = disposableDatabaseUrl !== undefined;
export const database = disposableDatabaseUrl
  ? postgres(disposableDatabaseUrl, { max: 1, onnotice: () => {} })
  : undefined;
export const sha256 = "a".repeat(64);
let priorDisposableTest = Promise.resolve();

export async function execute(statement: string) {
  if (!database) {
    throw new Error("disposable source release PostgreSQL URL is required");
  }

  return database.unsafe(statement);
}

async function resetDisposableDatabase() {
  await database?.unsafe(`
    truncate table
      ingest.source_release_run,
      ingest.source_release_observation,
      ingest.source_release_dataset,
      ingest.source_release,
      ingest.raw_observation,
      ingest.request_unit,
      ingest.raw_blob,
      ingest.run
    restart identity cascade
  `);
}

export async function inIsolatedDisposableTest(action: () => Promise<void>) {
  let releaseNextTest: (() => void) | undefined;
  const priorTest = priorDisposableTest;
  priorDisposableTest = new Promise((resolve) => {
    releaseNextTest = resolve;
  });
  await priorTest;

  try {
    await resetDisposableDatabase();
    await action();
  } finally {
    await resetDisposableDatabase();
    releaseNextTest?.();
  }
}

export async function createPlannedReleaseWithRun() {
  const sourceReleaseId = randomUUID();
  const runId = randomUUID();
  const alternateRunId = randomUUID();
  await execute(`
    insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
    values ('${sourceReleaseId}', 'eat-${randomUUID()}', 'release-${randomUUID()}', 'planned', now())
  `);
  await execute(`
    insert into ingest.source_release_dataset (
      source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint,
      expected_count, observed_count, normalized_count, quarantined_count, required
    ) values ('${sourceReleaseId}', '/datasets', 'auction', 'auction', 'v1', '${sha256}', 1, 1, 1, 0, true)
  `);
  await execute(`
    insert into ingest.run (
      run_id, mode, status, build_sha, parser_version, started_at,
      expected_count, captured_count, published_count
    ) values ('${runId}', 'capture', 'planned', '${randomUUID().replaceAll("-", "").repeat(2)}', 'v1', now(), 0, 0, 0)
  `);
  await execute(`
    insert into ingest.run (
      run_id, mode, status, build_sha, parser_version, started_at,
      expected_count, captured_count, published_count
    ) values ('${alternateRunId}', 'capture', 'planned', '${randomUUID().replaceAll("-", "").repeat(2)}', 'v1', now(), 0, 0, 0)
  `);
  await execute(`
    insert into ingest.source_release_run (source_release_id, run_id)
    values ('${sourceReleaseId}', '${runId}')
  `);

  return { sourceReleaseId, runId, alternateRunId };
}
