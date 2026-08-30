import type { AuctionId } from "../domain/auction-id";
import type { Money, Temporal } from "@eatbid/domain";

export interface AuctionRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly title: string;
  readonly status: string;
  readonly displayBidNumber: string | null;
  readonly announcedAt: Temporal.Instant;
  readonly deadlineAt: Temporal.Instant | null;
  readonly openedAt: Temporal.Instant | null;
  readonly baseAmount: Money;
  readonly plannedAmount: Money | null;
  readonly provenance: {
    readonly sourceSystem: string;
    readonly externalBidId: string;
    readonly observationId: bigint;
    readonly normalizedRecordId: bigint;
    readonly contentSha256: string;
  };
}

/**
 * 애플리케이션 포트는 저장소 행이나 query builder를 노출하지 않는다.
 * 도메인 값과 출처만 반환해야 저장 기술이 use case의 계약을 바꾸지 못한다.
 */
export interface AuctionReader {
  findById(id: AuctionId): Promise<AuctionRecord | null>;
}
