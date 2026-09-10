/** @module 책임: 낙찰률 분포 계산 결과(milli 정수 칸·요약)를 공개 V1 응답의 십진 문자열 봉투로 직렬화하는 순수 presenter다. */
import {
  instantCodec,
  type DistributionBin,
  type WinRateDistributionMeta,
  type WinRateDistributionV1Response,
} from "@eatbid/contracts";
import { z } from "zod";
import {
  rateMilliText,
  ratioMillionthsText,
  type DistributionBinBoundary,
  type DistributionBinCount,
} from "../../application/distribution-statistics";
import type { WinRateDistributionResult } from "../../application/find-win-rate-distribution";
import { cohortOrganizationId, cohortRegionCodeValueId } from "../../domain/distribution-cohort";

function binResource(bin: DistributionBinCount, widthMilli: bigint): DistributionBin {
  return {
    from: { value: rateMilliText(bin.lowerMilli), unit: "percentage-points" },
    to: { value: rateMilliText(bin.lowerMilli + widthMilli), unit: "percentage-points" },
    count: bin.count,
  };
}

function boundaryResource(boundary: DistributionBinBoundary) {
  return {
    from: { value: rateMilliText(boundary.fromMilli), unit: "percentage-points" } as const,
    to: { value: rateMilliText(boundary.toMilli), unit: "percentage-points" } as const,
  };
}

function metaResource(result: WinRateDistributionResult): WinRateDistributionMeta {
  const { input, period, lineage } = result;
  const organizationIdentity = cohortOrganizationId(input.cohort);
  const regionIdentity = cohortRegionCodeValueId(input.cohort);
  return {
    sampleCount: result.total.sampleCount,
    // 분포 mart에 품목 축이 없다는 사실을 자리를 비우는 대신 명시적 null로 말한다(설계 §3.2).
    item: null,
    scope: input.cohort.scope,
    regionCodeValueId: regionIdentity === null ? null : regionIdentity.toString(10),
    organizationId: organizationIdentity === null ? null : organizationIdentity.toString(10),
    floorRate: { value: input.floorRate, unit: "percentage-points" },
    awardMethod: input.awardMethodCodeValueId.toString(10),
    binWidth: { value: input.binWidth, unit: "percentage-points" },
    period: { from: period.from, to: period.to },
    // 계보는 행이 아니라 이 결과를 읽은 build 하나가 갖는다(ADR 0034).
    buildId: lineage === null ? null : lineage.buildId.toString(10),
    sourceReleaseId: lineage?.sourceReleaseId ?? null,
    calcVersion: lineage?.calcVersion ?? null,
    computedAt: lineage === null ? null : z.encode(instantCodec, lineage.computedAt),
    coverage: result.coverage,
    regionScheme: lineage?.regionScheme ?? null,
  };
}

export function toWinRateDistributionResponse(result: WinRateDistributionResult): WinRateDistributionV1Response {
  const { total, widthMilli } = result;
  return {
    bins: total.bins.map((bin) => binResource(bin, widthMilli)),
    medianBin: total.medianBin === null ? null : boundaryResource(total.medianBin),
    modeRange: total.modeRange === null ? null : {
      ...boundaryResource(total.modeRange),
      count: total.modeRange.count,
      share: { value: ratioMillionthsText(total.modeRange.shareMillionths), unit: "ratio" },
    },
    // 달별 칸은 요청이 달 단위를 골랐을 때만 싣는다. 요약(표본 수·보유율)은 언제나 실린다.
    months: result.months.map((month) => ({
      month: month.month,
      sampleCount: month.sampleCount,
      coverage: month.coverage,
      bins: result.input.granularity === "month" ? month.bins.map((bin) => binResource(bin, widthMilli)) : null,
    })),
    meta: metaResource(result),
  };
}
