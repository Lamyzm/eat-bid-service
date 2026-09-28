import { describe, expect, test } from "bun:test";
import { bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import { kstDate } from "../domain/kst-day";
import { organizationId } from "../domain/organization-id";
import type { AnalysisHistoryQuery, AnalysisHistoryReader } from "./analysis-history-reader";
import type { AnalysisTimeSeriesReader } from "./analysis-time-series-reader";
import {
  AnalysisHistoryBuildChanged,
  AnalysisHistoryCursorInvalid,
  FindAnalysisHistory,
  type FindAnalysisHistoryInput,
} from "./find-analysis-history";
import type { MartBuildLineage } from "./mart-build-lineage";

const lineage: MartBuildLineage = {
  buildId: 501n,
  sourceReleaseId: "00000000-0000-0000-0000-000000000501",
  calcVersion: "mart-r2",
  computedAt: Temporal.Instant.from("2026-09-20T00:00:00Z"),
  coverage: null,
  regionScheme: null,
};

const input: FindAnalysisHistoryInput = {
  targetOrganizationId: organizationId(41n),
  excludeAttemptId: null,
  period: { from: kstDate("2026-08-01"), to: kstDate("2026-09-30") },
  dateBasis: "opened",
  comparisonScope: { kind: "national" },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  awardMethodCodeValueId: 31n,
  listCountMin: null,
  listCountMax: null,
  itemFilter: { kind: "all" },
  population: "target",
  cursorAttemptId: null,
  limit: 50,
  expectedBuildId: null,
};

const axes = {
  organizationExists: async () => true,
  regionExists: async () => true,
} as unknown as AnalysisTimeSeriesReader;

function readerWith(active: MartBuildLineage | null, seen: AnalysisHistoryQuery[] = []): AnalysisHistoryReader {
  return {
    activeLineage: async () => active,
    readPage: async (query) => {
      seen.push(query);
      return query.cursorAttemptId === 999n
        ? { kind: "cursor-not-found" }
        : { kind: "page", rows: [], hasMore: false, totalCount: 0 };
    },
  };
}

const run = (reader: AnalysisHistoryReader, value: FindAnalysisHistoryInput) =>
  new EffectRunner().run(new FindAnalysisHistory(reader, axes).execute(value));

describe("분석 전체 이력 use case", () => {
  test("첫 페이지는 지금 활성 build를 골라 읽고 그 build로 답한다", async () => {
    const seen: AnalysisHistoryQuery[] = [];
    const result = await run(readerWith(lineage, seen), input);
    expect(result.kind).toBe("page");
    expect(seen[0]?.buildId).toBe(501n);
  });

  test("다음 페이지의 build가 더 이상 활성이 아니면 이어 읽지 않고 거절한다", async () => {
    // 두 build의 줄을 한 목록에 섞으면 같은 회차가 두 번 나오거나 빠진다.
    await expect(run(readerWith(lineage), { ...input, expectedBuildId: 400n, cursorAttemptId: 200n }))
      .rejects.toBeInstanceOf(AnalysisHistoryBuildChanged);
  });

  test("활성 build가 없어졌는데 다음 페이지를 달라면 빈 목록이 아니라 거절이다", async () => {
    // 빈 목록으로 답하면 사용자는 이미 받은 줄이 마지막인 줄 안다.
    await expect(run(readerWith(null), { ...input, expectedBuildId: 501n, cursorAttemptId: 200n }))
      .rejects.toBeInstanceOf(AnalysisHistoryBuildChanged);
    expect((await run(readerWith(null), input)).kind).toBe("empty");
  });

  test("다른 목록의 커서는 요청 오류로 닫는다", async () => {
    await expect(run(readerWith(lineage), { ...input, expectedBuildId: 501n, cursorAttemptId: 999n }))
      .rejects.toBeInstanceOf(AnalysisHistoryCursorInvalid);
  });
});
