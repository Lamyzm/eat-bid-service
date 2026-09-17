// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.fixture.ts`의 build 501을 함께 쓴다.
// 여기서만 확인되는 것은 SQL이 접는 칸이다 — KST 경계, 명단 범위의 null 처리, 품목 다리, 격리 행 제외,
// 그리고 "밀도 합 = 비교군 표본 수"라는 acceptance 1의 등식은 실제 질의를 돌려야 닫힌다.
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { DrizzleAnalysisTimeSeriesReader } from "../modules/procurement/infrastructure/drizzle/drizzle-analysis-time-series-reader";
import type { AnalysisTimeSeriesQuery } from "../modules/procurement/application/analysis-time-series-reader";
import { kstDayAfter, kstDayStart, kstDate } from "../modules/procurement/domain/kst-day";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";

/**
 * 여섯 회차를 KST 세 날에 나눠 심는다. `auction_revision_id`를 하나로 재사용하는 이유는 이 조회가
 * 해석 자체를 읽지 않고 요약 행만 읽기 때문이다 — 해석마다 원본 사슬을 심으면 확인하려는 것이 아니라
 * fixture를 확인하게 된다.
 */
const extraSeed = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value values (12, 'eat:award-method', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values (31, 12, '003');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  select id, 'eat', 'external-' || id from generate_series(200, 205) as id;
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst, quarantine_reason)
  values
    -- KST 8월 4일 세 건. 00시 정각과 23시 59분이 같은 날 칸에 들어가야 한다.
    (501, 200, 208, 41, '축산', '2026-08-01T00:00:00Z', '2026-08-03T15:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.000, null, null, null, null,
     10, null, null, null, null, null, 'observed', '2026-08-01', null),
    (501, 201, 208, 41, '농산', '2026-08-01T00:00:00Z', '2026-08-03T20:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.050, null, null, null, null,
     20, null, null, null, null, null, 'observed', '2026-08-01', null),
    (501, 202, 208, 41, '축산', '2026-08-01T00:00:00Z', '2026-08-04T14:59:59Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.199, null, null, null, null,
     null, null, null, null, null, null, 'observed', '2026-08-01', null),
    -- KST 8월 5일 두 건. 다른 기관이라 비교군에만 든다.
    (501, 203, 208, 43, '축산', '2026-08-01T00:00:00Z', '2026-08-04T15:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.100, null, null, null, null,
     15, null, null, null, null, null, 'observed', '2026-08-01', null),
    (501, 204, 208, 43, '축산', '2026-08-01T00:00:00Z', '2026-08-04T16:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.120, null, null, null, null,
     30, null, null, null, null, null, 'observed', '2026-08-01', null),
    -- KST 9월 1일 한 건. 달이 바뀌는 자리를 UTC로 자르면 8월로 밀린다.
    (501, 205, 208, 43, '축산', '2026-08-20T00:00:00Z', '2026-08-31T15:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 91.000, null, null, null, null,
     12, null, null, null, null, null, 'observed', '2026-09-01', null);
  -- 낙찰 관측이 없는 회차와 격리된 회차는 모집단이 아니다(AGENTS 3, EAT-199). 둘 다 fixture에 이미
  -- 있는 행이라 조건만 이 코호트로 옮겨, 술어가 빠지면 표본 수가 늘어나는 모양으로 만든다.
  update mart.org_round_summary
     set award_method_code_value_id = 31, opened_at = '2026-08-03T20:00:00Z', list_count = 14
   where build_id = 501 and auction_attempt_id = 104;
  update mart.org_round_summary
     set floor_rate = 90.000, award_method_code_value_id = 31, opened_at = '2026-08-03T20:00:00Z',
         awarded_assessment_rate = 90.400, list_count = 14
   where build_id = 501 and auction_attempt_id = 106;
  insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
  values (501, 200, 7), (501, 201, 9), (501, 202, 7);
