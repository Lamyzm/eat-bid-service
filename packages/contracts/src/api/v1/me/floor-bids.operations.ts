/** @module 책임: 하한선 자리에 겹칠 내 사업자 투찰 개인 조회의 semantic route·query·상태별 schema를 소유한다. */
import { z } from "zod";

import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { floorLinePeriodRule, floorLineRegionWindowQueryFields } from "../analysis/floor-lines.operations";
import { myFloorBidsV1ResponseSchema } from "./floor-bids.response";

/** 시장 조회(`findFloorLines`)와 같은 창이다. 같은 창이어야 화면이 겹친 우리 값이 같은 공고의 점 위에 선다. */
const myFloorBidsQuerySchema = z.strictObject(floorLineRegionWindowQueryFields).check(floorLinePeriodRule);

/**
 * `me` resource에 두는 이유: 응답 범위를 정하는 것이 지역이 아니라 요청자 워크스페이스의 등록 사업자다. `analysis` 아래에 두면
 * 공개 시장 조회가 요청자에 따라 다른 내용을 내는 것처럼 보이고, 공개·개인 read의 캐시 정책이 한 경로에 섞인다(ADR 0032 §1).
 */
export const myFloorBidV1Operations = {
  findMyFloorBids: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["floor-bids"] },
    operationId: "findMyFloorBids",
    implementationOwner: "server",
    summary: "공고지역 시군구 하나의 기간 안 공고에서 내 등록 사업자가 낸 투찰마다 기초금액 대비 값과 결과(하한 미달·하한 위 등수·낙찰)를"
      + " 조회한다. 하한선 자리 점 위에 겹치는 개인 응답이며 운영자 전용이다.",
    tags: ["내 계정과 조건"],
    pathSchema: z.undefined(),
    querySchema: myFloorBidsQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "내 투찰 조회 성공. 등록 사업자가 원본에서 확인되지 않으면 빈 목록과 그 수를 meta에 싣는다", schema: myFloorBidsV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "query가 유효하지 않거나 기간 상한·순서를 어김", schema: problemDetailsSchema },
      ...unauthenticatedProblemResponse,
      403: { description: "운영자 권한 없음, 신뢰하지 않는 Origin 또는 계정 초기화 미완료", schema: problemDetailsSchema },
      404: { description: "요청한 공고지역 시군구 코드값을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const myFloorBidV1OperationRegistry = createOperationRegistry([
  myFloorBidV1Operations.findMyFloorBids,
] as const);

export type MyFloorBidsQuery = z.infer<typeof myFloorBidsQuerySchema>;
