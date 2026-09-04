/** @module 책임: v1 기관 회차 이력 조회의 semantic route·query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

// 기본값 12는 결정 화면 과거 회차 표가 그리는 12행이다. 첫 화면이 표를 채우는 데 필요한 만큼만
// 받아 흐름 차트와 표가 같은 한 응답을 쓴다.
const DEFAULT_ATTEMPT_LIMIT = 12;

export const organizationAuctionAttemptsQuerySchema = z.strictObject({
  item: positiveBigintTextSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  // 상한 200은 pages-endpoints-load.md의 "기관 회차 ≤ 200" 점 조회 상한과 같다.
  limit: z.coerce.number().int().min(1).max(200).default(DEFAULT_ATTEMPT_LIMIT),
});

export const organizationV1Operations = {
  listAuctionAttempts: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "organizations", segments: [pathParameter("organizationId"), "auction-attempts"] },
    operationId: "listOrganizationAuctionAttempts",
    implementationOwner: "server",
    summary: "기관의 회차 요약을 최근 순으로 조회한다",
    tags: ["procurement"],
    pathSchema: z.strictObject({ organizationId: positiveBigintTextSchema }),
    querySchema: organizationAuctionAttemptsQuerySchema.default({ limit: DEFAULT_ATTEMPT_LIMIT }),
    bodySchema: z.undefined(),
    successResponses: { 200: { description: "기관 회차 요약 조회 성공", schema: organizationAuctionAttemptsV1ResponseSchema } },
    problemResponses: {
      400: { description: "기관 ID 또는 query가 유효하지 않음", schema: problemDetailsSchema },
      404: { description: "기관을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const organizationV1OperationRegistry = createOperationRegistry([organizationV1Operations.listAuctionAttempts] as const);
