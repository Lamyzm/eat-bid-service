// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.fixture.ts`의 build 501과 분석 코호트 표본을 쓴다.
// 여기서만 확인되는 것은 구간 SQL이다 — milli 정수 나눗셈의 칸 경계, 아래·위 밖 모으기, 그리고 "구간 합 + 밖 = 전체
// = 시간축 표본 수"라는 등식은 실제 질의를 돌려야 닫힌다.
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AnalysisDistributionQuery } from "../modules/procurement/application/analysis-distribution-reader";
import { DrizzleAnalysisDistributionReader } from "../modules/procurement/infrastructure/drizzle/drizzle-analysis-distribution-reader";
import { kstDayAfter, kstDayStart, kstDate } from "../modules/procurement/domain/kst-day";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { analysisExtraSeed } from "../../fixtures/analysis-cohort.fixture";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";

const query = {
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
  overlayOrganizationIds: [],
  comparisonScope: { kind: "national" },
  binFromMilli: 90_000n,
  binWidthMilli: 100n,
  binCount: 10,
} as const satisfies AnalysisDistributionQuery;

function sum(counts: ReadonlyMap<number, number>): number {
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

test("분포는 두 집단을 같은 칸 경계로 세고 칸 밖까지 더하면 시간축 표본 수와 같다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAnalysisDistributionReader(drizzle({ client }));
    const reading = await reader.readDistribution(query);
    expect(reading.lineage?.buildId).toBe(501n);
    // 시간축의 targetTotal 3, comparisonTotal 6과 같은 집합이다(analysis-time-series 통합 시험).
    expect(sum(reading.target)).toBe(3);
    expect(sum(reading.comparison)).toBe(6);
    // 칸 번호는 -1(아래 밖) ~ 10(위 밖) 안에만 선다.
    for (const bin of [...reading.target.keys(), ...reading.comparison.keys()]) {
      expect(bin).toBeGreaterThanOrEqual(-1);
      expect(bin).toBeLessThanOrEqual(10);
    }
    // 91.000은 90.000 + 10칸의 끝이라 위 밖이다. 반개구간 `[from,to)`의 오른쪽 끝은 다음 칸이다.
    expect(reading.comparison.get(10)).toBe(1);
  }, async (client) => {
    await client.unsafe(analysisExtraSeed);
  });
}, 180_000);
