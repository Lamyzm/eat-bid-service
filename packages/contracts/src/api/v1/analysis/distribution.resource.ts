/** @module 책임: 분석 낙찰값 분포의 사정률 구간 한 칸과 구간 밖 건수, 기준 build meta resource를 정의한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { observedBidRateWireSchema } from "../../../values/rate";

/**
 * 사정률 구간 하나와 두 집단의 건수다. 경계는 `[from, to)`이고 **두 집단에 같은 경계**를 쓴다 — 경계가
 * 다르면 같은 막대 높이가 다른 구간을 말한다(analysis-common-contracts §5). 비중은 싣지 않는다. 비중의
 * 분모(집단 전체 수)가 응답에 있으므로 화면이 계산하고, 두 곳에서 반올림이 갈리지 않는다.
 */
export const analysisDistributionBinSchema = z.strictObject({
  from: observedBidRateWireSchema,
  to: observedBidRateWireSchema,
  targetCount: nonNegativeCountSchema,
  comparisonCount: nonNegativeCountSchema,
}).meta({ id: "AnalysisDistributionBin" });

/**
 * 구간 밖 건수다. 첫 구간 아래(하한 미만 낙찰 포함)와 마지막 구간 이상을 따로 센다. 이 수를 빼면
 * 막대 합이 전체와 달라져, 보이지 않는 회차가 없는 것처럼 읽힌다(AGENTS 3).
 */
export const analysisDistributionOutsideSchema = z.strictObject({
  below: nonNegativeCountSchema,
  above: nonNegativeCountSchema,
}).meta({ id: "AnalysisDistributionOutside" });

export const analysisDistributionMetaSchema = z.strictObject({
  /** 각 집단의 전체 회차 수다. 구간 합 + 구간 밖 합과 같다. */
  targetTotal: nonNegativeCountSchema,
  comparisonTotal: nonNegativeCountSchema,
  build: martBuildLineageSchema,
}).meta({ id: "AnalysisDistributionMeta" });

export type AnalysisDistributionBin = z.infer<typeof analysisDistributionBinSchema>;
