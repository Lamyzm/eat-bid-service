/** @module 책임: 하한선 자리의 내 사업자 조회 둘(투찰, 투찰이 가장 많은 공고지역) application 결과를 공개 V1 개인 응답으로 직렬화하는 순수 presenter다. */
import type { MyFloorBidsV1Response, MyFloorRegionV1Response } from "@eatbid/contracts";

import { baseRelativeBidRateWire, bidRateWire, bigintText } from "../../../../platform/http/wire";
import type { MyFloorBidsResult } from "../../application/find-my-floor-bids";
import type { MyFloorRegionResult } from "../../application/find-my-floor-region";

export function toMyFloorBidsResponse(result: MyFloorBidsResult): MyFloorBidsV1Response {
  return {
    bids: result.bids.map((bid) => ({
      attemptId: bigintText(bid.attemptId),
      supplier: { supplierPartyId: bigintText(bid.supplierPartyId), name: bid.supplierName },
      rate: baseRelativeBidRateWire(bid.rate),
      outcome: bid.outcome,
    })),
    meta: {
      region: { codeValueId: bigintText(result.regionCodeValueId), label: result.regionLabel },
      period: { from: result.period.from, to: result.period.to },
      floorRate: bidRateWire(result.floorRate),
      linkedBusinessCount: result.linkedBusinessCount,
      unlinkedBusinessCount: result.unlinkedBusinessCount,
    },
  };
}

export function toMyFloorRegionResponse(result: MyFloorRegionResult): MyFloorRegionV1Response {
  const region = result.region;
  return {
    region: region === null
      ? null
      : {
          sido: { codeValueId: bigintText(region.sidoCodeValueId), label: region.sidoLabel },
          sigungu: { codeValueId: bigintText(region.sigunguCodeValueId), label: region.sigunguLabel },
          roundCount: region.roundCount,
        },
    meta: {
      period: { from: result.period.from, to: result.period.to },
      floorRate: bidRateWire(result.floorRate),
      linkedBusinessCount: result.linkedBusinessCount,
      unlinkedBusinessCount: result.unlinkedBusinessCount,
    },
  };
}
