/** @module 책임: 회차 명단 application record를 공개 명단 V1 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type AuctionRosterV1Response } from "@eatbid/contracts";
import { z } from "zod";
import { bigintText, codeReferenceWire, instantText, observedBidRateWire } from "../../../../platform/http/wire";
import type { AuctionRosterRecord } from "../../application/auction-roster-reader";

export function toAuctionRosterResponse(record: AuctionRosterRecord): AuctionRosterV1Response {
  return {
    auctionId: bigintText(record.auctionId),
    revisionId: bigintText(record.revisionId),
    state: record.rows.length > 0 ? "observed" : "not-observed",
    rows: record.rows.map((row) => ({
      submissionId: bigintText(row.submissionId),
      rosterOrdinal: row.rosterOrdinal,
      supplier: {
        supplierPartyId: bigintText(row.supplierPartyId),
        sourceSupplierAccountId: bigintText(row.sourceSupplierAccountId),
        name: row.supplierName,
      },
      sourceCalculatedAmount: z.encode(moneyCodec, row.amount),
      submittedAmount: row.effectiveAmount === null ? null : z.encode(moneyCodec, row.effectiveAmount),
      bidRate: observedBidRateWire(row.bidRate),
      rank: row.rank,
      submittedAt: instantText(row.submittedAt),
      sourceStatus: codeReferenceWire(row.sourceStatus),
      withdrawal: codeReferenceWire(row.withdrawal),
    })),
    award: record.award === null ? null : {
      rosterOrdinal: record.award.rosterOrdinal,
      sourceCalculatedAmount: z.encode(moneyCodec, record.award.amount),
      bidRate: observedBidRateWire(record.award.bidRate),
      secondRate: observedBidRateWire(record.award.secondRate),
    },
    meta: {
      rowCount: record.rows.length,
      sourceRosterSize: record.sourceRosterSize,
      observedAt: instantText(record.observedAt),
      provenance: {
        sourceSystem: record.provenance.sourceSystem,
        observationId: bigintText(record.provenance.observationId),
        normalizedRecordId: bigintText(record.provenance.normalizedRecordId),
        contentSha256: record.provenance.contentSha256,
      },
    },
  };
}
