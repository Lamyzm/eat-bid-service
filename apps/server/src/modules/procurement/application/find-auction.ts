/** @module 책임: 공고 조회의 예상 실패 분류와 application record→공개 V1 응답 직렬화를 소유한다. */
import {
  instantCodec,
  moneyCodec,
  type AuctionV1Response,
  type CodeReference,
} from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
import type {
  AuctionReader,
  AuctionRecord,
  CodeReferenceRecord,
  ParticipationObservationRecord,
} from "./auction-reader";
import { ProcurementDependencyUnavailable } from "./failures";
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

/**
 * 공고 한 건 조회에만 쓰는 자원 이름 실패다. 모듈 공통 실패의 하위형이라 controller가 어느 쪽으로
 * 잡아도 같은 503이며, 다른 use case는 이 이름을 빌리지 않고 모듈 공통 실패를 던진다(ADR 0045 결정 5).
 */
export class AuctionDependencyUnavailable extends ProcurementDependencyUnavailable {
  constructor(cause: unknown) {
    super(cause);
    this.name = "AuctionDependencyUnavailable";
  }
}

function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

function codeReference(value: CodeReferenceRecord | null): CodeReference | null {
  // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
  return value === null ? null : { ...value, codeValueId: value.codeValueId.toString(10) };
}

function participationObservation(
  value: ParticipationObservationRecord,
): NonNullable<AuctionV1Response["participation"]>["latest"] {
  return { bidCount: value.bidCount, observedAt: z.encode(instantCodec, value.observedAt) };
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
    organization: record.organization === null ? null : {
      organizationId: record.organization.organizationId.toString(10),
      name: record.organization.name,
      type: record.organization.type,
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
    terms: record.terms === null ? null : {
      // scale과 범위는 어댑터의 bidRateValue가 이미 닫았다. 여기서 다시 만들면 같은 불변식이 두 곳에
      // 생겨 한쪽만 바뀔 때 조용히 갈라진다.
      floorRate: record.terms.floorRate === null
        ? null
        : { value: record.terms.floorRate, unit: "percentage-points" },
      awardMethod: codeReference(record.terms.awardMethod),
    },
    location: record.location === null ? null : {
      sido: codeReference(record.location.sido),
      sigungu: codeReference(record.location.sigungu),
    },
    classification: record.classification,
    participation: record.participation === null ? null : {
      latest: participationObservation(record.participation.latest),
      dayEarlier: record.participation.dayEarlier === null
        ? null
        : participationObservation(record.participation.dayEarlier),
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
