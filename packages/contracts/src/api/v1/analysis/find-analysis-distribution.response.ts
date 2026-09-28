/** @module 책임: 분석 낙찰값 분포 조회의 공개 V1 응답 봉투 계약을 소유한다. */
import { z } from "zod";

import {
  analysisDistributionBinSchema,
  analysisDistributionMetaSchema,
  analysisDistributionOutsideSchema,
} from "./distribution.resource";

/**
 * 기관과 비교군을 **한 응답**으로 낸다. 따로 물으면 같은 조건인데 서로 다른 build를 읽어 두 막대가 다른
 * 집합을 말할 수 있다. 활성 build가 없으면 구간은 빈 배열이고 전체는 0이며 `meta.build.buildId`가 null이다.
 */
export const analysisDistributionV1ResponseSchema = z.strictObject({
  bins: z.array(analysisDistributionBinSchema).max(64),
  targetOutside: analysisDistributionOutsideSchema,
  comparisonOutside: analysisDistributionOutsideSchema,
  meta: analysisDistributionMetaSchema,
}).meta({ id: "EatbidApiV1AnalysisDistribution" });

export type AnalysisDistributionV1Response = z.infer<typeof analysisDistributionV1ResponseSchema>;
