/** @module 책임: 기관과 eaT 공고지역·전국 분석이 공유하는 적용 필터의 wire 형태를 소유한다. */
import { z } from "zod";
import { CODE_SCHEME_NAMES } from "../../../atoms/code-scheme-names";
import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { bidRateWireSchema } from "../../../values/rate";

export const analysisDateBasisSchema = z.enum(["opened", "announced"]);
// 참가제한·행안부 지역은 같은 ID 형태여도 이 분석 축의 값이 아니다.
export const analysisRegionSchemeSchema = z.enum([
  CODE_SCHEME_NAMES.auctionLocationSido, CODE_SCHEME_NAMES.auctionLocationSigungu,
]);
export const analysisPeriodSchema = z.strictObject({
  from: kstDateTextSchema,
  to: kstDateTextSchema,
}).meta({ id: "AnalysisPeriod", description: "양끝 포함 KST 날짜. 실제 달력일과 역전 여부는 의미 parser에서 검증한다." });

export const analysisComparisonScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("national") }),
  z.strictObject({ kind: z.literal("region"), scheme: analysisRegionSchemeSchema, codeValueId: positiveBigintTextSchema }),
]);
export const analysisTargetItemFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("code"), codeValueId: positiveBigintTextSchema }),
]);
export const analysisListCountRangeSchema = z.strictObject({
  min: nonNegativeCountSchema.nullable(),
  max: nonNegativeCountSchema.nullable(),
}).meta({ id: "AnalysisListCountRange", description: "철회 행 포함 관측 명단 크기. 양끝 포함, null 경계는 제한 없음." });

/** 날짜 기준은 기간과 X축에 함께 적용한다. 품목은 기관에만 적용하며 비교군은 항상 전체 품목이다. */
export const analysisFilterValueSchema = z.strictObject({
  targetOrganizationId: positiveBigintTextSchema,
  excludeAttemptId: positiveBigintTextSchema.nullable(),
  period: analysisPeriodSchema,
  dateBasis: analysisDateBasisSchema,
  comparisonScope: analysisComparisonScopeSchema,
  floorRate: bidRateWireSchema,
  awardMethodCodeValueId: positiveBigintTextSchema,
  listCountRange: analysisListCountRangeSchema,
  targetItemFilter: analysisTargetItemFilterSchema,
}).meta({ id: "AnalysisFilterValue" });

export type AnalysisFilterValue = z.infer<typeof analysisFilterValueSchema>;
export type AnalysisPeriod = z.infer<typeof analysisPeriodSchema>;
