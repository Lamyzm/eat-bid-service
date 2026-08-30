import type { AuctionId } from "../domain/auction-id";

export interface AuctionRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly title: string;
  readonly status: string;
  readonly displayBidNumber: string | null;
  readonly announcedAt: Date | null;
  readonly deadlineAt: Date | null;
  readonly openedAt: Date | null;
  readonly baseAmount: string | null;
  readonly plannedAmount: string | null;
  readonly currency: string;
  readonly provenance: {
    readonly sourceSystem: string;
    readonly externalBidId: string;
    readonly observationId: bigint;
    readonly normalizedRecordId: bigint;
    readonly contentSha256: string;
  };
}

export interface AuctionReader {
  findById(id: AuctionId): Promise<AuctionRecord | null>;
}
