import { z } from "zod";

import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { percentagePoints3WireSchema } from "../../../values/rate";

export const organizationAuctionAttemptSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  announcedAt: instantTextSchema,
  openedAt: instantTextSchema.nullable(),
  item: z.strictObject({ codeValueId: positiveBigintTextSchema, label: z.string().min(1).max(128) }).nullable(),
  // mart.org_round_summary 비율 열은 numeric(6,3)이라 3자리 wire 계약을 쓴다(values/rate.ts).
  floorRate: percentagePoints3WireSchema.nullable(),
  baseAmount: moneyWireSchema,
  winRate: percentagePoints3WireSchema.nullable(),
  secondRate: percentagePoints3WireSchema.nullable(),
  dayFloorRate: percentagePoints3WireSchema.nullable(),
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
