import type { AuctionResponse } from "@eatbid/contracts";
import { Effect } from "effect";
import type { AuctionReader, AuctionRecord } from "./auction-reader";
import type { AuctionId } from "../domain/auction-id";
import { auctionIdToString } from "../domain/auction-id";

export interface FindAuctionInput {
  readonly auctionId: AuctionId;
}

export class AuctionNotFound extends Error {
  readonly code = "AUCTION_NOT_FOUND" as const;

  constructor(readonly auctionId: AuctionId) {
    super(`Auction ${auctionIdToString(auctionId)} was not found`);
    this.name = "AuctionNotFound";
  }
}

export class AuctionDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Auction repository is unavailable", { cause });
    this.name = "AuctionDependencyUnavailable";
  }
}

function timestamp(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function toAuctionResponse(record: AuctionRecord): AuctionResponse {
  return {
    auctionId: auctionIdToString(record.auctionId),
    revisionId: record.revisionId.toString(10),
    title: record.title,
    status: record.status,
    displayBidNumber: record.displayBidNumber,
    announcedAt: timestamp(record.announcedAt),
    deadlineAt: timestamp(record.deadlineAt),
    openedAt: timestamp(record.openedAt),
    baseAmount: record.baseAmount,
    plannedAmount: record.plannedAmount,
    currency: record.currency,
    provenance: {
      sourceSystem: record.provenance.sourceSystem,
      externalBidId: record.provenance.externalBidId,
      observationId: record.provenance.observationId.toString(10),
      normalizedRecordId: record.provenance.normalizedRecordId.toString(10),
      contentSha256: record.provenance.contentSha256,
    },
  };
}

export class FindAuction {
  constructor(private readonly reader: AuctionReader) {}

  execute(input: FindAuctionInput): Effect.Effect<
    AuctionResponse,
    AuctionNotFound | AuctionDependencyUnavailable,
    never
  > {
    return Effect.tryPromise({
      try: () => this.reader.findById(input.auctionId),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((record) => record === null
        ? Effect.fail(new AuctionNotFound(input.auctionId))
        : Effect.succeed(toAuctionResponse(record))),
    );
  }
}
