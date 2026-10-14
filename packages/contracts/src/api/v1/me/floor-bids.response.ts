/** @module 책임: 하한선 자리에 겹칠 내 사업자 투찰(값·결과·등수) 개인 응답을 조립한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { baseRelativeBidRateWireSchema, bidRateWireSchema } from "../../../values/rate";
import { analysisPeriodSchema } from "../analysis/filter.resource";
import { floorLineRegionRefSchema } from "../analysis/floor-lines.resource";

/**
 * 투찰 하나의 결과다. 하한 미달은 등수가 없다 — 하한 아래 값은 줄에 서지 못한다. 하한 위면 같은 회차에서 하한 위로 낸
 * 업체마다 가장 낮은 값 하나로 세운 줄의 자리다. 더 낮게 낸 업체 수 + 1이라 같은 값이면 같은 등수다. `won`은 이 업체가
 * 그 회차의 낙찰 업체인지다.
 */
export const myFloorBidOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("below-floor") }),
  z.strictObject({
    kind: z.literal("valid"),
    rank: z.number().int().min(1).max(100_000),
    validBidderCount: nonNegativeCountSchema,
    won: z.boolean(),
  }),
]).meta({ id: "MyFloorBidOutcome" });

export const myFloorBidSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  supplier: z.strictObject({
    supplierPartyId: positiveBigintTextSchema,
    /** 원본 명단의 업체 이름이다. 관측 라벨이라 없을 수 있다(AGENTS 3). */
    name: z.string().min(1).max(256).nullable(),
  }),
  /** 투찰률(예정가격 대비)을 기초금액 대비로 옮긴 값이다. 실격 투찰의 금액 열은 자리표시자라 쓰지 않는다. */
  rate: baseRelativeBidRateWireSchema,
  outcome: myFloorBidOutcomeSchema,
}).meta({ id: "MyFloorBid" });

/**
 * 원본에서 확인되지 않은 등록 사업자 수를 함께 싣는다. 투찰이 없는 것과 "아직 그 사업자를 원본에서 못 찾은 것"을 같은 빈
 * 목록으로 말하지 않기 위해서다(ADR 0032 §7).
 */
export const myFloorBidsV1ResponseSchema = z.strictObject({
  bids: z.array(myFloorBidSchema).max(20_000),
  meta: z.strictObject({
    region: floorLineRegionRefSchema,
    period: analysisPeriodSchema,
    floorRate: bidRateWireSchema,
    linkedBusinessCount: nonNegativeCountSchema,
    unlinkedBusinessCount: nonNegativeCountSchema,
  }),
}).meta({ id: "EatbidApiV1MyFloorBids" });

export type MyFloorBidsV1Response = z.infer<typeof myFloorBidsV1ResponseSchema>;
