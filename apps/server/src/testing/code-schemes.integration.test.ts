// docker PostgreSQL이 필요한 통합 테스트이며 `database.integration.test.ts`와 같은 관행을 따른다.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { DrizzleCodeReader } from "../modules/reference/infrastructure/drizzle/drizzle-code-reader";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";
const taskLabel = "eatbid.task=eat57-code-schemes";

const SCHEME = "mois:administrative-region";

/**
 * release 둘을 앉히는 이유는 활성 판정을 실제 행으로 확인해야 하기 때문이다. 옛 release에도 좌표가
 * 있어야 "다른 release의 점이 새 목록에 새지 않는다"가 질의로 닫힌다(ADR 0035 결정 5).
 */
const seed = `
  insert into ingest.run
    (run_id, mode, status, build_sha, parser_version, started_at, ended_at,
     failure_category, expected_count, captured_count, published_count)
  values ('00000000-0000-0000-0000-000000000571', 'capture', 'published', '${"a".repeat(64)}',
     'mois-v1', '2026-09-06T00:00:00Z', '2026-09-06T00:01:00Z', null, 1, 1, 1);
  insert into ingest.request_unit
    (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
     expected_count, observed_count, status)
  overriding system value
  values (5701, '00000000-0000-0000-0000-000000000571', 'mois', '/codeFullDown.do', '{}',
     '${"b".repeat(64)}', 1, 1, 'captured');
  insert into ingest.raw_blob
    (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
  values ('${"c".repeat(64)}', 'raw/mois/region/${"c".repeat(64)}.txt.gz', 10,
     'text/plain', 'gzip', '2026-09-06T00:00:30Z');
  insert into ingest.raw_observation
    (observation_id, run_id, request_unit_id, source, endpoint, request_params,
     fetched_at, http_status, content_sha256)
  overriding system value
  values (5711, '00000000-0000-0000-0000-000000000571', 5701, 'mois', '/codeFullDown.do', '{}',
     '2026-09-06T00:00:30Z', 200, '${"c".repeat(64)}'),
    (5712, '00000000-0000-0000-0000-000000000571', 5701, 'mois', '/codeFullDown.do', '{}',
     '2026-09-06T00:00:40Z', 200, '${"c".repeat(64)}');
  -- release는 planned로 들어가 sealed로만 넘어간다. 그 전이 규칙을 fixture가 우회하지 않는다.
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000581', 'mois', 'mois-2025-01-01', 'planned',
     '2025-01-01T00:00:00Z'),
    ('00000000-0000-0000-0000-000000000582', 'mois', 'mois-2026-09-06', 'planned',
     '2026-09-06T00:00:00Z');
  insert into ingest.source_release_dataset
    (source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint,
     expected_count, observed_count, normalized_count, quarantined_count, required)
  values ('00000000-0000-0000-0000-000000000581', '/codeFullDown.do', 'region-code',
     'code.release.v1', 'mois-v1', '${"f".repeat(64)}', 1, 1, 1, 0, true),
    ('00000000-0000-0000-0000-000000000582', '/codeFullDown.do', 'region-code',
     'code.release.v1', 'mois-v1', '${"f".repeat(64)}', 3, 3, 3, 0, true);
  update ingest.source_release
     set status = 'sealed', manifest_sha256 = '${"d".repeat(64)}', sealed_at = '2025-01-01T00:10:00Z'
   where source_release_id = '00000000-0000-0000-0000-000000000581';
  update ingest.source_release
     set status = 'sealed', manifest_sha256 = '${"e".repeat(64)}', sealed_at = '2026-09-06T00:10:00Z'
   where source_release_id = '00000000-0000-0000-0000-000000000582';
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (57, '${SCHEME}', 'mois', 'release', 'closed');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (5701, 57, '1100000000'), (5702, 57, '1111000000'), (5703, 57, '1114000000');
  -- 같은 코드에 라벨 관측이 둘이면 가장 나중 관측이 목록에 실려야 한다.
  insert into core.code_label_observation
    (code_value_id, label, language, observed_at, observation_id)
  values (5701, '서울시', 'ko', '2025-01-01T00:00:00Z', 5711),
    (5701, '서울특별시', 'ko', '2026-09-06T00:00:30Z', 5712),
    (5702, '서울특별시 종로구', 'ko', '2026-09-06T00:00:30Z', 5712),
    (5703, '서울특별시 중구', 'ko', '2026-09-06T00:00:30Z', 5712);
  insert into core.code_release
    (code_release_id, source_release_id, code_scheme_id, source_version, published_at,
     promoted_grain, source_row_count, member_count, excluded_row_count)
  overriding system value
  values (5741, '00000000-0000-0000-0000-000000000581', 57, '2025-01-01', null,
     array['sido'], 100, 1, 99),
    (5742, '00000000-0000-0000-0000-000000000582', 57, '2026-09-06', null,
     array['sido','sigungu'], 300, 3, 297);
  insert into core.code_release_member
    (code_release_id, code_value_id, parent_code_value_id, grain, active, valid_from, valid_to)
  values (5741, 5701, null, 'sido', true, null, null),
    (5742, 5701, null, 'sido', true, null, null),
    (5742, 5702, 5701, 'sigungu', true, null, null),
    (5742, 5703, 5701, 'sigungu', false, '2026-07-01T00:00:00Z', null);
  insert into core.code_value_coordinate
    (code_value_id, code_release_id, latitude, longitude, crs, evidence_observation_id)
  values (5701, 5742, 37.566500, 126.978000, 'EPSG:4326', 5712),
    (5702, 5741, 11.111111, 22.222222, 'EPSG:4326', 5711);
`;

