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
  // 품목 라벨 상한은 기관 이름(AuctionOrganization.name)과 같은 512자다. 원본 라벨이 잘려 들어오는
  // 것보다 계약이 통째로 실패하는 편이 관측 사실을 왜곡하지 않는다.
  item: z.strictObject({ codeValueId: positiveBigintTextSchema, label: z.string().min(1).max(512) }).nullable(),
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
  // 표본이 어떤 품목으로 좁혀졌는지는 응답만 보고 재현돼야 한다(AGENTS 7). 요청 query의 item을
  // 그대로 되돌려 싣고, 품목을 지정하지 않은 전체 조회는 null이다.
  item: positiveBigintTextSchema.nullable(),
  martRelease: z.string().min(1).max(64).nullable(),
  computedAt: instantTextSchema.nullable(),
  calcVersion: z.string().min(1).max(32).nullable(),
}).meta({ id: "OrganizationAuctionAttemptsMeta" });

export type OrganizationAuctionAttempt = z.infer<typeof organizationAuctionAttemptSchema>;
