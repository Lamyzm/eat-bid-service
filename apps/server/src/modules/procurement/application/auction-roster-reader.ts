/** @module 책임: 회차 명단 읽기의 내부 record와 조회 port 및 무결성 실패를 정의한다. */
import type { Money, ObservedBidRate, Temporal } from "@eatbid/domain";
import type { AuctionId } from "../domain/auction-id";
import type { CodeReferenceRecord } from "./auction-reader";

export interface AuctionRosterQuery {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint | null;
}
export interface RosterSubmissionRecord {
  readonly submissionId: bigint;
  readonly rosterOrdinal: number;
  readonly supplierPartyId: bigint;
  readonly sourceSupplierAccountId: bigint;
  readonly supplierName: string | null;
  readonly amount: Money;
  readonly effectiveAmount: Money | null;
  readonly bidRate: ObservedBidRate;
  readonly rank: number | null;
  readonly submittedAt: Temporal.Instant | null;
  readonly sourceStatus: CodeReferenceRecord;
  readonly withdrawal: CodeReferenceRecord | null;
}
export interface AuctionRosterRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly rows: readonly RosterSubmissionRecord[];
  readonly sourceRosterSize: number | null;
  readonly observedAt: Temporal.Instant;
  readonly provenance: {
    readonly sourceSystem: string;
    readonly observationId: bigint;
    readonly normalizedRecordId: bigint;
    readonly contentSha256: string;
  };
  readonly award: {
    readonly rosterOrdinal: number;
    readonly amount: Money;
    readonly bidRate: ObservedBidRate;
    readonly secondRate: ObservedBidRate | null;
  } | null;
}
// 예상 행 수와 실제 명단이 다르면 재시도 가능한 DB 장애와 구별하여 결함으로 보고한다.
export class AuctionRosterIntegrityError extends Error {}
export interface AuctionRosterReader {
  find(query: AuctionRosterQuery): Promise<AuctionRosterRecord | null>;
}
