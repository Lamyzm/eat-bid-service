/** @module 책임: 기관 회차 이력 조회의 실패 분류와 mart 요약 record→공개 V1 응답 직렬화를 소유한다. */
import {
  instantCodec,
  moneyCodec,
  type BaseRelativeBidRateWire,
  type BidRateWire,
  type OrganizationAuctionAttempt,
  type OrganizationAuctionAttemptsV1Response,
} from "@eatbid/contracts";
import type { BaseRelativeBidRate, BidRate, Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
import { AuctionDependencyUnavailable } from "./find-auction";
import type {
  OrganizationAttemptListing,
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

/**
 * cursor는 opaque하지만 소유자가 있다. 다른 기관의 회차나 사라진 회차를 가리키면 조용히 빈 목록을
 * 주지 않고 요청 오류로 닫아야 화면이 페이지 끝과 잘못된 요청을 구분한다.
 */
export class AttemptCursorInvalid extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly organizationId: OrganizationId, readonly cursor: bigint) {
    super(`Cursor ${cursor.toString(10)} does not belong to organization ${organizationIdToString(organizationId)}`);
    this.name = "AttemptCursorInvalid";
  }
}

function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

function bigintText(value: bigint | null): string | null {
  return value === null ? null : value.toString(10);
}

function rateText(value: BidRate | null): BidRateWire | null {
  // scale과 범위는 어댑터의 bidRateValue가 이미 닫았다. 여기서 다시 만들면 같은 불변식이 두 곳에
  // 생겨 한쪽만 바뀔 때 조용히 갈라진다.
  return value === null ? null : { value, unit: "percentage-points" };
}

// 단위 문자열은 같지만 분모가 다르다. 두 축을 한 함수로 합치면 타입이 그 차이를 더 막지 못한다.
function baseRelativeRateText(value: BaseRelativeBidRate | null): BaseRelativeBidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
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
    awardedBidRate: baseRelativeRateText(record.awardedBidRate),
    dayFloorRate: baseRelativeRateText(record.dayFloorRate),
    listCount: record.listCount,
    belowDayFloorCount: record.belowDayFloorCount,
    winnerSupplierPartyId: bigintText(record.winnerSupplierPartyId),
    supersedesAttemptId: bigintText(record.supersedesAttemptId),
  };
}

export function toOrganizationAttemptsResponse(
  query: OrganizationAttemptQuery,
  page: OrganizationAttemptPage,
): OrganizationAuctionAttemptsV1Response {
  // 계보는 행이 아니라 이 페이지를 읽은 build 하나가 갖는다(ADR 0034). 활성 build가 아직 없으면
  // 계보를 지어내지 않고 전부 null로 남긴다 — 파생물이 없는 것은 오류가 아니다.
  const { lineage } = page;
  return {
    organizationId: organizationIdToString(query.organizationId),
    attempts: page.attempts.map(attemptResource),
    nextCursor: bigintText(page.nextCursor),
    meta: {
      sampleCount: page.sampleCount,
      // 표본을 좁힌 품목을 응답에 되돌려야 sampleCount가 어떤 코호트의 수인지 응답만으로 재현된다.
      item: bigintText(query.itemCodeValueId),
      buildId: lineage === null ? null : lineage.buildId.toString(10),
      sourceReleaseId: lineage?.sourceReleaseId ?? null,
      calcVersion: lineage?.calcVersion ?? null,
      computedAt: lineage === null ? null : z.encode(instantCodec, lineage.computedAt),
      coverage: lineage?.coverage ?? null,
      regionScheme: lineage?.regionScheme ?? null,
    },
  };
}

export class ListOrganizationAuctionAttempts {
  constructor(private readonly reader: OrganizationAttemptReader) {}

  execute(query: OrganizationAttemptQuery): Effect.Effect<
    OrganizationAuctionAttemptsV1Response,
    AttemptCursorInvalid | OrganizationNotFound | AuctionDependencyUnavailable,
    never
  > {
    // 존재 확인을 먼저 끝내야 "기관이 없음"과 "이력이 아직 없음"이 같은 빈 목록으로 뭉개지지 않는다.
    return Effect.tryPromise({
      try: () => this.reader.exists(query.organizationId),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((exists): Effect.Effect<
        OrganizationAttemptListing,
        OrganizationNotFound | AuctionDependencyUnavailable,
        never
      > => exists
        ? Effect.tryPromise({
          try: () => this.reader.listAttempts(query),
          catch: (cause) => new AuctionDependencyUnavailable(cause),
        })
        : Effect.fail(new OrganizationNotFound(query.organizationId))),
      Effect.flatMap((listing) => listing.kind === "page"
        ? Effect.succeed(toOrganizationAttemptsResponse(query, listing.page))
        : Effect.fail(new AttemptCursorInvalid(query.organizationId, listing.cursor))),
    );
  }
}
