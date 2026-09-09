/** @module 책임: 회차 명단 조회 실패를 분류하고 내부 의미 값을 공개 명단 응답으로 직렬화한다. */
import { instantCodec, moneyCodec, type AuctionRosterV1Response, type CodeReference } from "@eatbid/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { AuctionRosterIntegrityError, type AuctionRosterQuery, type AuctionRosterReader, type AuctionRosterRecord } from "./auction-roster-reader";
import { AuctionDependencyUnavailable, AuctionNotFound } from "./find-auction";
import type { CodeReferenceRecord } from "./auction-reader";

function code(record: CodeReferenceRecord): CodeReference {
  return { ...record, codeValueId: record.codeValueId.toString(10) };
}
export function toAuctionRosterResponse(record: AuctionRosterRecord): AuctionRosterV1Response {
  return {
    auctionId: record.auctionId.toString(10),
    revisionId: record.revisionId.toString(10),
    state: record.rows.length > 0 ? "observed" : "not-observed",
    rows: record.rows.map((row) => ({
      submissionId: row.submissionId.toString(10),
      rosterOrdinal: row.rosterOrdinal,
      supplier: {
        supplierPartyId: row.supplierPartyId.toString(10),
        sourceSupplierAccountId: row.sourceSupplierAccountId.toString(10),
        name: row.supplierName,
      },
      sourceCalculatedAmount: z.encode(moneyCodec, row.amount),
      submittedAmount: row.effectiveAmount === null ? null : z.encode(moneyCodec, row.effectiveAmount),
      bidRate: { value: row.bidRate, unit: "percentage-points" },
      rank: row.rank,
      submittedAt: row.submittedAt === null ? null : z.encode(instantCodec, row.submittedAt),
      sourceStatus: code(row.sourceStatus),
      withdrawal: row.withdrawal === null ? null : code(row.withdrawal),
    })),
    award: record.award === null ? null : {
      rosterOrdinal: record.award.rosterOrdinal,
      sourceCalculatedAmount: z.encode(moneyCodec, record.award.amount),
      bidRate: { value: record.award.bidRate, unit: "percentage-points" },
      secondRate: record.award.secondRate === null ? null : { value: record.award.secondRate, unit: "percentage-points" },
    },
    meta: {
      rowCount: record.rows.length,
      sourceRosterSize: record.sourceRosterSize,
      observedAt: z.encode(instantCodec, record.observedAt),
      provenance: {
        ...record.provenance,
        observationId: record.provenance.observationId.toString(10),
        normalizedRecordId: record.provenance.normalizedRecordId.toString(10),
      },
    },
  };
}
export class GetAuctionRoster {
  constructor(private readonly reader: AuctionRosterReader) {}
  execute(query: AuctionRosterQuery): Effect.Effect<
    AuctionRosterV1Response, AuctionNotFound | AuctionDependencyUnavailable | AuctionRosterIntegrityError
  > {
    return Effect.tryPromise({
      try: () => this.reader.find(query),
      catch: (cause) => cause instanceof AuctionRosterIntegrityError
        ? cause : new AuctionDependencyUnavailable(cause),
    }).pipe(Effect.flatMap((record) => record === null
      ? Effect.fail(new AuctionNotFound(query.auctionId))
      : Effect.succeed(toAuctionRosterResponse(record))));
  }
}
