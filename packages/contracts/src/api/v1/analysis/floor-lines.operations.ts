/** @module 책임: 하한선 자리 화면(PDR-0009)의 지역 목록·공고별 하한선 조회 semantic route와 query·상태별 schema 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { bidRateTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { CODE_SCHEME_NAMES } from "../../../atoms/code-scheme-names";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { floorLineRegionsV1ResponseSchema, floorLinesV1ResponseSchema } from "./find-floor-lines.response";
import { analysisPeriodDayCount } from "./operations";

/**
 * 기간 상한이다. 화면이 2024년부터를 보이므로 3년을 조금 넘게 닫는다. 상한이 있어야 시군구 하나의 점 수와
 * 명단 조회 행 수가 닫힌다(2026-10-15 실측: 김해시 1년 사다리 0.24초).
 */
const FLOOR_LINE_MAX_PERIOD_DAYS = 1_130;

type FloorLinePeriodQuery = { from: string; to: string };

/** 기간 규칙이다. 내 사업자 투찰을 겹치는 개인 조회(`me/floor-bids`)도 같은 창을 받아 같은 규칙으로 닫는다. */
export function floorLinePeriodRule<Query extends FloorLinePeriodQuery>(ctx: z.core.ParsePayload<Query>): void {
  const days = analysisPeriodDayCount(ctx.value.from, ctx.value.to);
  if (days <= 0) ctx.issues.push({ code: "custom", message: "기간은 시간순이어야 합니다.", input: ctx.value, path: ["to"] });
  else if (days > FLOOR_LINE_MAX_PERIOD_DAYS) {
    ctx.issues.push({ code: "custom", message: `기간은 ${FLOOR_LINE_MAX_PERIOD_DAYS}일을 넘을 수 없습니다.`, input: ctx.value, path: ["to"] });
  }
}

const floorLinePeriodFields = {
  from: kstDateTextSchema,
  to: kstDateTextSchema,
  // 하한율은 정의상 0~100이다. 미확인 하한율을 90으로 추정하지 않으므로 화면이 고른 값만 받는다.
  floorRate: bidRateTextSchema,
} as const;

const floorLineRegionsQuerySchema = z.strictObject(floorLinePeriodFields).check(floorLinePeriodRule);

/**
 * 지역은 eaT 공고지역 **시군구**만 받는다. 시도 전체는 수만 점이라 PDR-0006처럼 점으로 보내지 않는다. 체계를
 * 함께 받는 이유는 분석 조회와 같다 — 코드값 id만으로는 어느 체계의 구역인지 말하지 않는다(AGENTS 6).
 *
 * `include=ranks`는 공고마다 1~10등 사다리를 함께 달라는 뜻이다. 명단을 읽어 무거우므로 켤 때만 받는다.
 */
/**
 * 시군구 하나·기간·하한율 창이다. 시장 조회와 내 투찰 조회가 **같은 창**을 받아야 화면이 겹친 점이 같은 공고를 가리킨다.
 * 그래서 필드는 여기 한 번만 선언하고 두 schema가 나눠 쓴다.
 */
export const floorLineRegionWindowQueryFields = {
  ...floorLinePeriodFields,
  regionScheme: z.literal(CODE_SCHEME_NAMES.auctionLocationSigungu),
  regionCodeValueId: positiveBigintTextSchema,
} as const;

const floorLinesQuerySchema = z.strictObject({
  ...floorLineRegionWindowQueryFields,
  include: z.literal("ranks").optional(),
}).check(floorLinePeriodRule);

const floorLineProblemResponses = {
  400: { description: "query가 유효하지 않거나 기간 상한·순서를 어김", schema: problemDetailsSchema },
  ...unauthenticatedProblemResponse,
  403: { description: "이 분석을 볼 수 있는 인가가 없음", schema: problemDetailsSchema },
  500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
  503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
} as const;

export const floorLineV1Operations = {
  findRegions: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "analysis", segments: ["floor-lines", "regions"] },
    operationId: "findFloorLineRegions",
    implementationOwner: "server",
    summary: "하한선 자리에서 고를 수 있는 eaT 공고지역 시도·시군구와, 같은 하한율·기간에서 하한선이 계산되는 공고 수를 조회한다.",
    tags: ["공고와 분석"],
    pathSchema: z.strictObject({}),
    querySchema: floorLineRegionsQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "지역 목록 조회 성공. 자료가 없으면 빈 목록이며 meta가 기준 build를 말한다", schema: floorLineRegionsV1ResponseSchema },
    },
    problemResponses: floorLineProblemResponses,
  }),
  findFloorLines: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "analysis", segments: ["floor-lines"] },
    operationId: "findFloorLines",
    implementationOwner: "server",
    summary: "공고지역 시군구 하나의 기간 안 공고마다 하한선(기초금액 대비 %)과, 같은 하한율에서 eaT 예비가격 규칙이 정하는"
      + " 하한선 분포를 조회한다. 요청하면 공고마다 하한 위 1~10등 사다리를 함께 준다. 하한선 위치를 예측하지 않는다(PDR-0009).",
    tags: ["공고와 분석"],
    pathSchema: z.strictObject({}),
    querySchema: floorLinesQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "하한선 조회 성공. 자료가 없으면 빈 점이며 meta가 기준 build를 말한다", schema: floorLinesV1ResponseSchema },
    },
    problemResponses: {
      ...floorLineProblemResponses,
      404: { description: "요청한 공고지역 시군구 코드값을 찾을 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const floorLineV1OperationRegistry = createOperationRegistry([
  floorLineV1Operations.findRegions,
  floorLineV1Operations.findFloorLines,
] as const);

export type FloorLineRegionsQuery = z.infer<typeof floorLineRegionsQuerySchema>;
export type FloorLinesQuery = z.infer<typeof floorLinesQuerySchema>;
