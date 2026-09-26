/** @module 책임: 분석 낙찰값 분포 application 결과를 공개 V1 분포 응답으로 직렬화하는 순수 presenter다. */
import type { AnalysisDistributionV1Response } from "@eatbid/contracts";
import { martBuildLineageWire } from "../../../../platform/http/wire";
import { rateMilliText } from "../../application/distribution-statistics";
import type { AnalysisDistributionResult } from "../../application/find-analysis-distribution";

function rateWire(milli: bigint) {
  return { value: rateMilliText(milli), unit: "percentage-points" as const };
}

export function toAnalysisDistributionResponse(result: AnalysisDistributionResult): AnalysisDistributionV1Response {
  return {
    bins: result.bins.map((bin) => ({
      from: rateWire(bin.fromMilli),
      to: rateWire(bin.toMilli),
      targetCount: bin.targetCount,
      comparisonCount: bin.comparisonCount,
    })),
    targetOutside: result.targetOutside,
    comparisonOutside: result.comparisonOutside,
    meta: {
      targetTotal: result.targetTotal,
      comparisonTotal: result.comparisonTotal,
      build: martBuildLineageWire(result.lineage),
    },
  };
}
