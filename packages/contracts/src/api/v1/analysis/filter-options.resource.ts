/** @module 책임: 공통 분석 필터의 실제 선택지와 품목 미지원·조회 불가를 구분한 wire 형태를 소유한다. */
import { z } from "zod";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { codeReferenceSchema } from "../../../values/code-reference";
import { bidRateWireSchema } from "../../../values/rate";
import { analysisPeriodSchema, analysisRegionSchemeSchema } from "./filter.resource";

export const analysisRegionOptionSchema = codeReferenceSchema.safeExtend({
  scheme: analysisRegionSchemeSchema,
  parentCodeValueId: positiveBigintTextSchema.nullable(),
  active: z.boolean(),
});
// 빈 ready 목록은 지원 코드 0개다. 아직 매핑을 지원하지 않는 것과 조회 실패를 0개로 바꾸지 않는다.
export const analysisItemOptionsSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready"), options: z.array(codeReferenceSchema).max(4096) }),
  z.strictObject({ state: z.literal("unsupported") }),
  z.strictObject({ state: z.literal("unavailable") }),
]);
export const analysisFilterOptionsSchema = z.strictObject({
  regions: z.array(analysisRegionOptionSchema).max(4096),
  floorRates: z.array(bidRateWireSchema).max(256),
  awardMethods: z.array(codeReferenceSchema).max(256),
  itemOptions: analysisItemOptionsSchema,
  // 관측된 양끝일 뿐 중간 구간의 완전 수집 증명이 아니다. null은 범위를 확인하지 못했다는 뜻이다.
  availablePeriods: z.strictObject({ opened: analysisPeriodSchema.nullable(), announced: analysisPeriodSchema.nullable() }),
}).meta({ id: "AnalysisFilterOptions" });
export type AnalysisFilterOptions = z.infer<typeof analysisFilterOptionsSchema>;
