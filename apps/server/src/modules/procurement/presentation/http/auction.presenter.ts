/** @module 책임: 공고 조회 application record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  instantCodec,
  moneyCodec,
  type AuctionV1Response,
  type CodeReference,
} from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import { z } from "zod";
import type {
  AuctionRecord,
  CodeReferenceRecord,
  ParticipationObservationRecord,
} from "../../application/auction-reader";
import { auctionIdToString } from "../../domain/auction-id";

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
