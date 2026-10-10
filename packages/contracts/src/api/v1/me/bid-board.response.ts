/** @module 책임: 오늘 투찰 화면 한 장의 공개 응답(관심 지역 상태·마감 창·맞춤 방법 머리·공고 행)을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema } from "../../../values/rate";
import {
  bidPositionMarketEvidenceSchema,
  bidPositionMarketPickReasonSchema,
  bidPositionMarketPickSchema,
  bidPositionResultSchema,
  bidPositionRuleSchema,
  bidPositionSchema,
} from "../auctions/get-auction-bid-position.response";

const marketPositionSchema = bidPositionSchema.pick({ order: true, amount: true, baseRelativeRate: true });
// 예비는 두 장 뒤의 3~5순위다. 두 장 자리(1~2)와 같은 순번 공간을 쓰면 화면이 1번 사업자 금액과 예비를 섞어 읽는다.
const spareMarketPositionSchema = bidPositionSchema.pick({ amount: true, baseRelativeRate: true })
  .safeExtend({ order: z.number().int().min(3).max(5) });

/**
 * 행마다 맞춤 금액이다. 배수는 요청 하나에 한 번 고른 같은 값이라 여기에는 금액만 싣고, 방법 판·창·근거는 머리
 * (`marketPick`)에 한 번 싣는다. 예비는 표본 밖 성적을 잰 적 없는 순위라 두 장 자리와 따로 둔다(PDR-0008).
 */
export const bidBoardMarketCellSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("applicable"),
    positions: z.array(marketPositionSchema).min(1).max(2),
    single: marketPositionSchema,
    spares: z.array(spareMarketPositionSchema).max(3),
  }),
  z.strictObject({
    state: z.literal("not-applicable"),
    reasons: z.array(bidPositionMarketPickReasonSchema).min(1).max(5),
  }),
]).meta({ id: "BidBoardMarketCell" });

export const bidBoardRowSchema = z.strictObject({
  auctionId: positiveBigintTextSchema,
  closesAt: instantTextSchema.nullable(),
  organizationLabel: z.string().min(1).max(200).nullable(),
  title: z.string().min(1).max(500).nullable(),
  itemLabel: z.string().min(1).max(200).nullable(),
  displayBidNo: z.string().min(1).max(64).nullable(),
  baseAmount: moneyWireSchema.nullable(),
  floorRate: bidRateWireSchema.nullable(),
  bidCount: nonNegativeCountSchema.nullable(),
  observedAt: instantTextSchema,
  // 기초금액이 아직 관측되지 않은 공고는 두 방법 모두 금액을 만들 수 없어 null이다. 행을 빼면 공고를 놓치고, 이유 enum에
  // 없는 값을 지어내면 계약이 거짓이 된다 — 화면은 `baseAmount: null`을 보고 "기초금액 미확인"이라고 말한다.
  rule: bidPositionResultSchema.nullable(),
  market: bidBoardMarketCellSchema.nullable(),
}).meta({ id: "BidBoardRow" });

/**
 * 배수는 요청당 한 번 고르므로 방법 판·창·공고 수·근거를 머리에 한 번 싣는다. 근거는 공고 상세 응답에서는 결과 안에 있지만
 * 여기서는 결과와 무관하게 늘 보여야 해 머리로 올린다. 같은 bid-position family 안의 조립이다(AGENTS 16).
 */
export const bidBoardMarketPickSchema = bidPositionMarketPickSchema.omit({ result: true }).safeExtend({
  state: z.enum(["picked", "not-applicable"]),
  reasons: z.array(bidPositionMarketPickReasonSchema).max(5),
  marketRounds: nonNegativeCountSchema.nullable(),
  linkedBusinesses: nonNegativeCountSchema,
  evidence: z.array(bidPositionMarketEvidenceSchema).min(1),
}).meta({ id: "BidBoardMarketPick" });

/**
 * 관심 지역을 확인하지 않은 워크스페이스는 행이 없다. 지역 없이 전국 공고를 펼치면 "내 시장"이 아닌 공고에 맞춤 금액이
 * 붙는다(PDR-0001: 지역은 사용자가 정한다).
 */
export const myBidBoardV1ResponseSchema = z.discriminatedUnion("regionPreference", [
  z.strictObject({
    regionPreference: z.literal("confirmed"),
    asOf: instantTextSchema,
    /** 이 날짜 KST 0시 전에 마감하는 공고만 실었다 — 오늘과 내일이다. */
    closesBeforeDate: kstDateTextSchema,
    rule: bidPositionRuleSchema,
    marketPick: bidBoardMarketPickSchema,
    // 서버가 열린 공고 목록을 쪽 상한(200건 × 5쪽)까지 따라 읽고 하한율로 거른 결과다.
    rows: z.array(bidBoardRowSchema).max(1000),
    // 쪽 상한에 닿아 늦게 마감하는 공고 일부를 읽지 못했다. 빠졌다는 사실은 화면이 말해야 한다.
    truncated: z.boolean(),
  }),
  z.strictObject({
    regionPreference: z.literal("unconfirmed"),
    asOf: instantTextSchema,
    rows: z.array(bidBoardRowSchema).max(0),
  }),
]).meta({ id: "MyBidBoardV1Response" });

export type MyBidBoardV1Response = z.infer<typeof myBidBoardV1ResponseSchema>;
export type BidBoardRowWire = z.infer<typeof bidBoardRowSchema>;
export type BidBoardMarketCellWire = z.infer<typeof bidBoardMarketCellSchema>;
export type BidBoardMarketPickWire = z.infer<typeof bidBoardMarketPickSchema>;
