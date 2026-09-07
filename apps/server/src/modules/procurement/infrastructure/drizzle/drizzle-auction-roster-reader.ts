/** @module 책임: 발행 회차의 명단 수·낙찰 좌표를 검증하고 DB 행을 의미 값이 보존된 명단 record로 옮긴다. */
import type { ObservedBidRate } from "@eatbid/domain";
import {
  AuctionRosterIntegrityError, type AuctionRosterQuery, type AuctionRosterReader,
  type AuctionRosterRecord, type RosterSubmissionRecord,
} from "../../application/auction-roster-reader";
import type { CodeReferenceRecord } from "../../application/auction-reader";
import { auctionId } from "../../domain/auction-id";
import { auctionRosterQuery } from "./auction-roster-query";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { bigintValue, moneyValue, observedBidRateValue } from "./postgres-row-values";

type DbId = string | bigint;
type Timestamp = Parameters<typeof postgresInstant>[0];
type RosterRow = Readonly<{
  auction_id: DbId; revision_id: DbId; observation_id: DbId; normalized_record_id: DbId;
  source_system: string; content_sha256: string; fetched_at: Timestamp;
  expected_count: number | null; source_roster_size: number | null;
  submission_id: DbId | null; roster_ordinal: number; supplier_party_id: DbId;
  source_supplier_account_id: DbId; supplier_name: string | null;
  amount: string; effective_amount: string | null; currency: string; bid_rate: string;
  rank: number | null; submitted_at: Timestamp;
  status_id: DbId; status_code: string; status_scheme: string; status_label: string | null;
  withdrawal_id: DbId | null; withdrawal_code: string | null; withdrawal_scheme: string | null; withdrawal_label: string | null;
  awarded_roster_ordinal: number | null; awarded_amount: string | null; award_currency: string | null;
  awarded_rate: string | null; runner_up_rate: string | null;
}>;

function label(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}
function rate(value: string | null): ObservedBidRate {
  const parsed = observedBidRateValue(value);
  if (parsed === null) throw new AuctionRosterIntegrityError("명단 비율이 없습니다");
  return parsed;
}
function withdrawal(row: RosterRow): CodeReferenceRecord | null {
  if (row.withdrawal_id === null) return null;
  if (row.withdrawal_code === null || row.withdrawal_scheme === null) {
    throw new AuctionRosterIntegrityError("명단 철회 코드의 체계가 없습니다");
  }
  return {
    codeValueId: bigintValue(row.withdrawal_id), code: row.withdrawal_code,
    scheme: row.withdrawal_scheme, label: label(row.withdrawal_label),
  };
}
function submission(row: RosterRow): RosterSubmissionRecord {
  if (row.submission_id === null) throw new AuctionRosterIntegrityError("명단 식별자가 없습니다");
  return {
    submissionId: bigintValue(row.submission_id), rosterOrdinal: row.roster_ordinal,
    supplierPartyId: bigintValue(row.supplier_party_id),
    sourceSupplierAccountId: bigintValue(row.source_supplier_account_id), supplierName: label(row.supplier_name),
    amount: moneyValue(row.amount, row.currency, true),
    effectiveAmount: moneyValue(row.effective_amount, row.currency, false),
    bidRate: rate(row.bid_rate), rank: row.rank, submittedAt: postgresInstant(row.submitted_at),
    sourceStatus: { codeValueId: bigintValue(row.status_id), code: row.status_code,
      scheme: row.status_scheme, label: label(row.status_label) },
    withdrawal: withdrawal(row),
  };
}
export class DrizzleAuctionRosterReader implements AuctionRosterReader {
  constructor(private readonly database: AuctionReadDatabase) {}
  async find(query: AuctionRosterQuery): Promise<AuctionRosterRecord | null> {
    const result = await this.database.execute(auctionRosterQuery(query));
    if (!Array.isArray(result)) throw new AuctionRosterIntegrityError("명단 응답이 행 배열이 아닙니다");
    const rows = result as RosterRow[];
    const first = rows[0];
    if (!first) return null;
    const submissions = rows.filter((row) => row.submission_id !== null);
    // sourceRosterSize는 다른 블록의 관측이라 행 수와 같다고 강제하지 않는다. 정규화된 명단 배열만 대조한다.
    if (submissions.length > 2048 ||
      (first.expected_count !== null && first.expected_count !== submissions.length) ||
      (first.expected_count === null && submissions.length !== 0) ||
      new Set(submissions.map((row) => row.roster_ordinal)).size !== submissions.length) {
      throw new AuctionRosterIntegrityError("정규화 명단과 발행 행 수가 일치하지 않습니다");
    }
    if (first.awarded_roster_ordinal !== null &&
      !submissions.some((row) => row.roster_ordinal === first.awarded_roster_ordinal)) {
      throw new AuctionRosterIntegrityError("낙찰 좌표가 명단에 없습니다");
    }
    try {
      const observedAt = postgresInstant(first.fetched_at);
      if (observedAt === null) throw new TypeError("명단 관측 시각이 없습니다");
      return {
        auctionId: auctionId(bigintValue(first.auction_id)), revisionId: bigintValue(first.revision_id),
        rows: submissions.map(submission), sourceRosterSize: first.source_roster_size, observedAt,
        provenance: {
          sourceSystem: first.source_system, observationId: bigintValue(first.observation_id),
          normalizedRecordId: bigintValue(first.normalized_record_id), contentSha256: first.content_sha256,
        },
        award: first.awarded_roster_ordinal === null ? null : {
          rosterOrdinal: first.awarded_roster_ordinal,
          amount: moneyValue(first.awarded_amount, first.award_currency ?? "", true),
          bidRate: rate(first.awarded_rate), secondRate: observedBidRateValue(first.runner_up_rate),
        },
      };
    } catch (cause) {
      if (cause instanceof AuctionRosterIntegrityError) throw cause;
      throw new AuctionRosterIntegrityError("명단 의미 값이 유효하지 않습니다", { cause });
    }
  }
}
