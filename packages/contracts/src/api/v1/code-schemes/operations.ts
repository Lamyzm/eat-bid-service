/** @module 책임: v1 코드 체계별 코드 목록 조회의 semantic route·입력·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { codeSchemeSchema } from "../../../atoms/source-code";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { listCodesV1ResponseSchema } from "./list-codes.response";

// grain은 승격 단계 이름이며 그 어휘의 권위는 release가 기록한 `promotedGrain`이다. query가 값
// 목록을 열거하면 지역 어휘가 계약에 다시 선언되므로 자유 문자열로 받고 대조는 release가 한다.
export const listCodesQuerySchema = z.strictObject({
  grain: z.string().min(1).max(64).optional(),
});

export const codeSchemeV1Operations = {
  listCodes: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "code-schemes", segments: [pathParameter("scheme"), "codes"] },
    operationId: "listCodes",
    implementationOwner: "server",
    summary: "코드 체계의 활성 release에 속한 코드를 조회한다",
    tags: ["코드 사전"],
    pathSchema: z.strictObject({ scheme: codeSchemeSchema }),
    querySchema: listCodesQuerySchema.default({}),
    bodySchema: z.undefined(),
    successResponses: { 200: { description: "코드 목록 조회 성공", schema: listCodesV1ResponseSchema } },
    problemResponses: {
      400: { description: "코드 체계 이름 또는 query가 유효하지 않음", schema: problemDetailsSchema },
      ...unauthenticatedProblemResponse,
      // 활성 release가 없는 scheme은 404다. 빈 배열로 답하면 "코드가 없는 체계"와 "아직 적재하지
      // 않은 체계"가 화면에서 같아 보인다(AGENTS 3).
      404: { description: "코드 체계 또는 활성 release를 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const codeSchemeV1OperationRegistry = createOperationRegistry([codeSchemeV1Operations.listCodes] as const);
