/** @module 책임: 재입찰 사슬을 원본 식별자 관계로만 표현하는 계보 계약을 소유한다. */
import { z } from "zod";

import { instantTextSchema } from "../../../atoms/instant";
import { externalBidIdSchema } from "../../../atoms/source-code";
import { moneyWireSchema } from "../../../values/money";
import { sourceCodedValueSchema } from "../../../values/source-coded-value";

export const normalizedAttemptLinkSchema = z.strictObject({
  externalBidId: externalBidIdSchema,
  displayBidNumber: z.string().min(1).max(128).nullable(),
  sourceStatus: sourceCodedValueSchema.nullable(),
  bidOpenedFrom: instantTextSchema.nullable(),
  bidClosedAt: instantTextSchema.nullable(),
  baseAmount: moneyWireSchema.nullable(),
  plannedAmount: moneyWireSchema.nullable(),
}).meta({
  id: "NormalizedAttemptLink",
  description: "One member of the observed re-bid chain; ordering is never parsed from the display number suffix.",
});

// 표시 공고번호의 -0/-1/-2 접미사를 차수로 읽지 않는다(AGENTS 4). 사슬은 ds_bidHistory의 원본 id
// 집합과 ds_info.UP_ELCTRN_BID_ID 관계로만 표현하고, 순서 부여는 projector의 결정이다.
export const normalizedAuctionLineageSchema = z.strictObject({
  parentExternalBidId: externalBidIdSchema.nullable(),
  links: z.array(normalizedAttemptLinkSchema).max(64),
}).meta({
  id: "NormalizedAuctionLineage",
  description: "Observed re-bid relations by source identifier only.",
});

export type NormalizedAttemptLink = z.infer<typeof normalizedAttemptLinkSchema>;
export type NormalizedAuctionLineage = z.infer<typeof normalizedAuctionLineageSchema>;
