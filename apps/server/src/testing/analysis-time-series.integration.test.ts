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
  -- 시도와 시군구는 서로 다른 code scheme이다. 두 체계에 같은 숫자를 두어, 체계를 안 보고 id만
  -- 비교하는 회귀가 통과하지 못하게 만든다(AGENTS 6).
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (13, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
         (14, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values (48, 13, '48'), (49, 14, '48120'), (50, 14, '48250');
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
  -- 품목 원자는 우리 체계(`eatbid:auction-item`)의 코드값이다. 체계 없이 코드 문자열만 보고 조인하면
  -- 다른 어휘의 같은 글자를 잡으므로, 술어가 체계를 닫는지 여기서 확인된다(AGENTS 2·6).
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value values (15, 'eatbid:auction-item', 'product', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values (7, 15, '육류'), (9, 15, '농산물');
  insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
  values (501, 200, 7), (501, 201, 9), (501, 202, 7);
  -- 205는 지역이 번역되지 않은 회차다. 지역 모집단에서 빠지되 전국에는 남는다(ADR 0035 결정 6).
  update mart.org_round_summary
     set region_sido_code_value_id = 48,
         region_sigungu_code_value_id = case when auction_attempt_id = 202 then 50 else 49 end
   where build_id = 501 and auction_attempt_id between 200 and 204;
  -- 그 지역의 판정이 기관 코호트의 판정과 갈리는 달을 만든다. 전국 행만 있는 8월은 지역 판정이 없다.
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (501, 48, '2026-09-01', 10, 10, 10, 0, 'complete');
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
  itemFilter: { kind: "all" },
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

    // 품목은 두 집단에 같게 걸린다. 기관만 걸리고 비교군이 전체 품목이면 두 집단이 다른 질문에
    // 답한다(PDR-0007). 203~205는 다리 행이 없어 `품목 미확인`이다.
    const item = await reader.readTimeSeries({ ...baseQuery, itemFilter: { kind: "atoms", atoms: ["육류"], unknown: false } });
    expect(item.targetPoints.map((point) => point.attemptId)).toEqual([200n, 202n]);
    expect(item.comparisonTotal).toBe(2);

    // 공고가 품목을 말하지 않은 회차만 보는 조건이다. 전체의 3분의 1이라 값으로 고를 수 있어야 한다.
    const unknown = await reader.readTimeSeries({ ...baseQuery, itemFilter: { kind: "unknown" } });
    expect(unknown.targetPoints).toEqual([]);
    expect(unknown.comparisonTotal).toBe(3);

    // 함께 보려는 요청은 둘의 합이며, 조용히 한쪽만 주지 않는다.
    const both = await reader.readTimeSeries({ ...baseQuery, itemFilter: { kind: "atoms", atoms: ["육류"], unknown: true } });
    expect(both.comparisonTotal).toBe(5);

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

test("지역 비교는 체계가 고른 열로만 좁히고 번역되지 않은 회차를 그 모집단에서 뺀다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAnalysisTimeSeriesReader(drizzle({ client }));

    const sido = await reader.readTimeSeries({
      ...baseQuery,
      comparisonScope: { kind: "region", scheme: "eat:auction-location-sido", codeValueId: 48n },
    });
    // 205는 지역이 번역되지 않아 전국 여섯 중 다섯만 이 모집단에 든다.
    expect(sido.comparisonTotal).toBe(5);
    expect(sido.targetTotal).toBe(3);
    expect(sido.overlapCount).toBe(3);

    const sigungu = await reader.readTimeSeries({
      ...baseQuery,
      comparisonScope: { kind: "region", scheme: "eat:auction-location-sigungu", codeValueId: 49n },
    });
    expect(sigungu.comparisonTotal).toBe(4);
    // 기관의 셋 중 202는 다른 시군구라 겹치지 않는다. 지역 비교에서는 겹침이 기관 표본 수와 다르다.
    expect(sigungu.overlapCount).toBe(2);
    expect(sigungu.targetTotal).toBe(3);

    // 같은 숫자라도 체계가 다르면 다른 구역이다. 48은 시도에만 있고 49는 시군구에만 있다(AGENTS 6).
    expect(await reader.regionExists("eat:auction-location-sido", 48n)).toBe(true);
    expect(await reader.regionExists("eat:auction-location-sido", 49n)).toBe(false);
    expect(await reader.regionExists("eat:auction-location-sigungu", 49n)).toBe(true);
    expect(await reader.regionExists("eat:auction-location-sigungu", 48n)).toBe(false);

    // 비교군 보유율은 그 지역 행만 본다. 지역 행이 없는 달은 기관 쪽 판정으로 메우지 않는다.
    expect(sido.coverage.map((entry) => [entry.month, entry.target, entry.comparison])).toEqual([
      ["2026-08", "complete", "none"],
      ["2026-09", "unknown", "complete"],
    ]);
  }, async (client) => {
    await client.unsafe(extraSeed);
  });
}, 180_000);
