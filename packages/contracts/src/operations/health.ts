import { z } from "zod";

export const liveHealthSchema = z.strictObject({
  status: z.literal("live"),
}).meta({ id: "LiveHealth", description: "The server process can handle HTTP work." });

export const readyHealthSchema = z.strictObject({
  status: z.literal("ready"),
}).meta({ id: "ReadyHealth", description: "The server is accepting application work." });

export const healthOperations = {
  live: {
    method: "get",
    path: "/health/live",
    operationId: "healthLive",
    summary: "Process liveness",
    responseSchema: liveHealthSchema,
    errorStatuses: [500] as const,
  },
  ready: {
    method: "get",
    path: "/health/ready",
    operationId: "healthReady",
    summary: "Application readiness",
    responseSchema: readyHealthSchema,
    errorStatuses: [503, 500] as const,
  },
} as const;

export type LiveHealth = z.infer<typeof liveHealthSchema>;
export type ReadyHealth = z.infer<typeof readyHealthSchema>;
