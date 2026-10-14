/** @module 책임: 하한선 자리 조회의 공개 응답(공고별 점·선택한 1~10등 사다리·규칙 분포·기준 meta)을 조립한다. */
import { z } from "zod";

import {
  floorLineLadderSchema,
  floorLinePointSchema,
  floorLineRegionGroupSchema,
  floorLineRuleSchema,
  floorLinesMetaSchema,
} from "./floor-lines.resource";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { bidRateWireSchema } from "../../../values/rate";
import { analysisPeriodSchema } from "./filter.resource";

/**
 * 점 상한은 시군구 하나·최대 기간에서 실측 최대(2024~2026 전국 시군구 최다 약 9천 건)를 넉넉히 덮는다. 상한이 있어야
 * 응답 크기가 닫힌다. `ladders`는 요청에 `include=ranks`가 있을 때만 배열이고 없으면 null이다 — 빈 배열로 두면
 * "명단이 없는 지역"과 "묻지 않음"이 같은 값이 된다.
 */
export const floorLinesV1ResponseSchema = z.strictObject({
  points: z.array(floorLinePointSchema).max(20_000),
  ladders: z.array(floorLineLadderSchema).max(20_000).nullable(),
  rule: floorLineRuleSchema,
  meta: floorLinesMetaSchema,
}).meta({ id: "EatbidApiV1FloorLines" });

export const floorLineRegionsV1ResponseSchema = z.strictObject({
  groups: z.array(floorLineRegionGroupSchema).max(40),
  meta: z.strictObject({
    build: martBuildLineageSchema,
    period: analysisPeriodSchema,
    floorRate: bidRateWireSchema,
  }),
}).meta({ id: "EatbidApiV1FloorLineRegions" });

export type FloorLinesV1Response = z.infer<typeof floorLinesV1ResponseSchema>;
export type FloorLineRegionsV1Response = z.infer<typeof floorLineRegionsV1ResponseSchema>;
