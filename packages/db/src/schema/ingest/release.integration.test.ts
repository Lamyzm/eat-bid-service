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

function uniqueSha256() {
  return randomUUID().replaceAll("-", "").repeat(2);
}

async function execute(statement: string) {
  if (!database) {
    throw new Error("EATBID_RELEASE_TEST_DATABASE_URL is required");
  }

  return database.unsafe(statement);
}

async function createPlannedRelease(options: {
  source?: string;
  releaseName?: string;
  manifestSha256?: string;
  expectedCount?: number;
  observedCount?: number;
  normalizedCount?: number;
  quarantinedCount?: number;
  required?: boolean;
} = {}) {
  const sourceReleaseId = randomUUID();
  const source = options.source ?? `eat-${randomUUID()}`;
  const releaseName = options.releaseName ?? `release-${randomUUID()}`;
  const manifestSha256 = options.manifestSha256 ?? sha256;
  const expectedCount = options.expectedCount ?? 2;
  const observedCount = options.observedCount ?? 2;
  const normalizedCount = options.normalizedCount ?? 1;
  const quarantinedCount = options.quarantinedCount ?? 1;
  const required = options.required ?? true;

  await execute(`
    insert into ingest.source_release (
      source_release_id, source, release_name, status, as_of
    ) values (
      '${sourceReleaseId}', '${source}', '${releaseName}', 'planned', now()
    )
  `);
  await execute(`
    insert into ingest.source_release_dataset (
      source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint,
      expected_count, observed_count, normalized_count, quarantined_count, required
    ) values (
      '${sourceReleaseId}', '/datasets', 'auction', 'auction', 'v1', '${sha256}',
      ${expectedCount}, ${observedCount}, ${normalizedCount}, ${quarantinedCount}, ${required}
    )
  `);

  return { sourceReleaseId, source, releaseName, manifestSha256 };
}

async function sealRelease(sourceReleaseId: string, manifestSha256 = sha256) {
  await execute(`
    update ingest.source_release
    set status = 'sealed', manifest_sha256 = '${manifestSha256}', sealed_at = now()
    where source_release_id = '${sourceReleaseId}'
  `);
}

async function addMembershipRows(sourceReleaseId: string) {
  const runId = randomUUID();
  const blobSha256 = uniqueSha256();
  const requestParamsHash = uniqueSha256();
  await execute(`
    insert into ingest.run (
      run_id, mode, status, build_sha, parser_version, started_at,
      expected_count, captured_count, published_count
    ) values (
      '${runId}', 'capture', 'planned', '${uniqueSha256()}', 'v1', now(), 0, 0, 0
    )
  `);
  await execute(`
    insert into ingest.raw_blob (
      content_sha256, object_key, byte_length, content_type, content_encoding, stored_at
    ) values (
      '${blobSha256}', 'raw/${randomUUID()}', 0, 'application/json', 'identity', now()
    )
  `);
  const requestUnits = await execute(`
    insert into ingest.request_unit (
      run_id, source, endpoint, request_params, request_params_hash,
      expected_count, observed_count, status
    ) values (
      '${runId}', 'eat', '/observations', '{}'::jsonb, '${requestParamsHash}', 0, 0, 'planned'
    ) returning request_unit_id
  `) as Array<{ request_unit_id: bigint }>;
  const requestUnitId = requestUnits[0]?.request_unit_id;
  if (requestUnitId === undefined) {
    throw new Error("request unit을 만들지 못했습니다");
  }
  const observations = await execute(`
    insert into ingest.raw_observation (
      run_id, request_unit_id, source, endpoint, request_params, fetched_at, http_status, content_sha256
    ) values (
      '${runId}', ${requestUnitId}, 'eat', '/observations', '{}'::jsonb, now(), 200, '${blobSha256}'
    ) returning observation_id
  `) as Array<{ observation_id: bigint }>;
  const observationId = observations[0]?.observation_id;
  if (observationId === undefined) {
    throw new Error("raw observation을 만들지 못했습니다");
  }
  await execute(`
    insert into ingest.source_release_run (source_release_id, run_id)
    values ('${sourceReleaseId}', '${runId}')
  `);
  await execute(`
    insert into ingest.source_release_observation (source_release_id, observation_id)
    values ('${sourceReleaseId}', ${observationId})
  `);

  return { runId, observationId };
}

async function expectDatabaseReject(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    expect(error).toHaveProperty("message", expect.stringContaining(message));
    return;
  }

  throw new Error(`PostgreSQL이 ${message}로 거부해야 합니다`);
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

afterAll(async () => {
  await database?.end();
});

