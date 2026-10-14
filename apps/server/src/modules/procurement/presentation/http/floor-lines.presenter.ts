/** @module 책임: 하한선 자리 application 결과를 공개 V1 하한선·지역 목록 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type FloorLineRegionsV1Response, type FloorLinesV1Response } from "@eatbid/contracts";
import type { BaseRelativeBidRate } from "@eatbid/domain";
import { z } from "zod";

import {
  baseRelativeBidRateWire,
  bidRateWire,
  bigintText,
  instantText,
  martBuildLineageWire,
} from "../../../../platform/http/wire";
import type { FloorLineRegionsResult, FloorLinesResult } from "../../application/find-floor-lines";

/** 단위와 분모를 목록에 한 번만 둔다. 값마다 붙이면 같은 말을 수만 번 싣는다. */
function baseRelativeList(values: readonly BaseRelativeBidRate[]) {
  return { unit: "percentage-points" as const, denominator: "base-amount" as const, values: [...values] };
}

export function toFloorLinesResponse(result: FloorLinesResult): FloorLinesV1Response {
  return {
    points: result.points.map((point) => ({
      attemptId: bigintText(point.attemptId),
      revisionId: bigintText(point.revisionId),
      openedAt: instantText(point.openedAt),
      organizationName: point.organizationName,
      baseAmount: z.encode(moneyCodec, point.baseAmount),
      floor: baseRelativeBidRateWire(point.floor),
    })),
    ladders: result.ladders === null
      ? null
      : result.ladders.map((ladder) => ({
        attemptId: bigintText(ladder.attemptId),
        validBidderCount: ladder.validBidderCount,
        lowest: baseRelativeList(ladder.lowest),
      })),
    rule: {
      version: result.rule.version,
      sourceRounds: result.rule.sourceRounds,
      quantiles: baseRelativeList(result.rule.quantiles),
    },
    meta: {
      build: martBuildLineageWire(result.lineage),
      region: { codeValueId: bigintText(result.regionCodeValueId), label: result.regionLabel },
      period: { from: result.period.from, to: result.period.to },
      floorRate: bidRateWire(result.floorRate),
      pointCount: result.points.length,
    },
  };
}

/** 시도마다 시군구를 묶고 이름 순으로 세운다. 이름이 없는 구역은 뒤로 보내되 빼지 않는다(AGENTS 3). */
export function toFloorLineRegionsResponse(result: FloorLineRegionsResult): FloorLineRegionsV1Response {
  const bySido = new Map<bigint, { label: string | null; sigungu: { id: bigint; label: string | null; count: number }[] }>();
  for (const region of result.regions) {
    const group = bySido.get(region.sidoCodeValueId) ?? { label: region.sidoLabel, sigungu: [] };
    group.sigungu.push({ id: region.sigunguCodeValueId, label: region.sigunguLabel, count: region.pointCount });
    bySido.set(region.sidoCodeValueId, group);
  }
  const byLabel = (left: string | null, right: string | null) =>
    left === null ? (right === null ? 0 : 1) : right === null ? -1 : left.localeCompare(right, "ko");
  return {
    groups: [...bySido.entries()]
      .sort(([, left], [, right]) => byLabel(left.label, right.label))
      .map(([sidoId, group]) => ({
        sido: { codeValueId: bigintText(sidoId), label: group.label },
        sigungu: group.sigungu
          .sort((left, right) => byLabel(left.label, right.label))
          .map((item) => ({ region: { codeValueId: bigintText(item.id), label: item.label }, pointCount: item.count })),
      })),
    meta: {
      build: martBuildLineageWire(result.lineage),
      period: { from: result.period.from, to: result.period.to },
      floorRate: bidRateWire(result.floorRate),
    },
  };
}
