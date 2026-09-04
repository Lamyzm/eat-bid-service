/** @module 책임: 기관 회차 이력 조회의 실패 분류와 mart 요약 record→공개 V1 응답 직렬화를 소유한다. */
import {
  instantCodec,
  moneyCodec,
  type BidRateWire,
  type OrganizationAuctionAttempt,
  type OrganizationAuctionAttemptsV1Response,
} from "@eatbid/contracts";
import { bidRate, canonicalDecimal, type PercentagePoints, type Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
import { AuctionDependencyUnavailable } from "./find-auction";
import type {
  OrganizationAttemptPage,
  OrganizationAttemptQuery,
  OrganizationAttemptReader,
  OrganizationAttemptRecord,
} from "./organization-attempt-reader";
import { organizationIdToString, type OrganizationId } from "../domain/organization-id";

export class OrganizationNotFound extends Error {
  readonly code = "ORGANIZATION_NOT_FOUND" as const;

  constructor(readonly organizationId: OrganizationId) {
    super(`Organization ${organizationIdToString(organizationId)} was not found`);
    this.name = "OrganizationNotFound";
  }
}

function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

function bigintText(value: bigint | null): string | null {
  return value === null ? null : value.toString(10);
}

function rateText(value: PercentagePoints | null): BidRateWire | null {
  // 공개 계약은 mart numeric(6,3)과 같은 소수 셋째 자리만 허용하므로 Number를 거치지 않고
  // domain factory로 scale과 범위를 다시 닫는다.
  return value === null ? null : { value: bidRate(canonicalDecimal(value, 3)), unit: "percentage-points" };
}

function attemptResource(record: OrganizationAttemptRecord): OrganizationAuctionAttempt {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    attemptId: record.attemptId.toString(10),
    announcedAt: z.encode(instantCodec, record.announcedAt),
    openedAt: instantText(record.openedAt),
    item: record.item === null
      ? null
      : { codeValueId: record.item.codeValueId.toString(10), label: record.item.label },
    floorRate: rateText(record.floorRate),
    baseAmount: z.encode(moneyCodec, record.baseAmount),
    winRate: rateText(record.winRate),
    secondRate: rateText(record.secondRate),
    dayFloorRate: rateText(record.dayFloorRate),
    listCount: record.listCount,
    invalidCount: record.invalidCount,
    winnerSupplierPartyId: bigintText(record.winnerSupplierPartyId),
    supersedesAttemptId: bigintText(record.supersedesAttemptId),
  };
}

export function toOrganizationAttemptsResponse(
  organizationId: OrganizationId,
  page: OrganizationAttemptPage,
): OrganizationAuctionAttemptsV1Response {
  // 파생 출처는 행마다 붙어 있지만 응답의 meta는 가장 최근 회차가 어느 릴리스에서 계산됐는지를
  // 알린다. 이력이 비면 릴리스를 지어내지 않고 unknown으로 남긴다.
  const latest = page.attempts[0];
  return {
    organizationId: organizationIdToString(organizationId),
    attempts: page.attempts.map(attemptResource),
    nextCursor: bigintText(page.nextCursor),
    meta: {
      sampleCount: page.sampleCount,
      martRelease: latest?.martRelease ?? null,
      computedAt: latest === undefined ? null : z.encode(instantCodec, latest.computedAt),
      calcVersion: latest?.calcVersion ?? null,
    },
  };
}

export class ListOrganizationAuctionAttempts {
  constructor(private readonly reader: OrganizationAttemptReader) {}

  execute(query: OrganizationAttemptQuery): Effect.Effect<
    OrganizationAuctionAttemptsV1Response,
    OrganizationNotFound | AuctionDependencyUnavailable,
    never
  > {
    // 존재 확인을 먼저 끝내야 "기관이 없음"과 "이력이 아직 없음"이 같은 빈 목록으로 뭉개지지 않는다.
    return Effect.tryPromise({
      try: () => this.reader.exists(query.organizationId),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((exists): Effect.Effect<
        OrganizationAttemptPage,
        OrganizationNotFound | AuctionDependencyUnavailable,
        never
      > => exists
        ? Effect.tryPromise({
          try: () => this.reader.listAttempts(query),
          catch: (cause) => new AuctionDependencyUnavailable(cause),
        })
        : Effect.fail(new OrganizationNotFound(query.organizationId))),
      Effect.map((page) => toOrganizationAttemptsResponse(query.organizationId, page)),
    );
  }
}
