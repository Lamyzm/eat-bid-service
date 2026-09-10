/** @module 책임: 기관 회차 이력 조회 결과를 요청이 고른 projection에 따라 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  instantCodec,
  moneyCodec,
  type BaseRelativeBidRateWire,
  type BidRateWire,
  type ObservedBidRateWire,
  type OrganizationAttemptCohort,
  type OrganizationAuctionAttempt,
  type OrganizationAuctionAttemptsV1Response,
} from "@eatbid/contracts";
import type { BaseRelativeBidRate, BidRate, ObservedBidRate, Temporal } from "@eatbid/domain";
import { z } from "zod";
import type {
  ListOrganizationAuctionAttemptsInput,
  OrganizationAttemptListResult,
} from "../../application/list-organization-auction-attempts";
import type { OrganizationAttemptRecord } from "../../application/organization-attempt-reader";
import { organizationIdToString } from "../../domain/organization-id";

/** 명시 조건만 새 응답 projection에 참여한다. 구형 strict 소비자에게 새 필드를 강제로 보내지 않는다. */
function cohortOf(input: ListOrganizationAuctionAttemptsInput): OrganizationAttemptCohort | undefined {
  if (input.floorRate === undefined && input.awardMethodCodeValueId === undefined && input.period === undefined) return undefined;
  const floor = input.floorRate ?? "all";
  const method = input.awardMethodCodeValueId ?? "all";
  return {
    floorRate: floor === "all" ? { kind: "all" } : floor === "unknown" ? { kind: "unknown" }
      : { kind: "exact", value: { value: floor, unit: "percentage-points" } },
    awardMethod: method === "all" || method === "unknown" ? { kind: method } : { kind: "exact", codeValueId: method.toString(10) },
    period: input.period ?? null,
  };
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

// 관측률은 하한율과 상한이 다르므로 같은 직렬화 모양이어도 입력 타입을 합치지 않는다.
function observedRateText(value: ObservedBidRate | null): ObservedBidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
}

// 단위 문자열은 같지만 분모가 다르다. 두 축을 한 함수로 합치면 타입이 그 차이를 더 막지 못한다.
function baseRelativeRateText(value: BaseRelativeBidRate | null): BaseRelativeBidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
}

interface AttemptProjection {
  readonly includeCohort: boolean;
  readonly includeItemLabel: boolean;
  readonly includeRevision: boolean;
}

function attemptResource(record: OrganizationAttemptRecord, projection: AttemptProjection): OrganizationAuctionAttempt {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    attemptId: record.attemptId.toString(10),
    revisionId: projection.includeRevision ? record.revisionId.toString(10) : undefined,
    announcedAt: z.encode(instantCodec, record.announcedAt),
    openedAt: instantText(record.openedAt),
    item: record.item === null
      ? null
      : { codeValueId: record.item.codeValueId.toString(10), label: record.item.label },
    itemLabel: projection.includeItemLabel ? record.itemLabel : undefined,
    floorRate: rateText(record.floorRate),
    awardMethodCodeValueId: projection.includeCohort ? bigintText(record.awardMethodCodeValueId) : undefined,
    baseAmount: z.encode(moneyCodec, record.baseAmount),
    winRate: observedRateText(record.winRate),
    secondRate: observedRateText(record.secondRate),
    awardedBidRate: baseRelativeRateText(record.awardedBidRate),
    dayFloorRate: baseRelativeRateText(record.dayFloorRate),
    listCount: record.listCount,
    belowDayFloorCount: record.belowDayFloorCount,
    winnerSupplierPartyId: bigintText(record.winnerSupplierPartyId),
    supersedesAttemptId: bigintText(record.supersedesAttemptId),
  };
}

export function toOrganizationAttemptsResponse(result: OrganizationAttemptListResult): OrganizationAuctionAttemptsV1Response {
  const { input, query, page } = result;
  // 계보는 행이 아니라 이 페이지를 읽은 build 하나가 갖는다(ADR 0034). 활성 build가 아직 없으면
  // 계보를 지어내지 않고 전부 null로 남긴다 — 파생물이 없는 것은 오류가 아니다.
  const { lineage } = page;
  const cohort = cohortOf(input);
  const projection: AttemptProjection = {
    includeCohort: cohort !== undefined,
    includeItemLabel: input.includeItemLabel === true,
    includeRevision: input.includeRevision === true,
  };
  return {
    organizationId: organizationIdToString(query.organizationId),
    attempts: page.attempts.map((record) => attemptResource(record, projection)),
    nextCursor: bigintText(page.nextCursor),
    meta: {
      sampleCount: page.sampleCount,
      // 표본을 좁힌 품목을 응답에 되돌려야 sampleCount가 어떤 코호트의 수인지 응답만으로 재현된다.
      item: bigintText(query.itemCodeValueId),
      // 표본이 개찰된 회차로 좁혀졌는지와 그 기준 시각을 되돌려야 sampleCount가 재현된다(AGENTS 7).
      opened: input.opened,
      asOf: instantText(query.openedAtOrBefore),
      cohort,
      buildId: lineage === null ? null : lineage.buildId.toString(10),
      sourceReleaseId: lineage?.sourceReleaseId ?? null,
      calcVersion: lineage?.calcVersion ?? null,
      computedAt: lineage === null ? null : z.encode(instantCodec, lineage.computedAt),
      coverage: lineage?.coverage ?? null,
      regionScheme: lineage?.regionScheme ?? null,
    },
  };
}
