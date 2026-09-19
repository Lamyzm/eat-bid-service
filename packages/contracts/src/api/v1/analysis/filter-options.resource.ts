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
// 품목 선택지는 여기 없다. 값이 계약 안의 원자 여덟이라 화면이 사전을 물을 이유가 없다(PDR-0007).
// 예전의 `itemOptions`는 코드값 id를 받던 시절의 자리였고, 그 상태가 줄곧 `unsupported`여서 화면에는
// "기관 품목별 조회는 준비 중"만 남아 있었다.
export const analysisFilterOptionsSchema = z.strictObject({
  regions: z.array(analysisRegionOptionSchema).max(4096),
  floorRates: z.array(bidRateWireSchema).max(256),
  awardMethods: z.array(codeReferenceSchema).max(256),
  // 관측된 양끝일 뿐 중간 구간의 완전 수집 증명이 아니다. null은 범위를 확인하지 못했다는 뜻이다.
  availablePeriods: z.strictObject({ opened: analysisPeriodSchema.nullable(), announced: analysisPeriodSchema.nullable() }),
}).meta({ id: "AnalysisFilterOptions" });
export type AnalysisFilterOptions = z.infer<typeof analysisFilterOptionsSchema>;
