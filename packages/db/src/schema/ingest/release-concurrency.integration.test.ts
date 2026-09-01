import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  createPlannedReleaseWithRun,
  database,
  databaseUrl,
  disposableDatabase,
  execute,
  inIsolatedDisposableTest,
  sha256,
} from "./release-concurrency.fixture";

async function expectLockTimeout(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    expect(error).toHaveProperty("code", "55P03");
    expect(error).toHaveProperty("message", expect.stringContaining("lock timeout"));
    return;
  }

  throw new Error("seal transaction과 경쟁한 membership 변경이 lock timeout으로 거부되어야 합니다");
}

async function expectPostgreSqlError(
  action: () => Promise<unknown>,
  code: string,
  message: string,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toHaveProperty("code", code);
    expect(error).toHaveProperty("message", expect.stringContaining(message));
    return;
  }

  throw new Error(`PostgreSQL이 ${code} ${message}으로 거부해야 합니다`);
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

  test.skipIf(!disposableDatabase)("repeatable read의 오래된 required dataset snapshot으로 seal하지 못한다", async () => {
    await inIsolatedDisposableTest(async () => {
      const fixture = await createPlannedReleaseWithRun();
      const sealingClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      const datasetClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });

      try {
        await sealingClient.unsafe("begin isolation level repeatable read");
        await sealingClient.unsafe(`
          select normalized_count
          from ingest.source_release_dataset
          where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
        `);
        await datasetClient.unsafe(`
          update ingest.source_release_dataset
          set normalized_count = 0
          where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
        `);
        await expectPostgreSqlError(
          () => sealingClient.unsafe(`
            update ingest.source_release
            set status = 'sealed', manifest_sha256 = '${sha256}', sealed_at = now()
            where source_release_id = '${fixture.sourceReleaseId}'
          `),
          "25000",
          "source release terminal transition requires read committed isolation",
        );
        await sealingClient.unsafe("rollback");

        const releases = await execute(`
          select status from ingest.source_release where source_release_id = '${fixture.sourceReleaseId}'
        `) as Array<{ status: string }>;
        const datasets = await execute(`
          select normalized_count from ingest.source_release_dataset
          where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
        `) as Array<{ normalized_count: string }>;
        expect(releases).toEqual([{ status: "planned" }]);
        expect(datasets).toEqual([{ normalized_count: "0" }]);
      } finally {
        await sealingClient.unsafe("rollback").catch(() => undefined);
        await sealingClient.end();
        await datasetClient.end();
      }
    });
  });

  test.skipIf(!disposableDatabase)("required dataset 변경이 parent lock을 먼저 해제하면 read committed seal이 새 aggregate를 거부한다", async () => {
    await inIsolatedDisposableTest(async () => {
      const fixture = await createPlannedReleaseWithRun();
      const childClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      const sealingClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });

      try {
        await childClient.unsafe("begin");
        await childClient.unsafe(`
          update ingest.source_release_dataset
          set normalized_count = 0
          where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
        `);
        const sealAttempt = sealingClient.unsafe(`
          update ingest.source_release
          set status = 'sealed', manifest_sha256 = '${sha256}', sealed_at = now()
          where source_release_id = '${fixture.sourceReleaseId}'
        `).then(
          () => undefined,
          (error) => error,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        await childClient.unsafe("commit");
        const sealResult = await sealAttempt;
        expect(sealResult).toHaveProperty("code", "23514");
        expect(sealResult).toHaveProperty(
          "message",
          expect.stringContaining("sealed source release requires complete required datasets"),
        );

        const releases = await execute(`
          select status from ingest.source_release where source_release_id = '${fixture.sourceReleaseId}'
        `) as Array<{ status: string }>;
        expect(releases).toEqual([{ status: "planned" }]);
      } finally {
        await childClient.unsafe("rollback").catch(() => undefined);
        await childClient.end();
        await sealingClient.end();
      }
    });
  });

  test.skipIf(!disposableDatabase)("planned release의 순차 required dataset 변경을 허용한다", async () => {
    await inIsolatedDisposableTest(async () => {
      const fixture = await createPlannedReleaseWithRun();
      await execute(`
        update ingest.source_release_dataset
        set normalized_count = 0
        where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
      `);
      const datasets = await execute(`
        select normalized_count from ingest.source_release_dataset
        where source_release_id = '${fixture.sourceReleaseId}' and dataset = 'auction'
      `) as Array<{ normalized_count: string }>;
      const releases = await execute(`
        select status from ingest.source_release where source_release_id = '${fixture.sourceReleaseId}'
      `) as Array<{ status: string }>;
      expect(datasets).toEqual([{ normalized_count: "0" }]);
      expect(releases).toEqual([{ status: "planned" }]);
    });
  });
});
