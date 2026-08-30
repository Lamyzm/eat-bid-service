import { z } from "zod";

export const liveHealthSchema = z.strictObject({
  status: z.literal("live"),
}).meta({ id: "LiveHealth", description: "The server process can handle HTTP work." });

export const readyHealthSchema = z.strictObject({
  status: z.literal("ready"),
}).meta({ id: "ReadyHealth", description: "The server is accepting application work." });

export const healthControllerPath = "health";

/** 런타임 controller와 OpenAPI가 같은 경로 메타데이터를 소비하게 해 문서 drift를 구조적으로 막는다. */
function defineHealthOperation<
  const HandlerPath extends string,
  const OperationId extends string,
  const Summary extends string,
  const Schema,
  const ErrorStatuses extends readonly number[],
>(definition: {
  readonly handlerPath: HandlerPath;
  readonly operationId: OperationId;
  readonly summary: Summary;
  readonly responseSchema: Schema;
  readonly errorStatuses: ErrorStatuses;
}) {
  return Object.freeze({
    method: "get" as const,
    controllerPath: healthControllerPath,
    handlerPath: definition.handlerPath,
    path: `/${healthControllerPath}/${definition.handlerPath}` as const,
    operationId: definition.operationId,
    summary: definition.summary,
    responseSchema: definition.responseSchema,
    errorStatuses: definition.errorStatuses,
  });
}

export const healthOperations = {
  live: defineHealthOperation({
    handlerPath: "live",
    operationId: "healthLive",
    summary: "Process liveness",
    responseSchema: liveHealthSchema,
    errorStatuses: [500] as const,
  }),
  ready: defineHealthOperation({
    handlerPath: "ready",
    operationId: "healthReady",
    summary: "Application readiness",
    responseSchema: readyHealthSchema,
    errorStatuses: [503, 500] as const,
  }),
} as const;

export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type ReadyHealth = z.infer<typeof readyHealthSchema>;
