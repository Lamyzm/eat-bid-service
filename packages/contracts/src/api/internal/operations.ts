/** @module 책임: web이 소유한 클러스터 내부 operation의 semantic route와 registry를 소유한다. */
import { z } from "zod";

import { problemDetailsSchema } from "../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../operation";
import { revalidateWebCacheBodySchema } from "./revalidate-web-cache";

export const internalOperations = {
  revalidateWebCache: defineOperation({
    method: "post",
    // `/api` prefix는 Nest ingress 전용이고 operation 정의가 `/api` + web owner 조합을 거부한다.
    // 그래서 version 없는 neutral route를 쓰며, 그 경로를 ingress 규칙이 따로 막는다(ADR 0036-7).
    versioning: { kind: "neutral" },
    route: { resource: "internal", segments: ["cache", "revalidate"] },
    operationId: "revalidateWebCache",
    implementationOwner: "web",
    summary: "발행·mart 활성화 뒤 web 읽기 캐시의 의미 범위를 무효화한다",
    tags: ["내부 운영"],
    pathSchema: z.strictObject({}),
    querySchema: z.undefined(),
    bodySchema: revalidateWebCacheBodySchema,
    successResponses: {
      204: { description: "요청한 범위를 무효화함", schema: z.undefined() },
    },
    problemResponses: {
      400: { description: "본문이 계약에 맞지 않거나 무효화 범위가 비어 있음", schema: problemDetailsSchema },
      401: { description: "Bearer 토큰이 없거나 일치하지 않음", schema: problemDetailsSchema },
      500: { description: "무효화 토큰이 설정되지 않았거나 예상하지 못한 결함", schema: problemDetailsSchema },
    },
  }),
} as const;

/**
 * 공개 OpenAPI를 모으는 `publicHttpOperationRegistry`와 일부러 분리한 registry다. 이 경로는 클러스터
 * 안에서만 부르는 표면이라 공개 계약 문서에 광고하지 않으며, Nest가 controller를 파생할 대상도
 * 아니다. web `route.ts` 금지 규칙의 예외는 손으로 적은 목록이 아니라 이 registry에서 파생한다.
 */
export const internalHttpOperationRegistry = createOperationRegistry([
  internalOperations.revalidateWebCache,
] as const);
