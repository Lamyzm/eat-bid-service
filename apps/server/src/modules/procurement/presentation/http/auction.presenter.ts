/** @module 책임: 공고 조회 application record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import { moneyCodec, type AuctionV1Response } from "@eatbid/contracts";
import { z } from "zod";
import { bidRateWire, bigintText, codeReferenceWire, instantText } from "../../../../platform/http/wire";
import type { AuctionRecord, ParticipationObservationRecord } from "../../application/auction-reader";
import { auctionIdToString } from "../../domain/auction-id";

function participationObservation(
  value: ParticipationObservationRecord,
): NonNullable<AuctionV1Response["participation"]>["latest"] {
  return { bidCount: value.bidCount, observedAt: instantText(value.observedAt) };
}

export function toAuctionResponse(record: AuctionRecord): AuctionV1Response {
  return {
    identity: {
      // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
      auctionId: auctionIdToString(record.auctionId),
      revisionId: bigintText(record.revisionId),
      externalBidId: record.provenance.externalBidId,
      displayBidNumber: record.displayBidNumber,
      title: record.title,
      status: record.status,
    },
    organization: record.organization === null ? null : {
      organizationId: bigintText(record.organization.organizationId),
      name: record.organization.name,
      type: record.organization.type,
    },
    schedule: {
      announcedAt: instantText(record.announcedAt),
      deadlineAt: instantText(record.deadlineAt),
      openedAt: instantText(record.openedAt),
    },
    pricing: {
      baseAmount: z.encode(moneyCodec, record.baseAmount),
      plannedAmount: record.plannedAmount === null ? null : z.encode(moneyCodec, record.plannedAmount),
    },
    provenance: {
      sourceSystem: record.provenance.sourceSystem,
      observationId: bigintText(record.provenance.observationId),
      normalizedRecordId: bigintText(record.provenance.normalizedRecordId),
      contentSha256: record.provenance.contentSha256,
    },
    terms: record.terms === null ? null : {
      floorRate: bidRateWire(record.terms.floorRate),
      awardMethod: codeReferenceWire(record.terms.awardMethod),
    },
    location: record.location === null ? null : {
      sido: codeReferenceWire(record.location.sido),
      sigungu: codeReferenceWire(record.location.sigungu),
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
