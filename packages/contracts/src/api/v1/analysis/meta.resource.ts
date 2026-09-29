/** @module 책임: 분석 표본·교집합·기간별 수집 상태와 자료 준비 불가를 구별하는 공통 meta를 소유한다. */
import { z } from "zod";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { instantTextSchema } from "../../../atoms/instant";
import { martCoverageSchema } from "../../../values/mart-lineage";
import { analysisFilterValueSchema, analysisPeriodSchema } from "./filter.resource";
import { analysisSnapshotSchema } from "./snapshot.resource";

export const analysisFreshnessSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unknown"), checkedAt: instantTextSchema.nullable() }),
  z.strictObject({ state: z.literal("current"), checkedAt: instantTextSchema }),
  z.strictObject({
    state: z.enum(["updating", "delayed"]),
    checkedAt: instantTextSchema,
    oldestPendingPublicationAt: instantTextSchema,
  }),
]);
/**
 * 한 달에 발행 원장이 적고 뺀 공고 수다(ADR 0061 결정 6). 보유율 판정이나 표본 수와 한 비율로 접지 않고 따로
 * 싣는다 — 섞으면 "다 들어왔다"와 "빼고 다 들어왔다"가 같은 값이 된다. 지역·기관 축이 없는 전국 수이며, 조각이
 * 요청 기간으로 잘려도 그 달 전체의 수다. `unresolvedAuctionCount`는 그 가운데 아직 반영되지 못한 공고 수다.
 */
export const analysisPeriodExclusionsSchema = z.strictObject({
  excludedAuctionCount: nonNegativeCountSchema,
  unresolvedAuctionCount: nonNegativeCountSchema,
}).meta({ id: "AnalysisPeriodExclusions" });
export const analysisPeriodCoverageSchema = z.strictObject({
  period: analysisPeriodSchema,
  target: martCoverageSchema,
  comparison: martCoverageSchema,
  exclusions: analysisPeriodExclusionsSchema,
});

/** 준비 불가에는 표본 수를 넣지 않는다. 관측된 0건과 미발행을 같은 숫자로 화면에 전달하지 않는다. */
export const analysisMetaSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    effectiveFilter: analysisFilterValueSchema,
    snapshot: analysisSnapshotSchema,
    targetSampleCount: nonNegativeCountSchema,
    comparisonSampleCount: nonNegativeCountSchema,
    overlapCount: nonNegativeCountSchema,
    periodCoverage: z.array(analysisPeriodCoverageSchema).min(1).max(4096),
    freshness: analysisFreshnessSchema,
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    effectiveFilter: analysisFilterValueSchema,
    reason: z.enum(["snapshot-unavailable", "snapshot-expired", "input-unconfirmed"]),
  }),
]).meta({ id: "AnalysisMeta" });
export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;
