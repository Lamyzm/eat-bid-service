import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const databaseUrl = process.env.EATBID_RELEASE_TEST_DATABASE_URL;
const disposableDatabase = databaseUrl !== undefined
  && process.env.EATBID_RELEASE_TEST_DISPOSABLE === "1"
  && new URL(databaseUrl).hostname === "127.0.0.1"
  && new URL(databaseUrl).pathname === "/eatbid_task1";
const database = disposableDatabase ? postgres(databaseUrl, { max: 1, onnotice: () => {} }) : undefined;
const sha256 = "a".repeat(64);
let priorDisposableTest = Promise.resolve();

async function execute(statement: string) {
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

async function inIsolatedDisposableTest(action: () => Promise<void>) {
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

async function createPlannedReleaseWithRun() {
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

async function expectLockTimeout(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    expect(error).toHaveProperty("message", expect.stringContaining("lock timeout"));
    return;
  }

  throw new Error("seal transaction과 경쟁한 membership 변경이 lock timeout으로 거부되어야 합니다");
}

afterAll(async () => {
  await database?.end();
});

describe("source release seal 동시성 불변식", () => {

  test.skipIf(!disposableDatabase)("seal 중인 run membership update를 parent row lock으로 직렬화한다", async () => {
    await inIsolatedDisposableTest(async () => {
      const fixture = await createPlannedReleaseWithRun();
      const sealingClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      const membershipClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });

      try {
        await sealingClient.unsafe("begin");
        await sealingClient.unsafe(`
        update ingest.source_release
        set status = 'sealed', manifest_sha256 = '${sha256}', sealed_at = now()
        where source_release_id = '${fixture.sourceReleaseId}'
      `);
        await membershipClient.unsafe("set lock_timeout = '250ms'");
        await expectLockTimeout(() => membershipClient.unsafe(`
        update ingest.source_release_run
        set run_id = '${fixture.alternateRunId}'
        where source_release_id = '${fixture.sourceReleaseId}' and run_id = '${fixture.runId}'
      `));
        await sealingClient.unsafe("commit");

        const releases = await execute(`
        select status from ingest.source_release where source_release_id = '${fixture.sourceReleaseId}'
      `) as Array<{ status: string }>;
        const memberships = await execute(`
        select run_id from ingest.source_release_run where source_release_id = '${fixture.sourceReleaseId}'
      `) as Array<{ run_id: string }>;
        expect(releases).toEqual([{ status: "sealed" }]);
        expect(memberships).toEqual([{ run_id: fixture.runId }]);
      } finally {
        await sealingClient.unsafe("rollback").catch(() => undefined);
        await sealingClient.end();
        await membershipClient.end();
      }
    });
  });

  test.skipIf(!disposableDatabase)("seal 중인 required dataset update를 parent row lock으로 직렬화한다", async () => {
    await inIsolatedDisposableTest(async () => {
      const fixture = await createPlannedReleaseWithRun();
      const sealingClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      const datasetClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });

      try {
        await sealingClient.unsafe("begin");
        await sealingClient.unsafe(`
        update ingest.source_release
        set status = 'sealed', manifest_sha256 = '${sha256}', sealed_at = now()
        where source_release_id = '${fixture.sourceReleaseId}'
      `);
        await datasetClient.unsafe("set lock_timeout = '250ms'");
        await expectLockTimeout(() => datasetClient.unsafe(`
        update ingest.source_release_dataset
        set normalized_count = 0
        where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
      `));
        await sealingClient.unsafe("commit");

        const releases = await execute(`
        select status from ingest.source_release where source_release_id = '${fixture.sourceReleaseId}'
      `) as Array<{ status: string }>;
        const datasets = await execute(`
        select normalized_count from ingest.source_release_dataset
        where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
      `) as Array<{ normalized_count: string }>;
      expect(releases).toEqual([{ status: "sealed" }]);
      expect(datasets).toEqual([{ normalized_count: "1" }]);
      } finally {
        await sealingClient.unsafe("rollback").catch(() => undefined);
        await sealingClient.end();
        await datasetClient.end();
      }
    });
  });
});
