/** @module 책임: mart.org_round_summary 한 행을 담는 기관 회차 요약 resource와 meta 계약을 소유한다. */
import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema } from "../../../values/rate";

export const organizationAuctionAttemptSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  announcedAt: instantTextSchema,
  openedAt: instantTextSchema.nullable(),
  item: z.strictObject({ codeValueId: positiveBigintTextSchema, label: z.string().min(1).max(128) }).nullable(),
  // eaT 사정률·낙찰률은 소수 셋째 자리까지 관측되며 mart numeric(6,3)과 같다(values/rate.ts).
  floorRate: bidRateWireSchema.nullable(),
  baseAmount: moneyWireSchema,
  winRate: bidRateWireSchema.nullable(),
  secondRate: bidRateWireSchema.nullable(),
  dayFloorRate: bidRateWireSchema.nullable(),
  listCount: nonNegativeCountSchema.nullable(),
  invalidCount: nonNegativeCountSchema.nullable(),
  winnerSupplierPartyId: positiveBigintTextSchema.nullable(),
  supersedesAttemptId: positiveBigintTextSchema.nullable(),
}).meta({ id: "OrganizationAuctionAttempt", description: "One auction attempt summarized from mart.org_round_summary." });

export const organizationAuctionAttemptsMetaSchema = z.strictObject({
  sampleCount: nonNegativeCountSchema,
  martRelease: z.string().min(1).max(64).nullable(),
  computedAt: instantTextSchema.nullable(),
  calcVersion: z.string().min(1).max(32).nullable(),
}).meta({ id: "OrganizationAuctionAttemptsMeta" });

export type OrganizationAuctionAttempt = z.infer<typeof organizationAuctionAttemptSchema>;
