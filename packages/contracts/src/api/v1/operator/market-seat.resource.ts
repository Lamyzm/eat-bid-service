/** @module 책임: 운영자가 시장 자리를 주고·늘리고·거둘 때 주고받는 자리·업체·명령·결과의 공개 표현을 소유한다(ADR 0071·0072). */
import { z } from "zod";

import { businessNumberTextSchema } from "../../../atoms/business-number";
import { kstDateTextSchema } from "../../../atoms/calendar";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { auctionItemAtomSchema } from "../../../values/auction-item";
import { codeReferenceSchema } from "../../../values/code-reference";

/**
 * 자리의 품목 칸이다. 품목 원자 하나이거나 "품목 제한 없음"(eaT `MN_TRMT_LMT_YN`의 `N`) 하나다(ADR 0072).
 * code value id를 받지 않는 이유는 운영자가 고르는 것이 의미이고, 그 의미가 어느 체계의 어느 값인지는 서버가 정해야
 * 다른 체계의 값이 품목 칸에 앉지 못하기 때문이다(AGENTS 6).
 */
export const marketSeatItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("atom"), atom: auctionItemAtomSchema }),
  z.strictObject({ kind: z.literal("no-main-item-restriction") }),
]).meta({ id: "MarketSeatItem" });

export const marketSeatStateSchema = z.enum(["held", "active", "reclaim", "offer"]).meta({ id: "MarketSeatState" });

/** 자리 변경의 고정 사유다. `other`는 메모가 있어야 한다. 결제가 붙으면 그때 늘린다(PDR-0010). */
export const marketSeatReasonSchema = z.enum(["pilot", "payment-confirmed", "operator-correction", "refund-request", "other"])
  .meta({ id: "MarketSeatReason" });

export const marketSeatEventKindSchema = z.enum([
  "held", "activated", "extended", "revoked", "released", "reclaimed", "offered", "corrected",
]).meta({ id: "MarketSeatEventKind" });

/** 한 번에 주거나 늘릴 수 있는 개월 수다. 시범·월 결제 단위라 1년을 넘지 않는다. */
export const maxMarketSeatMonths = 12;
const monthsSchema = z.number().int().min(1).max(maxMarketSeatMonths);
const memoSchema = z.string().trim().min(1).max(500);

export const marketSeatEventSchema = z.strictObject({
  kind: marketSeatEventKindSchema,
  occurredAt: instantTextSchema,
  reason: marketSeatReasonSchema,
  memo: z.string().max(500).nullable(),
  // 비어 있으면 시스템이 한 일이다.
  actorPrincipalId: positiveBigintTextSchema.nullable(),
  previousEndsAt: instantTextSchema.nullable(),
  nextEndsAt: instantTextSchema.nullable(),
}).meta({ id: "MarketSeatEvent" });

export const operatorWorkspaceSchema = z.strictObject({
  workspaceId: positiveBigintTextSchema,
  name: z.string().min(1).max(200),
  // 운영자 화면은 사업자번호를 항상 전체로 보인다. 자리를 주면 이 번호들이 자리 기간 동안 묶인다(ADR 0071 결정 6).
  businessNumbers: z.array(businessNumberTextSchema).max(20),
}).meta({ id: "OperatorWorkspace" });

export const operatorMarketSeatSchema = z.strictObject({
  marketSeatId: positiveBigintTextSchema,
  workspace: operatorWorkspaceSchema,
  region: codeReferenceSchema,
  item: marketSeatItemSchema,
  state: marketSeatStateSchema,
  // 반열림 `[startsAt, endsAt)`이다. 끝나는 날을 보일 때는 `endsAt` 직전의 KST 날짜다.
  startsAt: instantTextSchema,
  endsAt: instantTextSchema,
  priorityStartedAt: instantTextSchema,
  // 새것부터다.
  events: z.array(marketSeatEventSchema).max(50),
}).meta({ id: "OperatorMarketSeat" });

