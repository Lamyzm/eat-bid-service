/** @module 책임: v1 오늘 투찰 한 장 operation의 semantic route·query·상태별 schema를 소유한다. */
import { z } from "zod";

import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { itemsFilterSchema, itemUnknownFilterSchema } from "../auctions/list-open-auctions.query";
import { myBidBoardV1ResponseSchema } from "./bid-board.response";

/**
 * 품목만 받는다. 지역은 저장된 관심 지역을 서버가 읽는다 — 화면이 보낸 지역으로 남의 시장을 펼치지 않게 하는 것은 조합 건수
 * operation과 같은 이유다. 마감 창도 받지 않는다. "오늘·내일"은 서버 clock 하나로 정해야 화면마다 다른 날을 보지 않는다.
 */
export const myBidBoardQuerySchema = z.strictObject({
  items: itemsFilterSchema.optional(),
  itemUnknown: itemUnknownFilterSchema.optional(),
}).meta({ id: "MyBidBoardQuery" });

export const myBidBoardV1Operations = {
  getMyBidBoard: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["bid-board"] },
    operationId: "getMyBidBoard",
    implementationOwner: "server",
    summary: "관심 지역의 내일 자정 전 마감 하한율 90·88 공고마다 이번 달 맞춤과 전국 공식 금액을 한 번에 낸다."
      + " 운영자 전용이다.",
    tags: ["내 계정과 조건"],
    pathSchema: z.undefined(),
    querySchema: myBidBoardQuerySchema.default({}),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "오늘 투찰 조회 성공", schema: myBidBoardV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "query가 유효하지 않음", schema: problemDetailsSchema },
      ...unauthenticatedProblemResponse,
      403: { description: "운영자 권한 없음, 신뢰하지 않는 Origin 또는 계정 초기화 미완료", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const myBidBoardV1OperationRegistry = createOperationRegistry([
  myBidBoardV1Operations.getMyBidBoard,
] as const);

export type MyBidBoardQuery = z.output<typeof myBidBoardQuerySchema>;