`;

const baseQuery = {
  targetOrganizationId: organizationId(41n),
  excludeAttemptId: null,
  from: kstDayStart(kstDate("2026-08-01")),
  before: kstDayAfter(kstDate("2026-09-30")),
  dateBasis: "opened",
  floorRateMilli: 90_000n,
  awardMethodCodeValueId: 31n,
  listCountMin: null,
  listCountMax: null,
  targetItemCodeValueId: null,
  comparisonScope: { kind: "national" },
  timeResolution: "day",
  rateBinWidthMilli: 100n,
  targetPointLimit: 5_000,
  // 밀도 갈래를 강제한다. 실제 상한은 2천이라 표본 수천 건을 심지 않으면 그 갈래가 한 번도 안 돈다.
  comparisonPointLimit: 0,
} as const satisfies AnalysisTimeSeriesQuery;

test("분석 시간축 질의가 KST 칸·명단 범위·품목 다리를 실제 PostgreSQL에서 그대로 접는다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAnalysisTimeSeriesReader(drizzle({ client }));

    const all = await reader.readTimeSeries(baseQuery);
    // 기관 점 셋과 전국 여섯. 격리된 106과 낙찰 관측이 없는 104는 어느 쪽에도 없다.
    expect(all.targetPoints.map((point) => point.attemptId)).toEqual([200n, 201n, 202n]);
    expect(all.targetTotal).toBe(3);
    expect(all.comparisonTotal).toBe(6);
    // 전국 비교군은 기관 관측을 전부 품으므로 겹침 수가 기관 표본 수와 같다.
    expect(all.overlapCount).toBe(3);
    expect(all.comparisonTruncated).toBe(false);

    if (all.comparison.kind !== "density") throw new Error("밀도여야 한다");
    expect(all.comparison.cells.map((cell) => [cell.fromAt.toString(), cell.rateFromMilli, cell.count])).toEqual([
      // KST 8월 4일 00시. 90.000과 90.050은 같은 0.1%p 칸이다.
      ["2026-08-03T15:00:00Z", 90_000n, 2],
      ["2026-08-03T15:00:00Z", 90_100n, 1],
      ["2026-08-04T15:00:00Z", 90_100n, 2],
      ["2026-08-31T15:00:00Z", 91_000n, 1],
    ]);
    // acceptance 1: 밀도 칸의 합은 비교군 표본 수와 같아야 한다. 표본을 뽑아 놓고 전체인 척하지 않는다.
    expect(all.comparison.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(all.comparisonTotal);

    // 명단 크기를 모르는 202는 범위를 걸면 빠진다. 미확인을 관측으로 바꾸지 않는다(AGENTS 3).
    const ranged = await reader.readTimeSeries({ ...baseQuery, listCountMin: 12, listCountMax: 24 });
    expect(ranged.targetPoints.map((point) => point.attemptId)).toEqual([201n]);
    expect(ranged.comparisonTotal).toBe(3);
    expect(ranged.overlapCount).toBe(1);

    // 품목은 기관에만 걸린다. 비교군은 언제나 전체 품목이다(PDR-0006).
    const item = await reader.readTimeSeries({ ...baseQuery, targetItemCodeValueId: 7n });
    expect(item.targetPoints.map((point) => point.attemptId)).toEqual([200n, 202n]);
    expect(item.comparisonTotal).toBe(6);

    // 지금 보고 있는 회차는 두 집단 모두에서 빠진다.
    const excluded = await reader.readTimeSeries({ ...baseQuery, excludeAttemptId: 200n });
    expect(excluded.targetTotal).toBe(2);
    expect(excluded.comparisonTotal).toBe(5);

    // 달 눈금에서도 9월 1일 개찰이 8월로 밀리지 않는다.
    const monthly = await reader.readTimeSeries({ ...baseQuery, timeResolution: "month" });
    if (monthly.comparison.kind !== "density") throw new Error("밀도여야 한다");
    expect([...new Set(monthly.comparison.cells.map((cell) => cell.fromAt.toString()))]).toEqual([
      "2026-07-31T15:00:00Z",
      "2026-08-31T15:00:00Z",
    ]);

    // 좁은 범위에서는 실제 점이 온다. 점을 눌러 그 회차로 건너갈 수 있어야 한다.
    const points = await reader.readTimeSeries({ ...baseQuery, comparisonPointLimit: 2_000 });
    if (points.comparison.kind !== "points") throw new Error("점이어야 한다");
    expect(points.comparison.points.map((point) => point.attemptId)).toEqual([200n, 201n, 202n, 203n, 204n, 205n]);

    // 기관 점 상한은 잘린 목록과 잘리기 전 전체 수를 함께 준다.
    const capped = await reader.readTimeSeries({ ...baseQuery, targetPointLimit: 1 });
    expect(capped.targetPoints).toHaveLength(1);
    expect(capped.targetTotal).toBe(3);

    // 계보와 봉인 입력 기준 시각은 같은 활성 build를 가리킨다.
    expect(all.lineage?.buildId).toBe(501n);
    expect(all.sourceCutoffAt?.toString()).toBe("2026-09-04T00:00:00Z");
    expect(all.coverage.map((entry) => [entry.month, entry.target, entry.comparison])).toEqual([
      ["2026-08", "complete", "complete"],
      ["2026-09", "unknown", "unknown"],
    ]);

    expect(await reader.organizationExists(41n)).toBe(true);
    expect(await reader.organizationExists(99_999n)).toBe(false);
  }, async (client) => {
    await client.unsafe(extraSeed);
  });
}, 180_000);
