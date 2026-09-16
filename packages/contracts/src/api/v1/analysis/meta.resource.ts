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
export const analysisPeriodCoverageSchema = z.strictObject({
  period: analysisPeriodSchema,
  target: martCoverageSchema,
  comparison: martCoverageSchema,
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
