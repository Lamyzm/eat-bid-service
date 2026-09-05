import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const databaseUrl = process.env.EATBID_RELEASE_TEST_DATABASE_URL;
const disposableDatabase = databaseUrl !== undefined
  && process.env.EATBID_RELEASE_TEST_DISPOSABLE === "1"
  && new URL(databaseUrl).hostname === "127.0.0.1"
  && new URL(databaseUrl).pathname === "/eatbid_task1";
const database = disposableDatabase ? postgres(databaseUrl, { max: 1, onnotice: () => {} }) : undefined;
const builderVersion = "b".repeat(40);
let priorTest = Promise.resolve();

async function execute(statement: string) {
  if (!database) {
    throw new Error("EATBID_RELEASE_TEST_DATABASE_URL is required");
  }

  return database.unsafe(statement);
}

/**
 * 거부를 직접 붙잡아 메시지를 단언한다. 실패 경로가 통과로 새지 않도록 거부가 없으면 빈 문자열을
 * 돌려주고, 그 값이 기대 문자열을 담지 못해 test가 실패한다.
 */
async function rejection(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

async function reset() {
  await database?.unsafe("truncate table mart.build restart identity cascade");
}

async function isolated(action: () => Promise<void>) {
  let releaseNext: (() => void) | undefined;
  const previous = priorTest;
  priorTest = new Promise((resolve) => {
    releaseNext = resolve;
  });
  await previous;

  try {
    await reset();
    await action();
  } finally {
    await reset();
    releaseNext?.();
  }
}

async function createSourceRelease(): Promise<string> {
  const sourceReleaseId = randomUUID();
  await execute(`
    insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
    values ('${sourceReleaseId}', 'eat-${randomUUID()}', 'release-${randomUUID()}', 'planned', now())
  `);
  return sourceReleaseId;
}

async function openBuild(sourceReleaseId: string, options: { martName?: string; calcVersion?: string } = {}) {
  const martName = options.martName ?? "org_round_summary";
  const calcVersion = options.calcVersion ?? "mart-r1";
  const rows = await execute(`
    insert into mart.build (
      mart_name, source_release_id, calc_version, builder_version, region_scheme,
      status, as_of, started_at
    ) values (
      '${martName}', '${sourceReleaseId}', '${calcVersion}', '${builderVersion}',
      'eat:auction-location-sigungu', 'building', now(), now()
    )
    returning build_id
  `);
  return (rows as unknown as Array<{ build_id: string }>)[0].build_id;
}

async function verifyBuild(buildId: string, rowCount = 0) {
  await execute(`
    update mart.build
       set status = 'verified', computed_at = now(), row_count = ${rowCount}
     where build_id = ${buildId}
  `);
}

afterAll(async () => {
  await database?.end();
});

describe("mart.build 상태 기계", () => {
  test.skipIf(!disposableDatabase)("빌드는 building으로만 시작한다", async () => {
    await isolated(async () => {
      const sourceReleaseId = await createSourceRelease();

      expect(await rejection(() => execute(`
        insert into mart.build (
          mart_name, source_release_id, calc_version, builder_version, status, as_of, started_at,
          computed_at, activated_at, row_count
        ) values (
          'org_round_summary', '${sourceReleaseId}', 'mart-r1', '${builderVersion}', 'active',
          now(), now(), now(), now(), 0
        )
      `))).toContain("must start in the building state");
    });
  });

  test.skipIf(!disposableDatabase)("building에서 active로 직행하지 못한다", async () => {
    await isolated(async () => {
      const buildId = await openBuild(await createSourceRelease());

      expect(await rejection(() => execute(`
        update mart.build set status = 'active', computed_at = now(), activated_at = now(), row_count = 0
         where build_id = ${buildId}
      `))).toContain("building -> active is not allowed");
    });
  });

  test.skipIf(!disposableDatabase)("검증하지 않은 빌드는 행 수 없이 verified가 되지 못한다", async () => {
    await isolated(async () => {
      const buildId = await openBuild(await createSourceRelease());

      expect(await rejection(() => execute(`
        update mart.build set status = 'verified', computed_at = now() where build_id = ${buildId}
      `))).toContain("mart_build_verified_requires_evidence");
    });
  });

  test.skipIf(!disposableDatabase)("활성 build는 mart마다 하나뿐이다", async () => {
    await isolated(async () => {
      const sourceReleaseId = await createSourceRelease();
      const first = await openBuild(sourceReleaseId, { calcVersion: "mart-r1" });
      const second = await openBuild(sourceReleaseId, { calcVersion: "mart-r2" });
      await verifyBuild(first);
      await verifyBuild(second);
      await execute(`update mart.build set status = 'active', activated_at = now() where build_id = ${first}`);

      expect(await rejection(() => execute(`
        update mart.build set status = 'active', activated_at = now() where build_id = ${second}
      `))).toContain("mart_build_active_key");
    });
  });

  test.skipIf(!disposableDatabase)("이전 활성 build를 물린 뒤 새 build를 한 트랜잭션에서 활성화한다", async () => {
    await isolated(async () => {
      const sourceReleaseId = await createSourceRelease();
      const previous = await openBuild(sourceReleaseId, { calcVersion: "mart-r1" });
      const next = await openBuild(sourceReleaseId, { calcVersion: "mart-r2" });
      await verifyBuild(previous, 3);
      await verifyBuild(next, 4);
      await execute(`update mart.build set status = 'active', activated_at = now() where build_id = ${previous}`);

      await execute(`
        begin;
        update mart.build
           set status = 'superseded', superseded_at = now(), retain_until = now() + interval '7 days'
         where mart_name = 'org_round_summary' and status = 'active';
        update mart.build
           set status = 'active', activated_at = now()
         where build_id = ${next} and status = 'verified';
        commit;
      `);

      const rows = await execute("select status from mart.build order by build_id") as unknown as
        Array<{ status: string }>;
      expect(rows.map((row) => row.status)).toEqual(["superseded", "active"]);
    });
  });

  test.skipIf(!disposableDatabase)("멱등 키는 발행이 없는 수동 재빌드도 하나로 묶는다", async () => {
    await isolated(async () => {
      const sourceReleaseId = await createSourceRelease();
      await openBuild(sourceReleaseId);

      expect(await rejection(() => openBuild(sourceReleaseId))).toContain("mart_build_idempotency_key");
    });
  });

  test.skipIf(!disposableDatabase)("발행된 build의 계보는 지우지도 고치지도 못한다", async () => {
    await isolated(async () => {
      const buildId = await openBuild(await createSourceRelease());
      await verifyBuild(buildId, 2);
      await execute(`update mart.build set status = 'active', activated_at = now() where build_id = ${buildId}`);

      expect(await rejection(() => execute(`delete from mart.build where build_id = ${buildId}`)))
        .toContain("published mart build lineage is immutable");
      expect(await rejection(() => execute(`update mart.build set row_count = 9 where build_id = ${buildId}`)))
        .toContain("published mart build lineage is immutable");
    });
  });

  test.skipIf(!disposableDatabase)("실패한 build는 사유를 달고 활성 포인터를 움직이지 않는다", async () => {
    await isolated(async () => {
      const sourceReleaseId = await createSourceRelease();
      const active = await openBuild(sourceReleaseId, { calcVersion: "mart-r1" });
      await verifyBuild(active, 1);
      await execute(`update mart.build set status = 'active', activated_at = now() where build_id = ${active}`);
      const failing = await openBuild(sourceReleaseId, { calcVersion: "mart-r2" });

      expect(await rejection(() => execute(`update mart.build set status = 'failed' where build_id = ${failing}`)))
        .toContain("mart_build_failed_requires_category");
      await execute(`
        update mart.build set status = 'failed', failure_category = 'CONFIGURATION' where build_id = ${failing}
      `);

      const rows = await execute(`
        select build_id from mart.build where mart_name = 'org_round_summary' and status = 'active'
      `) as unknown as Array<{ build_id: string }>;
      expect(rows.map((row) => row.build_id)).toEqual([active]);
    });
  });
});