export const grantMarketSeatCommandSchema = z.strictObject({
  workspaceId: positiveBigintTextSchema,
  // eaT 참가제한지역 code value다. 다른 체계의 값이면 거절한다.
  regionCodeValueId: positiveBigintTextSchema,
  item: marketSeatItemSchema,
  // KST 달력일이다. 오늘이면 지금 시각부터, 뒤 날짜면 그날 0시부터다. 과거는 받지 않는다(ADR 0071 결정 2).
  startDate: kstDateTextSchema,
  months: monthsSchema,
  reason: marketSeatReasonSchema,
  memo: memoSchema.optional(),
}).meta({ id: "GrantMarketSeatCommand" });

export const extendMarketSeatCommandSchema = z.strictObject({
  months: monthsSchema,
  reason: marketSeatReasonSchema,
  memo: memoSchema.optional(),
}).meta({ id: "ExtendMarketSeatCommand" });

export const revokeMarketSeatCommandSchema = z.strictObject({
  reason: marketSeatReasonSchema,
  memo: memoSchema.optional(),
}).meta({ id: "RevokeMarketSeatCommand" });

/**
 * 저장하지 못한 이유다. 409 대신 성공 응답 안의 결과로 돌려주는 이유는 공개 Problem code가 상태마다 하나라(409는 늘
 * `CONFLICT`) 운영자에게 "누가 언제까지 쓰는지"를 말할 수 없기 때문이다.
 */
export const marketSeatRejectionSchema = z.discriminatedUnion("reason", [
  // 같은 (지역, 품목 칸)을 다른 업체가 겹치는 기간에 쓴다.
  z.strictObject({ reason: z.literal("period-overlap"), holder: operatorWorkspaceSchema.pick({ workspaceId: true, name: true }), holderEndsAt: instantTextSchema }),
  // 이 업체의 사업자번호를 다른 업체가 자리 기간에 묶어 두었다.
  z.strictObject({ reason: z.literal("business-claimed-elsewhere"), businessNumber: businessNumberTextSchema, holder: operatorWorkspaceSchema.pick({ workspaceId: true, name: true }) }),
  // 등록된 사업자번호가 없는 업체에는 자리를 주지 않는다 — 한 업체가 두 이름으로 받는 것을 막을 수 없다.
  z.strictObject({ reason: z.literal("no-registered-business") }),
  // "품목 제한 없음" 코드가 아직 한 번도 관측되지 않았다. eat-v6 수집이 한 번 돈 뒤에 다시 준다.
  z.strictObject({ reason: z.literal("item-not-observed") }),
  // 고른 지역이 eaT 참가제한지역 체계의 값이 아니다.
  z.strictObject({ reason: z.literal("region-not-eligibility-area") }),
  z.strictObject({ reason: z.literal("start-in-past") }),
  // 이미 끝났거나 거둔 자리는 늘리거나 거두지 않는다.
  z.strictObject({ reason: z.literal("seat-ended") }),
  z.strictObject({ reason: z.literal("memo-required") }),
]).meta({ id: "MarketSeatRejection" });

export const marketSeatCommandResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("saved"), seat: operatorMarketSeatSchema }),
  z.strictObject({ kind: z.literal("rejected"), rejection: marketSeatRejectionSchema }),
]).meta({ id: "MarketSeatCommandResult" });

export type MarketSeatItem = z.infer<typeof marketSeatItemSchema>;
export type MarketSeatReason = z.infer<typeof marketSeatReasonSchema>;
export type OperatorMarketSeat = z.infer<typeof operatorMarketSeatSchema>;
export type OperatorWorkspace = z.infer<typeof operatorWorkspaceSchema>;
export type GrantMarketSeatCommand = z.infer<typeof grantMarketSeatCommandSchema>;
export type ExtendMarketSeatCommand = z.infer<typeof extendMarketSeatCommandSchema>;
export type RevokeMarketSeatCommand = z.infer<typeof revokeMarketSeatCommandSchema>;
export type MarketSeatRejection = z.infer<typeof marketSeatRejectionSchema>;
export type MarketSeatCommandResult = z.infer<typeof marketSeatCommandResultSchema>;
