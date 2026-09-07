/** @module 책임: 기관 이력의 하한율·낙찰 방식·KST 개찰월 조회 조건과 응답 재현용 조건 표현을 소유한다. */
import { z } from "zod";
import { kstMonthTextSchema } from "../../../atoms/calendar";
import { bidRateTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { bidRateWireSchema } from "../../../values/rate";

// all은 조건 없는 조회, unknown은 해당 사실을 관측하지 못한 행만이다. null 하나로 합치지 않는다.
export const organizationAttemptFloorFilterSchema = z.union([bidRateTextSchema, z.enum(["all", "unknown"])]);
export const organizationAttemptAwardMethodFilterSchema = z.union([positiveBigintTextSchema, z.enum(["all", "unknown"])]);

const allConditionSchema = z.strictObject({ kind: z.literal("all") });
const unknownConditionSchema = z.strictObject({ kind: z.literal("unknown") });
const floorConditionSchema = z.discriminatedUnion("kind", [
  allConditionSchema,
  unknownConditionSchema,
  z.strictObject({ kind: z.literal("exact"), value: bidRateWireSchema }),
]);
const awardMethodConditionSchema = z.discriminatedUnion("kind", [
  allConditionSchema,
  unknownConditionSchema,
  z.strictObject({ kind: z.literal("exact"), codeValueId: positiveBigintTextSchema }),
]);

export const organizationAttemptCohortSchema = z.strictObject({
  floorRate: floorConditionSchema,
  awardMethod: awardMethodConditionSchema,
  // 양끝을 포함한 KST 개찰월이다. null은 월 조건 자체가 없는 조회이며 미확인 개찰일을 뜻하지 않는다.
  period: z.strictObject({ from: kstMonthTextSchema, to: kstMonthTextSchema }).nullable(),
}).meta({ id: "OrganizationAttemptCohort" });

export type OrganizationAttemptFloorFilter = z.infer<typeof organizationAttemptFloorFilterSchema>;
export type OrganizationAttemptAwardMethodFilter = z.infer<typeof organizationAttemptAwardMethodFilterSchema>;
export type OrganizationAttemptCohort = z.infer<typeof organizationAttemptCohortSchema>;
