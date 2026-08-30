import { z } from "zod";

export const problemCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "AUCTION_NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
]).meta({ id: "ProblemCode" });

export const problemDetailsSchema = z.strictObject({
  type: z.string().url().max(256),
  title: z.string().min(1).max(120),
  status: z.number().int().min(400).max(599),
  code: problemCodeSchema,
  requestId: z.string().min(1).max(128),
}).meta({ id: "ProblemDetails" });

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type ProblemCode = z.infer<typeof problemCodeSchema>;
