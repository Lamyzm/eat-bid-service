/** @module 책임: 상세 응답이 실은 입찰 명단 블록의 크기 경계와 부재 의미를 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { normalizedBidSubmissionSchema } from "./bid-submission";

// 상한 2048은 실측 p95 197곳과 최대 명단 규모 사이에 넉넉한 여유를 둔 값이다. 초과는 계약 위반으로
// 격리되어야 하며 조용히 자르지 않는다.
export const normalizedBidRosterSchema = z.strictObject({
  sourceRosterSize: nonNegativeCountSchema.nullable(),
  submissions: z.array(normalizedBidSubmissionSchema).max(2048),
}).meta({
  id: "NormalizedBidRoster",
  description: "Observed roster block; an absent block is an empty roster, not a failure.",
});

export type NormalizedBidRoster = z.infer<typeof normalizedBidRosterSchema>;
