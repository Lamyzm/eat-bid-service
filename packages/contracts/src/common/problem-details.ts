/**
 * @module 책임: 공개 오류 응답의 허용된 code taxonomy와 Problem Details 봉투 계약, 그리고 로그인 게이트가
 * 공유하는 401 응답 항목을 소유한다.
 */
import { z } from "zod";

export const problemCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "AUCTION_NOT_FOUND",
  "ORGANIZATION_NOT_FOUND",
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

/**
 * 세션을 요구하는 operation이 공유하는 401 항목이다. 한 자리에 두는 이유는 같은 실패가 endpoint마다
 * 다른 문장으로 갈라지면 소비자가 같은 복구(재로그인)를 endpoint 수만큼 다르게 다루기 때문이다.
 * 세션은 유효하지만 이 요청이 허용되지 않는 경우는 401이 아니라 403이며, 그 문장은 그 실패가 실제로
 * 나오는 계약이 각자 소유한다(ADR 0032 §6).
 */
export const unauthenticatedProblemResponse = {
  401: { description: "유효한 세션이 없음", schema: problemDetailsSchema },
} as const;
