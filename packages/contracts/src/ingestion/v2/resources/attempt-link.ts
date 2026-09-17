/** @module 책임: 재입찰 사슬을 원본 식별자 관계로만 표현하고 원천이 붙인 게시 종류를 함께 싣는 계보 계약을 소유한다. */
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
  /**
   * 원천이 말한 게시 종류(`ds_info.PBANC_CHG_GB_CD`, 000 일반공고 / 001 변경공고 / 003 재입찰)다.
   * 계보에 두는 이유는 이것이 재입찰의 진짜 신호이기 때문이다 — `RBID_YN`은 이름과 달리 일반공고에서도
   * 대부분 `Y`라 그것으로 거르면 거의 전부가 통과한다(`docs/audit-source/SOURCE-FIELDS.md` T13).
   * 사슬을 잇는 것은 여전히 `links`와 `parentExternalBidId`이고, 이 값은 그 사슬 위에서 이 게시가
   * 무엇인지 원천이 붙인 이름이다. 변경공고는 사슬을 늘리지 않고 같은 차수를 고쳐 다시 낸 것이라
   * 셋을 한 코드 체계로 받는다.
   * optional인 이유는 `location.eligibilityAreas`·`terms.soloBidMethod`와 같다: 이 필드가 생기기 전에
   * 봉인된 payload에는 키가 없고, 없는 키를 실패로 보면 replay 전의 관측이 전부 막힌다(ADR 0038).
   */
  changeKind: sourceCodedValueSchema.nullable().optional(),
}).meta({
  id: "NormalizedAuctionLineage",
  description: "Observed re-bid relations by source identifier, with the source's own announcement change kind.",
});

export type NormalizedAttemptLink = z.infer<typeof normalizedAttemptLinkSchema>;
export type NormalizedAuctionLineage = z.infer<typeof normalizedAuctionLineageSchema>;
