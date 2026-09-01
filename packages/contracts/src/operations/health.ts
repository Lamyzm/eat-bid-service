/** @module 책임: 생존·준비 health endpoint의 중립 version operation과 응답 schema를 정의한다. */
import { z } from "zod";

import { problemDetailsSchema } from "../common/problem-details";
import { createOperationRegistry, defineOperation } from "../api/operation";

export const liveHealthSchema = z.strictObject({
  status: z.literal("live"),
}).meta({ id: "LiveHealth", description: "The server process can handle HTTP work." });

export const readyHealthSchema = z.strictObject({
  status: z.literal("ready"),
}).meta({ id: "ReadyHealth", description: "The server is accepting application work." });

export const healthOperations = {
  live: defineOperation({
    method: "get",
    versioning: { kind: "neutral" },
    route: { resource: "health", segments: ["live"] },
    operationId: "healthLive",
    implementationOwner: "server",
    summary: "프로세스 생존 상태를 확인한다",
    tags: ["operations"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "프로세스가 요청을 처리할 수 있음", schema: liveHealthSchema },
    },
    problemResponses: {
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
    },
  }),
  ready: defineOperation({
    method: "get",
    versioning: { kind: "neutral" },
    route: { resource: "health", segments: ["ready"] },
    operationId: "healthReady",
    implementationOwner: "server",
    summary: "애플리케이션 준비 상태를 확인한다",
    tags: ["operations"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "애플리케이션이 요청을 받을 준비가 됨", schema: readyHealthSchema },
    },
    problemResponses: {
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "애플리케이션 의존성을 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const healthControllerPath = healthOperations.live.controllerPath;
export const healthOperationRegistry = createOperationRegistry([
  healthOperations.live,
  healthOperations.ready,
] as const);

export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type ReadyHealth = z.infer<typeof readyHealthSchema>;