describe("source release PostgreSQL 불변식", () => {
  test.skipIf(!disposableDatabase)("required dataset이 완전하지 않으면 seal을 거부한다", async () => {
    await inIsolatedDisposableTest(async () => {
      const release = await createPlannedRelease({ expectedCount: 2, observedCount: 1, normalizedCount: 1, quarantinedCount: 0 });

      await expectDatabaseReject(
        () => sealRelease(release.sourceReleaseId),
        "sealed source release requires complete required datasets",
      );
    });
  });

  test.skipIf(!disposableDatabase)("sealed source release 행과 membership 변경을 거부한다", async () => {
    await inIsolatedDisposableTest(async () => {
    const release = await createPlannedRelease();
    const membership = await addMembershipRows(release.sourceReleaseId);
    await sealRelease(release.sourceReleaseId);

    await expectDatabaseReject(
      () => execute(`update ingest.source_release set release_name = 'changed' where source_release_id = '${release.sourceReleaseId}'`),
      "sealed source release is immutable",
    );
    await expectDatabaseReject(
      () => execute(`update ingest.source_release set status = 'planned', manifest_sha256 = null, sealed_at = null where source_release_id = '${release.sourceReleaseId}'`),
      "sealed source release is immutable",
    );
    await expectDatabaseReject(
      () => execute(`delete from ingest.source_release where source_release_id = '${release.sourceReleaseId}'`),
      "sealed source release is immutable",
    );
    await expectDatabaseReject(
      () => execute(`insert into ingest.source_release_run (source_release_id, run_id) values ('${release.sourceReleaseId}', '${randomUUID()}')`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`update ingest.source_release_run set run_id = '${randomUUID()}' where source_release_id = '${release.sourceReleaseId}' and run_id = '${membership.runId}'`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`delete from ingest.source_release_run where source_release_id = '${release.sourceReleaseId}' and run_id = '${membership.runId}'`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`insert into ingest.source_release_observation (source_release_id, observation_id) values ('${release.sourceReleaseId}', 999999999999)`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`update ingest.source_release_observation set observation_id = 999999999999 where source_release_id = '${release.sourceReleaseId}' and observation_id = ${membership.observationId}`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`delete from ingest.source_release_observation where source_release_id = '${release.sourceReleaseId}' and observation_id = ${membership.observationId}`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`insert into ingest.source_release_dataset (source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint, expected_count, observed_count, normalized_count, quarantined_count, required) values ('${release.sourceReleaseId}', '/datasets', 'new', 'auction', 'v1', '${sha256}', 0, 0, 0, 0, false)`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`update ingest.source_release_dataset set endpoint = '/changed' where source_release_id = '${release.sourceReleaseId}' and dataset = 'auction'`),
      "sealed source release membership is immutable",
    );
    await expectDatabaseReject(
      () => execute(`delete from ingest.source_release_dataset where source_release_id = '${release.sourceReleaseId}' and dataset = 'auction'`),
      "sealed source release membership is immutable",
    );
    });
  });

  test.skipIf(!disposableDatabase)("같은 source와 sealed manifest hash의 중복 insert를 거부한다", async () => {
    await inIsolatedDisposableTest(async () => {
    const source = `eat-${randomUUID()}`;
    const first = await createPlannedRelease({ source, releaseName: "first" });
    await sealRelease(first.sourceReleaseId, sha256);
    const second = await createPlannedRelease({ source, releaseName: "second" });
    await expectDatabaseReject(
      () => sealRelease(second.sourceReleaseId, sha256),
      "source_release_source_manifest_sha256_key",
    );
    });
  });

  test.skipIf(!disposableDatabase)("dataset count 관계를 벗어난 insert를 거부한다", async () => {
    await inIsolatedDisposableTest(async () => {
    const sourceReleaseId = randomUUID();
    await execute(`
      insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
      values ('${sourceReleaseId}', 'eat-${randomUUID()}', 'release-${randomUUID()}', 'planned', now())
    `);

    await expectDatabaseReject(
      () => execute(`
        insert into ingest.source_release_dataset (
          source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint,
          expected_count, observed_count, normalized_count, quarantined_count, required
        ) values (
          '${sourceReleaseId}', '/datasets', 'too-many-observed', 'auction', 'v1', '${sha256}',
          1, 2, 1, 1, true
        )
      `),
      "source_release_dataset_observed_count_not_above_expected",
    );
    await expectDatabaseReject(
      () => execute(`
        insert into ingest.source_release_dataset (
          source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint,
          expected_count, observed_count, normalized_count, quarantined_count, required
        ) values (
          '${sourceReleaseId}', '/datasets', 'too-many-terminal', 'auction', 'v1', '${sha256}',
          2, 2, 2, 1, true
        )
      `),
      "source_release_dataset_terminal_count_not_above_observed",
    );
    });
  });

  test.skipIf(!disposableDatabase)("required dataset 없이거나 terminal 상태로 직접 insert한 release를 거부한다", async () => {
    await inIsolatedDisposableTest(async () => {
    const sourceReleaseId = randomUUID();
    await execute(`
      insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
      values ('${sourceReleaseId}', 'eat-${randomUUID()}', 'release-${randomUUID()}', 'planned', now())
    `);
    await expectDatabaseReject(
      () => sealRelease(sourceReleaseId),
      "sealed source release requires at least one required dataset",
    );
    await expectDatabaseReject(
      () => execute(`
        insert into ingest.source_release (
          source_release_id, source, release_name, status, as_of, manifest_sha256, sealed_at
        ) values ('${randomUUID()}', 'eat-${randomUUID()}', 'sealed', 'sealed', now(), '${sha256}', now())
      `),
      "source release must be inserted planned",
    );
    await expectDatabaseReject(
      () => execute(`
        insert into ingest.source_release (
          source_release_id, source, release_name, status, as_of, failure_category
        ) values ('${randomUUID()}', 'eat-${randomUUID()}', 'failed', 'failed', now(), 'capture')
      `),
      "source release must be inserted planned",
    );
    const emptyRequiredRelease = await createPlannedRelease({
      expectedCount: 0,
      observedCount: 0,
      normalizedCount: 0,
      quarantinedCount: 0,
    });
    await sealRelease(emptyRequiredRelease.sourceReleaseId, uniqueSha256());

    const failedReleaseId = randomUUID();
    await execute(`
      insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
      values ('${failedReleaseId}', 'eat-${randomUUID()}', 'failed-transition', 'planned', now())
    `);
    await execute(`
      update ingest.source_release
      set status = 'failed', failure_category = 'capture'
      where source_release_id = '${failedReleaseId}'
    `);
    await expectDatabaseReject(
      () => execute(`
        update ingest.source_release
        set release_name = 'changed'
        where source_release_id = '${failedReleaseId}'
      `),
      "failed source release is immutable",
    );
    });
  });
});
