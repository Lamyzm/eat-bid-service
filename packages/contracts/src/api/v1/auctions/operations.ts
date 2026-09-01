/** @module 책임: v1 공고 조회의 semantic route와 상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { auctionIdPathSchema } from "../../../atoms/identifier";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { auctionV1ResponseSchema } from "./get-auction.response";

export const auctionV1Operations = {
  find: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "auctions", segments: [pathParameter("auctionId")] },
    operationId: "findAuction",
    implementationOwner: "server",
    summary: "정규화된 공고를 조회한다",
    tags: ["procurement"],
    pathSchema: z.strictObject({ auctionId: auctionIdPathSchema }),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "정규화된 공고 조회 성공", schema: auctionV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "공고 ID가 유효하지 않음", schema: problemDetailsSchema },
      404: { description: "공고를 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const auctionV1OperationRegistry = createOperationRegistry([
  auctionV1Operations.find,
] as const);
