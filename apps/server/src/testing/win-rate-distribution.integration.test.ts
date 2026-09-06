// docker PostgreSQL이 필요한 통합 테스트이며 `database.integration.test.ts`와 같은 관행을 따른다.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { bidRate, canonicalDecimal, fixedClock, Temporal } from "@eatbid/domain";
import { FindWinRateDistribution } from "../modules/procurement/application/find-win-rate-distribution";
import { kstMonth } from "../modules/procurement/domain/kst-month";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { DrizzleWinRateDistributionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-win-rate-distribution-reader";

const repositoryRoot = resolve(import.meta.dir, "../../../..");
const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";
const taskLabel = "eatbid.task=eat38-distribution";

/**
 * 남산초 실관측 92회차(`docs/product/decision-screen-v2/design-generators/namsan.json`)의 0.01칸 집계다.
 * 서버 단위 test·web fixture와 같은 숫자여야 세 층이 같은 계산을 한다는 것이 닫힌다.
 */
const NAMSAN_FLOOR_90: ReadonlyArray<readonly [string, number]> = [
  ["90.000", 20], ["90.010", 8], ["90.020", 8], ["90.030", 8], ["90.040", 4], ["90.050", 3],
  ["90.060", 3], ["90.070", 2], ["90.080", 4], ["90.100", 5], ["90.110", 2], ["90.140", 1],
  ["90.150", 2], ["90.160", 2], ["90.190", 1], ["90.210", 1], ["90.270", 1], ["90.430", 1],
  ["90.530", 1], ["90.550", 1], ["90.560", 1], ["90.700", 1], ["90.760", 1], ["91.070", 1],
];

const NAMSAN_FLOOR_88: ReadonlyArray<readonly [string, number]> = [
  ["88.000", 4], ["88.020", 1], ["88.030", 2], ["88.040", 2], ["88.060", 1],
];

// 같은 칸이 두 달에 걸쳐 오는 실제 모양을 만든다. 상위 합이 달별 합과 같은지는 이렇게 나눠야 확인된다.
function splitAcrossMonths(bins: ReadonlyArray<readonly [string, number]>): string[] {
  return bins.flatMap(([lower, count]) => {
    const august = Math.floor(count / 2);
    const september = count - august;
    return [
      ...(august > 0 ? [`(601, 'national', null, null, null, ${lower.startsWith("88") ? "88.000" : "90.000"}, 31, '2026-08-01', ${lower}, 0.010, ${august})`] : []),
      ...(september > 0 ? [`(601, 'national', null, null, null, ${lower.startsWith("88") ? "88.000" : "90.000"}, 31, '2026-09-01', ${lower}, 0.010, ${september})`] : []),
    ];
  });
}

const distributionRows = [
  ...splitAcrossMonths(NAMSAN_FLOOR_90),
  ...splitAcrossMonths(NAMSAN_FLOOR_88),
  // 네 모집단이 모두 실데이터로 응답하는지 보려면 지역·기관 행도 있어야 한다(acceptance 1).
  "(601, 'province', 41, null, null, 90.000, 31, '2026-09-01', 90.000, 0.010, 9)",
  "(601, 'province', 41, null, null, 90.000, 31, '2026-09-01', 90.020, 0.010, 3)",
  "(601, 'district', 43, null, null, 90.000, 31, '2026-09-01', 90.000, 0.010, 5)",
  "(601, 'organization', null, 3101, null, 90.000, 31, '2026-09-01', 90.010, 0.010, 4)",
  // 낙찰방식이 다른 코호트는 같은 사다리에 섞이면 안 된다(domain-and-data §3.4).
  "(601, 'national', null, null, null, 90.000, 33, '2026-09-01', 90.000, 0.010, 77)",
].join(",\n         ");

const seed = `
  insert into core.organization (organization_id, type, canonical_name)
  overriding system value
  values (3101, 'school', '창원 남산초등학교');
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (11, 'eat:award-method', 'eat', 'immutable', 'open'),
         (12, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
         (13, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (31, 11, '003'), (33, 11, '013'), (41, 12, '48'), (43, 13, '48120');
  insert into ingest.source_release (source_release_id, source, release_name, status, as_of)
  values ('00000000-0000-0000-0000-000000000241', 'eat', 'eat-2026-09-06', 'planned',
    '2026-09-06T00:00:00Z');
  insert into mart.build
    (build_id, mart_name, source_release_id, calc_version, builder_version, region_scheme,
     status, as_of, started_at)
  overriding system value
  values (601, 'win_rate_distribution_monthly', '00000000-0000-0000-0000-000000000241', 'mart-r1',
    '${"a".repeat(40)}', 'eat:auction-location-sigungu', 'building',
    '2026-09-06T00:00:00Z', '2026-09-06T00:05:00Z');
  insert into mart.win_rate_distribution_monthly
    (build_id, scope, region_code_value_id, organization_id, item_code_value_id,
     floor_rate, award_method_code_value_id, month_kst, bin_lower, bin_width, attempt_count)
  values ${distributionRows};
  -- planner가 index를 고를 만큼의 다른 코호트 행. 실측 EXPLAIN이 30행짜리 표에서 나오면 증거가 아니다.
  -- 하한율은 f1이, 달과 칸은 f2가 만들어 코호트 key가 겹치지 않는다. 88과 90은 위 실측 코호트가
  -- 이미 쓰고 있으므로 제외한다.
  insert into mart.win_rate_distribution_monthly
    (build_id, scope, region_code_value_id, organization_id, item_code_value_id,
     floor_rate, award_method_code_value_id, month_kst, bin_lower, bin_width, attempt_count)
  select 601, 'national', null, null, null,
         (70 + f1)::numeric(6,3),
         31,
         (date '2025-10-01' + ((f2 % 12) || ' month')::interval)::date,
         (80 + f2 * 0.01)::numeric(15,3),
         0.010,
         1 + (f2 % 7)
    from generate_series(0, 19) as f1, generate_series(1, 2000) as f2
   where (70 + f1) not in (88, 90);
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (601, null, '2026-08-01', 10, 10, 10, 0, 'complete'),
         (601, null, '2026-09-01', 10, 10, 10, 0, 'unknown'),
         (601, 41, '2026-09-01', 10, 10, 10, 0, 'partial');
  update mart.build
     set status = 'verified', computed_at = '2026-09-06T00:10:00Z', row_count = 40000
   where build_id = 601;
  update mart.build
     set status = 'active', activated_at = '2026-09-06T00:11:00Z'
   where build_id = 601;
  analyze mart.win_rate_distribution_monthly;
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
  const name = `eatbid-eat38-${process.pid}-${Date.now()}`;
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

const clock = fixedClock(Temporal.Instant.from("2026-09-06T01:00:00Z"));
const period = { from: kstMonth("2026-08"), to: kstMonth("2026-09") };
const baseRequest = {
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  awardMethodCodeValueId: 31n,
  binWidth: bidRate(canonicalDecimal("0.010", 3)),
  granularity: "total",
  period,
} as const;

describe("mart 낙찰률 분포 PostgreSQL 경계", () => {
  test("남산초 실관측 92회차를 코호트로 나눠 세 층이 같은 최빈·중앙 칸을 낸다", async () => {
    await withSeededDatabase(async (client) => {
      const reader = new DrizzleWinRateDistributionReader(drizzle({ client }));
      const useCase = new FindWinRateDistribution(reader, clock);

      const floor90 = await runEffect(useCase, { ...baseRequest, cohort: { scope: "national" } });
      expect(floor90.meta.sampleCount).toBe(82);
      expect(floor90.bins).toHaveLength(24);
      expect(floor90.modeRange).toEqual({
        from: { value: "90.000", unit: "percentage-points" },
        to: { value: "90.010", unit: "percentage-points" },
        count: 20,
        share: { value: "0.243902", unit: "ratio" },
      });
      expect(floor90.medianBin).toEqual({
        from: { value: "90.030", unit: "percentage-points" },
        to: { value: "90.040", unit: "percentage-points" },
      });
      // 낙찰방식 33 코호트 77건이 섞였다면 표본 수가 159가 된다.
      expect(floor90.bins.find((bin) => bin.from.value === "90.000")?.count).toBe(20);

      const floor88 = await runEffect(useCase, {
        ...baseRequest,
        cohort: { scope: "national" },
        floorRate: bidRate(canonicalDecimal("88.000", 3)),
      });
      expect(floor88.meta.sampleCount).toBe(10);
      expect(floor88.bins).toHaveLength(5);
      expect(floor88.modeRange?.count).toBe(4);
      expect(floor88.medianBin?.from.value).toBe("88.030");
    });
  }, 240_000);

  test("네 모집단이 모두 실데이터를 내고 달별 칸의 합이 상위 칸과 같다", async () => {
    await withSeededDatabase(async (client) => {
      const reader = new DrizzleWinRateDistributionReader(drizzle({ client }));
      const useCase = new FindWinRateDistribution(reader, clock);

      const samples = await Promise.all([
        runEffect(useCase, { ...baseRequest, cohort: { scope: "national" } }),
        runEffect(useCase, { ...baseRequest, cohort: { scope: "province", regionCodeValueId: 41n } }),
        runEffect(useCase, { ...baseRequest, cohort: { scope: "district", regionCodeValueId: 43n } }),
        runEffect(useCase, { ...baseRequest, cohort: { scope: "organization", organizationId: organizationId(3101n) } }),
      ]);
      expect(samples.map((sample) => sample.meta.sampleCount)).toEqual([82, 12, 5, 4]);
      // 지역 축이 있는 모집단만 그 지역의 보유율을 본다. 전국은 지역 축이 없는 행을 본다.
      expect(samples.map((sample) => sample.meta.coverage)).toEqual(["unknown", "none", "none", "unknown"]);

      const monthly = await runEffect(useCase, { ...baseRequest, cohort: { scope: "national" }, granularity: "month" });
      expect(monthly.months.map((month) => month.month)).toEqual(["2026-08", "2026-09"]);
      const summed = new Map<string, number>();
      for (const month of monthly.months) {
        for (const bin of month.bins ?? []) summed.set(bin.from.value, (summed.get(bin.from.value) ?? 0) + bin.count);
      }
      expect(monthly.bins.map((bin) => [bin.from.value, bin.count]))
        .toEqual([...summed.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
    });
  }, 240_000);

  test("코호트 조회가 unique 코호트 key index로 닫히는 실측을 증거로 남긴다", async () => {
    await withSeededDatabase(async (client) => {
      const plan = await client.unsafe(`
        explain (analyze, buffers, format text)
        select summary.month_kst, summary.bin_lower, summary.bin_width, summary.attempt_count
        from mart.win_rate_distribution_monthly summary
        where summary.build_id = (select active.build_id from mart.build active
                                   where active.mart_name = 'win_rate_distribution_monthly'
                                     and active.status = 'active')
          and summary.scope = 'national'
          and summary.region_code_value_id is null
          and summary.organization_id is null
          and summary.item_code_value_id is null
          and summary.floor_rate = 90.000::numeric
          and summary.award_method_code_value_id = 31::bigint
          and summary.month_kst between '2026-08-01'::date and '2026-09-01'::date
        order by summary.month_kst, summary.bin_lower
      `);
      const text = plan.map((row) => Object.values(row)[0]).join("\n");
      const [{ count }] = await client.unsafe(
        "select count(*)::int as count from mart.win_rate_distribution_monthly",
      ) as unknown as [{ count: number }];
      const reader = new DrizzleWinRateDistributionReader(drizzle({ client }));
      const monthly = await runEffect(new FindWinRateDistribution(reader, clock), {
        ...baseRequest,
        cohort: { scope: "national" },
        granularity: "month",
        period: { from: kstMonth("2025-10"), to: kstMonth("2026-09") },
      });
      // 증거 문서(`docs/evidence/2026-09-06-win-rate-distribution-scan.md`)에 옮겨 적을 실측이다.
      // test가 문서를 직접 쓰면 검사 실행이 추적 파일을 더럽혀 CI가 drift로 읽는다.
      console.info(`[EAT-38] rows=${count} responseBytes=${JSON.stringify(monthly).length}\n${text}`);
      // 계약이 요구하는 것은 "index를 쓴다"가 아니라 "읽는 행이 코호트로 닫힌다"이다.
      expect(text).toContain("Index");
      expect(monthly.bins.length).toBeLessThanOrEqual(4096);
    });
  }, 240_000);
});

async function runEffect(
  useCase: FindWinRateDistribution,
  input: Parameters<FindWinRateDistribution["execute"]>[0],
) {
  const { EffectRunner } = await import("../platform/effect/effect-runner");
  return new EffectRunner().run(useCase.execute(input));
}
