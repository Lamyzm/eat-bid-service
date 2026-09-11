/** @module 책임: 참가제한지역 목록과 선택 미리보기 결과를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import type { ListEligibilityAreasV1Response, RegionCoverageV1Response } from "@eatbid/contracts";

import { codeReferenceWire, instantText, martBuildLineageWire } from "../../../../platform/http/wire";
import type { EligibilityAreaCatalog } from "../../application/eligibility-area-reader";
import type { RegionCoverageResult } from "../../application/preview-region-coverage";

export function toEligibilityAreasResponse(catalog: EligibilityAreaCatalog): ListEligibilityAreasV1Response {
  return {
    scheme: catalog.scheme,
    groups: catalog.groups.map((group) => ({
      all: codeReferenceWire(group.all),
      parts: group.parts.map((part) => codeReferenceWire(part)),
    })),
    meta: { areaCount: catalog.areaCount, unlabeledAreaCount: catalog.unlabeledAreaCount },
  };
}

export function toRegionCoverageResponse(result: RegionCoverageResult): RegionCoverageV1Response {
  const { query, coverage } = result;
  return {
    today: {
      matchedCount: coverage.today.matchedCount,
      unobservedCount: coverage.today.unobservedCount,
      nationwideCount: coverage.today.nationwideCount,
    },
    window: {
      // 창의 양끝을 응답이 스스로 말해야 "지난 90일"이라는 문장이 재현된다(AGENTS 7).
      windowStart: instantText(query.windowStart),
      windowEnd: instantText(query.asOf),
      daysWithAuctions: coverage.window.daysWithAuctions,
      medianDayCount: coverage.window.medianDayCount,
      peakDay: coverage.window.peakDay,
    },
    meta: {
      asOf: instantText(query.asOf),
      openAuctionSnapshotBuild: martBuildLineageWire(coverage.snapshotLineage),
    },
  };
}
