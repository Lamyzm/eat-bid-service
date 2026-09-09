/** @module 책임: 회차 명단의 업체 참조·의미 값과 같은 관측의 낙찰·출처 resource를 정의한다. */
import { z } from "zod";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { codeReferenceSchema } from "../../../values/code-reference";
import { moneyWireSchema } from "../../../values/money";
import { auctionProvenanceSchema } from "../../../values/provenance";
import { observedBidRateWireSchema } from "../../../values/rate";

export const auctionRosterSubmissionSchema = z.strictObject({
  submissionId: positiveBigintTextSchema,
  rosterOrdinal: nonNegativeCountSchema,
  supplier: z.strictObject({
    supplierPartyId: positiveBigintTextSchema,
    sourceSupplierAccountId: positiveBigintTextSchema,
    name: z.string().min(1).max(512).nullable(),
  }),
  // BID_CALC_AMT에는 자리표시자가 있으므로 제출 금액과 이름부터 분리한다(ADR 0041).
  sourceCalculatedAmount: moneyWireSchema,
  submittedAmount: moneyWireSchema.nullable(),
  bidRate: observedBidRateWireSchema,
  rank: nonNegativeCountSchema.nullable(),
  submittedAt: instantTextSchema.nullable(),
  sourceStatus: codeReferenceSchema,
  withdrawal: codeReferenceSchema.nullable(),
}).meta({ id: "AuctionRosterSubmission" });

export const auctionRosterAwardSchema = z.strictObject({
  rosterOrdinal: nonNegativeCountSchema,
  sourceCalculatedAmount: moneyWireSchema,
  bidRate: observedBidRateWireSchema,
  secondRate: observedBidRateWireSchema.nullable(),
}).meta({ id: "AuctionRosterAward" });

export const auctionRosterMetaSchema = z.strictObject({
  rowCount: nonNegativeCountSchema,
  sourceRosterSize: nonNegativeCountSchema.nullable(),
  observedAt: instantTextSchema,
  provenance: auctionProvenanceSchema,
}).meta({ id: "AuctionRosterMeta" });
