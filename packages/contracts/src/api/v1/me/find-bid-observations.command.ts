/** @module 책임: 내 투찰 관측 batch 조회 입력의 build·기관 고정과 회차 조합 중복 규칙을 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";

/**
 * 한 요청이 물을 수 있는 회차 수의 상한이며 `pages-endpoints-load.md`의 "기관 회차 ≤ 200" 점 조회
 * 상한과 같은 값이다. 회차 이력의 기본 12나 흐름 차트가 그리는 60은 소비자가 고르는 크기이지 이
 * 계약이 아는 값이 아니다. 그 둘을 여기 적으면 화면 결정이 계약 상한으로 굳는다.
 */
export const maxBidObservationAttempts = 200;

/**
 * 같은 회차를 두 번 묻지 않는다. mart의 한 build는 회차마다 요약 한 행이므로 같은 `attemptId`가 두
 * revision으로 오면 둘 중 하나는 그 build의 사실이 아니고, 조합을 그대로 실행하면 응답이 같은 회차에
 * 두 결과를 실어 화면이 어느 쪽을 그릴지 스스로 골라야 한다.
 */
function uniqueAttemptRule(
  ctx: z.core.ParsePayload<ReadonlyArray<{ attemptId: string }>>,
): void {
  const seen = new Set<string>();
  for (const [index, entry] of ctx.value.entries()) {
    if (seen.has(entry.attemptId)) {
      ctx.issues.push({ code: "custom", input: ctx.value, path: [index, "attemptId"], message: "같은 회차를 두 번 지정할 수 없습니다." });
    }
    seen.add(entry.attemptId);
  }
}

export const bidObservationAttemptKeySchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
}).meta({ id: "BidObservationAttemptKey" });

export const findMyBidObservationsCommandSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  /**
   * 회차 이력 응답 `meta.buildId`를 그대로 되돌려 보내는 자리다. 그 build가 더 이상 활성이 아니면
   * 409이며, 최신 build의 같은 회차로 조용히 바꿔 읽지 않는다. 바꿔 읽으면 화면의 표와 점이 서로
   * 다른 계보를 말하면서도 같은 응답처럼 보인다(ADR 0034).
   */
  buildId: positiveBigintTextSchema,
  attempts: z.array(bidObservationAttemptKeySchema)
    .min(1)
    .max(maxBidObservationAttempts)
    .check(uniqueAttemptRule),
}).meta({ id: "FindMyBidObservationsCommand" });

export type BidObservationAttemptKey = z.infer<typeof bidObservationAttemptKeySchema>;
export type FindMyBidObservationsCommand = z.infer<typeof findMyBidObservationsCommandSchema>;
