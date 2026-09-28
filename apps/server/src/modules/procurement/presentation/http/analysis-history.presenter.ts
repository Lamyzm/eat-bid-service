/** @module 책임: 분석 전체 개찰 이력 application 결과를 공개 V1 이력 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type AnalysisHistoryV1Response } from "@eatbid/contracts";
import { z } from "zod";
import { bigintText, instantText, martBuildLineageWire, observedBidRateWire } from "../../../../platform/http/wire";
import type { AnalysisHistoryResult } from "../../application/find-analysis-history";

export function toAnalysisHistoryResponse(result: AnalysisHistoryResult): AnalysisHistoryV1Response {
  if (result.kind === "empty") {
    // 활성 build가 없으면 셀 것이 없다. 0은 추측이 아니라 실제로 셀 행이 없는 것이다(ADR 0011).
    return {
      rows: [],
      nextCursor: null,
      meta: { population: result.input.population, totalCount: 0, build: martBuildLineageWire(null) },
    };
  }
  const { page, lineage, input } = result;
  const last = page.rows.at(-1);
  return {
    rows: page.rows.map((row) => ({
      attemptId: bigintText(row.attemptId),
      revisionId: bigintText(row.revisionId),
      organizationId: bigintText(row.organizationId),
      organizationName: row.organizationName,
      announcedAt: instantText(row.announcedAt),
      openedAt: instantText(row.openedAt),
      items: row.items === null ? null : [...row.items],
      assessmentRate: observedBidRateWire(row.assessmentRate),
      secondRate: observedBidRateWire(row.secondRate),
      listCount: row.listCount,
      belowDayFloorCount: row.belowDayFloorCount,
      winner: row.winner === null
        ? null
        : { supplierPartyId: bigintText(row.winner.supplierPartyId), name: row.winner.name },
      baseAmount: z.encode(moneyCodec, row.baseAmount),
    })),
    nextCursor: page.hasMore && last !== undefined ? bigintText(last.attemptId) : null,
    meta: { population: input.population, totalCount: page.totalCount, build: martBuildLineageWire(lineage) },
  };
}
