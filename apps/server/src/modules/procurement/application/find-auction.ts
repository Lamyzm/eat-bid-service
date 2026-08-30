import {
  instantCodec,
  moneyCodec,
  type AuctionV1Response,
} from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
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

function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

export function toAuctionResponse(record: AuctionRecord): AuctionV1Response {
  return {
    identity: {
      // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
      auctionId: auctionIdToString(record.auctionId),
      revisionId: record.revisionId.toString(10),
      externalBidId: record.provenance.externalBidId,
      displayBidNumber: record.displayBidNumber,
      title: record.title,
      status: record.status,
    },
    schedule: {
      announcedAt: z.encode(instantCodec, record.announcedAt),
      deadlineAt: instantText(record.deadlineAt),
      openedAt: instantText(record.openedAt),
    },
    pricing: {
      baseAmount: z.encode(moneyCodec, record.baseAmount),
      plannedAmount: record.plannedAmount === null ? null : z.encode(moneyCodec, record.plannedAmount),
    },
    provenance: {
      sourceSystem: record.provenance.sourceSystem,
      observationId: record.provenance.observationId.toString(10),
      normalizedRecordId: record.provenance.normalizedRecordId.toString(10),
      contentSha256: record.provenance.contentSha256,
    },
  };
}

export class FindAuction {
  constructor(private readonly reader: AuctionReader) {}

  execute(input: FindAuctionInput): Effect.Effect<
    AuctionV1Response,
    AuctionNotFound | AuctionDependencyUnavailable,
    never
  > {
    // "없음"과 의존성 장애를 타입이 있는 실패 채널로 분리해 HTTP 계층이 결함과 혼동하지 않게 한다.
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
