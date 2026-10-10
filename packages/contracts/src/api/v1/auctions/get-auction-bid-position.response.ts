/**
 * @module 책임: 한 회차의 추천 투찰가(전국 규칙과 최근 3개월 맞춤)와 그 근거(규칙 버전·검증 표본·운 기준선)를 공개 응답
 * 하나로 구성한다.
 */
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
 * 규칙이 검증된 조건 밖에서는 숫자를 내지 않는다. 표에 없는 하한율은 축 자체가 다르고, 참여 2곳 미만은 대역이 없다.
 * 실패한 조건을 모두 내 화면이 "왜 없는지"를 한 번에 말하게 한다.
 */
export const bidPositionNotApplicableReasonSchema = z.enum([
  "floor-rate-unobserved",
  "floor-rate-outside-rule",
  "participation-unobserved",
  "participation-below-rule",
]).meta({ id: "BidPositionNotApplicableReason" });

/**
 * 대역을 고른 참여 수의 출처다. 규칙은 마감 1시간 전 참여 수로 대역을 정의했으므로, 그보다 이른 관측은 보정표로 옮긴
 * 추정값으로 고른다. 관측값과 추정값을 한 숫자로 합치면 화면이 추정을 관측처럼 보인다(AGENTS 3).
 */
export const bidCountBasisSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observed"), bidCount: nonNegativeCountSchema }),
  z.strictObject({
    kind: z.literal("estimated"),
    observedBidCount: nonNegativeCountSchema,
    hoursBeforeDeadline: nonNegativeCountSchema,
    estimatedBidCount: nonNegativeCountSchema,
  }),
]).meta({ id: "BidCountBasis" });

export const bidPositionResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("applicable"),
    band: z.strictObject({ minBidCount: nonNegativeCountSchema, maxBidCount: nonNegativeCountSchema.nullable() }),
    bidCountBasis: bidCountBasisSchema,
    // 표본 밖 두 채점(검증 기간·봉인 달)을 합친 두 장 배수의 95% 하한이 1 이하면 `weak`다. 그 대역의 금액은 운과
    // 구별되지 않을 수 있다는 뜻이며 화면이 그대로 말해야 한다.
    evidence: z.enum(["clear", "weak"]),
    // `training`이면 검증 기간 수치가 선택에 쓰이지 않은 표본 밖 결과이고, `validation-informed`면 학습 상위 후보 중
    // 검증 성적으로 골라 낙관적이다. 이 구분이 AGENTS 8의 "보정 상태"다.
    selection: z.enum(["training", "validation-informed"]),
    validationRounds: nonNegativeCountSchema,
    holdout: bidPositionHoldoutSchema.nullable(),
    positions: z.array(bidPositionSchema).min(1).max(3),
  }),
  z.strictObject({
    state: z.literal("not-applicable"),
    reasons: z.array(bidPositionNotApplicableReasonSchema).min(1).max(4),
  }),
]).meta({ id: "BidPositionResult" });

/**
 * 맞춤 금액을 내지 않은 이유다. 걸어가기 채점은 하한율 90 회차에서만 했고, 시장은 요청자 워크스페이스에 등록돼 원본에서
 * 관측된 사업자가 정한다. 최근 창의 공고가 검증한 가장 작은 창보다 적으면 근거 밖이라 내지 않는다.
 */
export const bidPositionMarketPickReasonSchema = z.enum([
  "floor-rate-unobserved",
  "floor-rate-outside-market-pick",
  "no-linked-business",
  "market-rounds-below-minimum",
  "market-data-unavailable",
]).meta({ id: "BidPositionMarketPickReason" });

/**
 * 매달 다시 고르는 방법을 각 공고보다 앞선 기록만 써서 채점한 기간별 결과다. 기대 낙찰은 예정가격 추첨을 적분한 두 장 기준 값이라
 * 추첨 운을 뺐다. 같은 공고에 전국 규칙·지금 낸 금액·운을 넣은 값을 나란히 실어야 크기를 읽을 수 있다. 근거는 한 시장(두 사업자가
 * 넣은 하한율 90% 공고)에서만 쟀다. 한 번 뽑힌 실제 낙찰 수는 잡음이 커서 싣지 않는다.
 */
export const bidPositionMarketEvidenceSchema = z.strictObject({
  from: kstMonthTextSchema,
  through: kstMonthTextSchema,
  rounds: nonNegativeCountSchema,
  expectedWins: canonicalDecimalTextSchema,
  ruleExpectedWins: canonicalDecimalTextSchema,
  currentExpectedWins: canonicalDecimalTextSchema,
  lotteryExpectedWins: canonicalDecimalTextSchema,
}).meta({ id: "BidPositionMarketEvidence" });

/**
 * 최근 3개월 맞춤이다. 요청자 워크스페이스의 등록 사업자가 창 안에 넣은 공고의 실제 경쟁 투찰 배치로 매번 다시 고른다.
 * 그래서 같은 공고라도 워크스페이스와 달에 따라 금액이 다르며, 창과 표본 수를 금액과 늘 함께 싣는다(AGENTS 7·8).
 */
export const bidPositionMarketPickSchema = z.strictObject({
  version: kstDateTextSchema,
  windowMonths: z.number().int().min(1).max(12),
  minimumRounds: nonNegativeCountSchema,
  window: z.strictObject({ fromMonth: kstMonthTextSchema, throughMonth: kstMonthTextSchema }),
  result: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("applicable"),
      marketRounds: nonNegativeCountSchema,
      linkedBusinesses: nonNegativeCountSchema,
      positions: z.array(bidPositionSchema.pick({ order: true, amount: true, baseRelativeRate: true })).min(1).max(2),
      // 한 곳만 넣는 공고에 쓸 금액이다. 두 장의 1번과 다를 수 있다.
      single: bidPositionSchema.pick({ order: true, amount: true, baseRelativeRate: true }),
      evidence: z.array(bidPositionMarketEvidenceSchema).min(1),
    }),
    z.strictObject({
      state: z.literal("not-applicable"),
      reasons: z.array(bidPositionMarketPickReasonSchema).min(1).max(5),
      // 시장을 읽지 않았으면(사업자 없음·하한율 밖) null이다. 0과 섞으면 "읽었는데 없었다"로 보인다.
      marketRounds: nonNegativeCountSchema.nullable(),
    }),
  ]),
}).meta({ id: "BidPositionMarketPick" });

/**
 * 계산에 쓴 입력을 결과와 함께 되돌린다. 참여 수는 관측 시각과 짝이고, 대역을 고른 수가 그 관측인지 추정인지는
 * `result.bidCountBasis`가 말한다.
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
  marketPick: bidPositionMarketPickSchema,
}).meta({ id: "AuctionBidPositionV1Response" });

export type AuctionBidPositionV1Response = z.infer<typeof auctionBidPositionV1ResponseSchema>;
export type BidPositionWire = z.infer<typeof bidPositionSchema>;
export type BidPositionNotApplicableReason = z.infer<typeof bidPositionNotApplicableReasonSchema>;
export type BidCountBasisWire = z.infer<typeof bidCountBasisSchema>;
export type BidPositionMarketPickWire = z.infer<typeof bidPositionMarketPickSchema>;
export type BidPositionMarketPickReason = z.infer<typeof bidPositionMarketPickReasonSchema>;
