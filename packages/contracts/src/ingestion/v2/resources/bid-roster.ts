/** @module 책임: 상세 응답이 실은 입찰 명단 블록의 크기 경계와 부재 의미를 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { normalizedBidSubmissionSchema } from "./bid-submission";

// 상한 2048은 레이크 전수 실측(2026-09-04, 238,308건: 최대 413·p95 175)과 26,000 조사 코호트
// (p95 197) 어느 쪽에도 여유가 큰 값이다. 초과는 계약 위반으로 격리되어야 하며 조용히 자르지 않는다.
export const normalizedBidRosterSchema = z.strictObject({
  sourceRosterSize: nonNegativeCountSchema.nullable(),
  submissions: z.array(normalizedBidSubmissionSchema).max(2048),
}).meta({
  id: "NormalizedBidRoster",
  description: "Observed roster block; an absent block is an empty roster, not a failure.",
});

export type NormalizedBidRoster = z.infer<typeof normalizedBidRosterSchema>;