async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function withSeededDatabase(
  work: (client: ReturnType<typeof postgres>) => Promise<void>,
): Promise<void> {
  const name = `eatbid-eat57-${process.pid}-${Date.now()}`;
  let client: ReturnType<typeof postgres> | undefined;
  await docker(
    "run", "--detach", "--rm",
    "--name", name,
    "--label", taskLabel,
    "--env", "POSTGRES_USER=eatbid_owner",
    "--env", "POSTGRES_PASSWORD=owner-test-secret",
    "--env", "POSTGRES_DB=eatbid_test",
    "--publish", "127.0.0.1::5432",
    postgresImage,
  );
  try {
    const port = (await docker("port", name, "5432/tcp")).split(":").at(-1);
    client = postgres(`postgres://eatbid_owner:owner-test-secret@127.0.0.1:${port}/eatbid_test`, {
      max: 4,
      connect_timeout: 2,
      onnotice: () => undefined,
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await client`select 1`;
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    await client`select 1`;
    const failure = await migrate(drizzle({ client }), { migrationsFolder: migrationFolder });
    if (failure) throw new Error(`Migration apply failed with ${failure.exitCode}`);
    await client.unsafe(seed);
    await work(client);
  } finally {
    if (client) await client.end({ timeout: 1 }).catch(() => undefined);
    await docker("rm", "--force", name).catch(() => undefined);
  }
}

describe("코드 체계 목록 PostgreSQL 경계", () => {
  test("가장 나중 release의 member·최신 라벨·같은 release의 좌표만 읽는다", async () => {
    await withSeededDatabase(async (client) => {
      const reader = new DrizzleCodeReader(drizzle({ client }));

      const listing = await reader.readActiveRelease({ scheme: SCHEME, grain: null });
      expect(listing?.release).toEqual({
        codeReleaseId: 5742n,
        sourceVersion: "2026-09-06",
        publishedAt: null,
        promotedGrain: ["sido", "sigungu"],
      });
      expect(listing?.codes.map((code) => [code.code, code.label, code.grain, code.active])).toEqual([
        ["1100000000", "서울특별시", "sido", true],
        ["1111000000", "서울특별시 종로구", "sigungu", true],
        ["1114000000", "서울특별시 중구", "sigungu", false],
      ]);
      expect(listing?.codes[0]?.coordinate).toEqual({
        latitude: 37.5665,
        longitude: 126.978,
        crs: "EPSG:4326",
      });
      // 원본이 준 경계만 싣고 없는 쪽은 null로 남는다.
      expect(listing?.codes[2]?.validFrom?.toString()).toBe("2026-07-01T00:00:00Z");
      expect(listing?.codes[2]?.validTo).toBeNull();
      // 옛 release의 좌표는 새 목록에 새지 않는다.
      expect(listing?.codes[1]?.coordinate).toBeNull();
      expect(listing?.codes[1]?.parentCodeValueId).toBe(5701n);

      const sigungu = await reader.readActiveRelease({ scheme: SCHEME, grain: "sigungu" });
      expect(sigungu?.codes.map((code) => code.code)).toEqual(["1111000000", "1114000000"]);

      const unknown = await reader.readActiveRelease({ scheme: "eat:unknown-scheme", grain: null });
      expect(unknown).toBeNull();
    });
  }, 180_000);
});
