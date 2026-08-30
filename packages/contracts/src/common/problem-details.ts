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

// 공개 오류는 strict allowlist로 제한해 내부 예외 메시지나 임의 필드가 응답 계약에 섞이지 않게 한다.
export const problemDetailsSchema = z.strictObject({
  type: z.string().url().max(256),
  title: z.string().min(1).max(120),
  status: z.number().int().min(400).max(599),
  code: problemCodeSchema,
  requestId: z.string().min(1).max(128),
}).meta({ id: "ProblemDetails" });

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type ProblemCode = z.infer<typeof problemCodeSchema>;
