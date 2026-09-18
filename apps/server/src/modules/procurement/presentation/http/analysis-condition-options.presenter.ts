/** @module 책임: 조건 사전 읽기 결과를 공개 V1 응답 봉투로 직렬화한다. */
import type {
  AnalysisConditionOptionsV1Response,
  AnalysisOrganizationOption,
  AnalysisRegionCount,
  CodeReference,
} from "@eatbid/contracts";
import { bigintText, instantText } from "../../../../platform/http/wire";
import type {
  AnalysisConditionOptionsReading,
  AnalysisOrganizationOptionRecord,
  AnalysisRegionCountRecord,
} from "../../application/analysis-condition-options-reader";
import type { AnalysisConditionOptionsResult } from "../../application/find-analysis-condition-options";

function regionReference(record: Omit<AnalysisRegionCountRecord, "count">): CodeReference {
  return {
    codeValueId: bigintText(record.codeValueId),
    code: record.code,
    scheme: record.scheme,
    label: record.label,
  };
}

function regionCount(record: AnalysisRegionCountRecord): AnalysisRegionCount {
  return { region: regionReference(record), count: record.count };
}

function organizationOption(record: AnalysisOrganizationOptionRecord): AnalysisOrganizationOption {
  return {
    organizationId: bigintText(record.organizationId),
    name: record.name,
    region: record.region === null ? null : regionReference(record.region),
    count: record.count,
  };
}

/**
 * 활성 build가 없으면 계보가 전부 null이다. 그것은 오류가 아니라 파생물이 아직 없는 상태이고, 그때
 * 모든 수는 실제로 0이다 — 0을 추측으로 채운 것이 아니라 셀 것이 없어서 0이다(ADR 0011).
 */
function lineageWire(reading: AnalysisConditionOptionsReading) {
  const lineage = reading.lineage;
  if (lineage === null) {
    return {
      buildId: null,
      sourceReleaseId: null,
      calcVersion: null,
      computedAt: null,
      coverage: null,
      regionScheme: null,
    };
  }
  return {
    buildId: lineage.buildId === null ? null : bigintText(lineage.buildId),
    sourceReleaseId: lineage.sourceReleaseId,
    calcVersion: lineage.calcVersion,
    computedAt: lineage.computedAt === null ? null : instantText(lineage.computedAt),
    coverage: lineage.coverage,
    regionScheme: lineage.regionScheme,
  };
}

export function toAnalysisConditionOptionsResponse(
  result: AnalysisConditionOptionsResult,
): AnalysisConditionOptionsV1Response {
  const reading = result.reading;
  return {
    sidoCounts: reading.sido.map(regionCount),
    sigunguCounts: reading.sigungu.map(regionCount),
    regionUnobservedCount: reading.regionUnobservedCount,
    itemCounts: reading.items.map((item) => ({ item: item.atom, count: item.count })),
    itemUnknownCount: reading.itemUnknownCount,
    organizations: reading.organizations.map(organizationOption),
    organizationsTruncated: reading.organizationsTruncated,
    meta: { observationBuild: lineageWire(reading) },
  };
}
