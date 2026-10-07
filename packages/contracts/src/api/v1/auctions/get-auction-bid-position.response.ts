/** @module 책임: 한 회차의 추천 투찰가와 그 근거(규칙 버전·검증 표본·운 기준선)를 공개 응답 하나로 구성한다. */
import { z } from "zod";

import { kstDateTextSchema, kstMonthTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { canonicalDecimalTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { baseRelativeBidRateWireSchema, bidRateWireSchema, percentagePointsWireSchema } from "../../../values/rate";
import { auctionParticipationObservationSchema } from "./participation.resource";

/**
 * 규칙은 시장이 바뀌면 낡는다. 그래서 금액과 함께 어느 판의 규칙인지, 무엇으로 고르고 무엇으로 검증했는지를
 * 늘 같이 싣는다(ADR 0062, AGENTS 7). 버전은 규칙을 확정한 날이다.
 */
export const bidPositionRuleSchema = z.strictObject({
  version: kstDateTextSchema,
  trainedThrough: kstMonthTextSchema,
  validatedFrom: kstMonthTextSchema,
  validatedThrough: kstMonthTextSchema,
}).meta({ id: "BidPositionRule" });

/**
 * 사업자 하나가 낼 금액 한 자리다. 낙찰률은 "1번부터 이 자리까지 함께 냈을 때 검증 기간 회차 중 우리 중 하나가
 * 낙찰한 비율"이라 누적이고, 운 기준선은 같은 장수를 무작위 자리에 냈을 때의 기대값이다. 둘을 떼면 2%가 큰지
 * 작은지 읽을 수 없다.
 *
 * 금액이 주인공이다. 투찰률은 화면마다 분모가 달라 옮겨 적을 때 틀리므로(ADR 0062) 기초금액 대비율은 대조용이다.
 */
export const bidPositionSchema = z.strictObject({
  order: z.number().int().min(1).max(3),
  amount: moneyWireSchema,
  baseRelativeRate: baseRelativeBidRateWireSchema,
  cumulativeWinRate: percentagePointsWireSchema,
  cumulativeLotteryWinRate: percentagePointsWireSchema,
  cumulativeValidationWins: nonNegativeCountSchema,
}).meta({ id: "BidPosition" });

/**
 * 규칙을 고른 뒤 처음 본 달에서 잰 결과다. 검증 기간 수치가 고를 때 참고됐으면(`validation-informed`) 그 수치는
 * 낙관적이므로, 이 봉인 결과가 깨끗한 근거다. 봉인은 지금 두 장 기준으로만 쟀다.
 */
export const bidPositionHoldoutSchema = z.strictObject({
  month: kstMonthTextSchema,
  rounds: nonNegativeCountSchema,
  tickets: z.number().int().min(1).max(3),
  wins: nonNegativeCountSchema,
  lotteryExpectedWins: canonicalDecimalTextSchema,
}).meta({ id: "BidPositionHoldout" });

/**
 * 규칙이 검증된 조건 밖에서는 숫자를 내지 않는다. 같은 비율을 참여 40곳 미만에 쓰면 운보다 나빠졌고(0.29배),
 * 하한율이 다르면 축 자체가 다르다. 이유를 enum으로 내 화면이 "왜 없는지"를 말하게 한다.
 */
export const bidPositionNotApplicableReasonSchema = z.enum([
  "floor-rate-unobserved",
  "floor-rate-outside-rule",
  "participation-unobserved",
  "participation-below-rule",
]).meta({ id: "BidPositionNotApplicableReason" });

export const bidPositionResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("applicable"),
    band: z.enum(["40-69", "70-plus"]),
    // `training`이면 검증 기간 수치가 선택에 쓰이지 않은 표본 밖 결과이고, `validation-informed`면 학습 상위 후보 중
    // 검증 성적으로 골라 낙관적이다. 이 구분이 AGENTS 8의 "보정 상태"다.
    selection: z.enum(["training", "validation-informed"]),
    validationRounds: nonNegativeCountSchema,
    holdout: bidPositionHoldoutSchema.nullable(),
    positions: z.array(bidPositionSchema).min(1).max(3),
  }),
  z.strictObject({
    state: z.literal("not-applicable"),
    reason: bidPositionNotApplicableReasonSchema,
  }),
]).meta({ id: "BidPositionResult" });

/**
 * 계산에 쓴 입력을 결과와 함께 되돌린다. 참여 수는 관측 시각과 짝이며, 규칙의 조건은 "마감 1시간 전 참여 수"라
 * 그보다 이른 관측이면 대역이 바뀔 수 있다는 것을 화면이 마감 시각과 견줘 말할 수 있어야 한다.
 */
export const auctionBidPositionV1ResponseSchema = z.strictObject({
  auctionId: positiveBigintTextSchema,
  revisionId: positiveBigintTextSchema,
  baseAmount: moneyWireSchema,
  floorRate: bidRateWireSchema.nullable(),
  participation: auctionParticipationObservationSchema.nullable(),
  deadlineAt: instantTextSchema.nullable(),
  rule: bidPositionRuleSchema,
  result: bidPositionResultSchema,
}).meta({ id: "AuctionBidPositionV1Response" });

export type AuctionBidPositionV1Response = z.infer<typeof auctionBidPositionV1ResponseSchema>;
export type BidPositionWire = z.infer<typeof bidPositionSchema>;
export type BidPositionNotApplicableReason = z.infer<typeof bidPositionNotApplicableReasonSchema>;
