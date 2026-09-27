// docker PostgreSQL이 필요한 통합 테스트이며 `organization-attempts.fixture.ts`의 build 501과 분석 코호트 표본을 쓴다.
// 여기서만 확인되는 것은 페이지 SQL이다 — 커서 튜플이 같은 build·조건 집합에서 다음 자리를 정하는지, 전체 수와
// 줄이 시간축과 같은 코호트에서 나오는지, 다른 목록의 커서를 거절하는지는 실제 질의를 돌려야 닫힌다.
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AnalysisHistoryQuery } from "../modules/procurement/application/analysis-history-reader";
import { DrizzleAnalysisHistoryReader } from "../modules/procurement/infrastructure/drizzle/drizzle-analysis-history-reader";
import { kstDayAfter, kstDayStart, kstDate } from "../modules/procurement/domain/kst-day";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { analysisExtraSeed } from "../../fixtures/analysis-cohort.fixture";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";

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
  overlayOrganizationIds: [],
  comparisonScope: { kind: "national" },
  population: "target",
  buildId: 501n,
  cursorAttemptId: null,
  limit: 2,
} as const satisfies AnalysisHistoryQuery;

test("이력 페이지는 시간축과 같은 코호트에서 최신순으로 나눠 읽고 커서로 빠짐없이 이어진다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAnalysisHistoryReader(drizzle({ client }));

    const first = await reader.readPage(baseQuery);
    if (first.kind !== "page") throw new Error("page여야 한다");
    // 기관 회차는 셋이다. 격리된 106과 낙찰 관측이 없는 104는 그림처럼 표에도 없다.
    expect(first.totalCount).toBe(3);
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await reader.readPage({ ...baseQuery, cursorAttemptId: first.rows.at(-1)!.attemptId });
    if (second.kind !== "page") throw new Error("page여야 한다");
    expect(second.rows).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    const all = [...first.rows, ...second.rows];
    expect(all.map((row) => row.attemptId).toSorted()).toEqual([200n, 201n, 202n]);
    // 날짜 기준(개찰) 최신순이다. 같은 시각이면 회차 id 역순으로 끝까지 순서가 닫힌다.
    for (let index = 1; index < all.length; index += 1) {
      const previous = all[index - 1]!.openedAt!.epochMilliseconds;
      const current = all[index]!.openedAt!.epochMilliseconds;
      expect(previous >= current).toBe(true);
    }
  }, async (client) => {
    await client.unsafe(analysisExtraSeed);
  });
}, 180_000);

test("이력 줄은 기관 이름을 관측 라벨에서, 품목을 다리 행의 원자로 싣는다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAnalysisHistoryReader(drizzle({ client }));
    const page = await reader.readPage({ ...baseQuery, limit: 10 });
    if (page.kind !== "page") throw new Error("page여야 한다");
    const byId = new Map(page.rows.map((row) => [row.attemptId, row]));
    // 운영처럼 canonical_name은 비어 있고 이름은 기관 코드의 가장 나중 관측 라벨이다(EAT-278).
    expect(byId.get(200n)?.organizationName).toBe("창원 남산초등학교");
    expect(byId.get(200n)?.items).toEqual(["육류"]);
    expect(byId.get(201n)?.items).toEqual(["농산물"]);
    expect(byId.get(200n)?.assessmentRate).toBeDefined();
  }, async (client) => {
    await client.unsafe(analysisExtraSeed);
  });
}, 180_000);

test("비교 집단은 같은 조건의 전국 회차를 세고 다른 목록의 커서는 거절한다", async () => {
  await withSeededDatabase(async ({ client }) => {
    const reader = new DrizzleAnalysisHistoryReader(drizzle({ client }));
    const comparison = await reader.readPage({ ...baseQuery, population: "comparison", limit: 50 });
    if (comparison.kind !== "page") throw new Error("page여야 한다");
    // 시간축의 comparisonTotal과 같은 여섯이다. 표의 행과 그림의 표본이 같은 집합이다.
    expect(comparison.totalCount).toBe(6);
    expect(comparison.rows).toHaveLength(6);
    // 203은 다른 기관의 회차라 이 기관 목록의 커서가 될 수 없다. 엉뚱한 자리부터 읽지 않고 거절한다.
    expect(await reader.readPage({ ...baseQuery, cursorAttemptId: 203n })).toEqual({ kind: "cursor-not-found" });
  }, async (client) => {
    await client.unsafe(analysisExtraSeed);
  });
}, 180_000);
