/** @module 책임: 회차 명단의 관측 여부·참여 기록·낙찰 결과·출처를 공개 응답 하나로 구성한다. */
import { z } from "zod";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { auctionRosterAwardSchema, auctionRosterMetaSchema, auctionRosterSubmissionSchema } from "./roster.resource";

// 한 회차만 내려주는 읽기 계약이다. 상한은 원천 명단 계약과 같은 2048이며 초과를 잘라 성공시키지 않는다.
// 빈 명단은 원본 블록 부재와 실제 0명을 구별할 근거가 없으므로 not-observed로 표현한다.
export const auctionRosterV1ResponseSchema = z.strictObject({
  auctionId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  state: z.enum(["observed", "not-observed"]),
  rows: z.array(auctionRosterSubmissionSchema).max(2048),
  award: auctionRosterAwardSchema.nullable(),
  meta: auctionRosterMetaSchema,
}).meta({ id: "AuctionRosterV1Response" });
export type AuctionRosterV1Response = z.infer<typeof auctionRosterV1ResponseSchema>;
