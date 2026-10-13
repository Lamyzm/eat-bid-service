/** @module 책임: v1 내 투찰 복기 operation의 semantic route·query·상태별 schema를 소유한다. */
import { z } from "zod";

import { kstMonthTextSchema } from "../../../atoms/calendar";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { myBidReviewV1ResponseSchema } from "./bid-review.response";

/** 달을 고르지 않으면 내 사업자가 넣은 가장 최근 달을 고른다. 몇 년치를 한 번에 내지 않으려고 한 달씩만 싣는다. */
export const myBidReviewQuerySchema = z.strictObject({
  month: kstMonthTextSchema.optional(),
}).meta({ id: "MyBidReviewQuery" });

export const myBidReviewV1Operations = {
  getMyBidReview: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["bid-review"] },
    operationId: "getMyBidReview",
    implementationOwner: "server",
    summary: "내 사업자가 넣은 공고를 달마다 모아, 그날 하한·낙찰과 우리 값·방법별 추천 값(장부 또는 다시 계산)을 대조한다."
      + " 운영자 전용이다.",
    tags: ["내 계정과 조건"],
    pathSchema: z.undefined(),
    querySchema: myBidReviewQuerySchema.default({}),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "복기 조회 성공", schema: myBidReviewV1ResponseSchema },
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

export const myBidReviewV1OperationRegistry = createOperationRegistry([
  myBidReviewV1Operations.getMyBidReview,
] as const);

export type MyBidReviewQuery = z.output<typeof myBidReviewQuerySchema>;
