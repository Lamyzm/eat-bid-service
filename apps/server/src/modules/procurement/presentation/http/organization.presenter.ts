/** @module 책임: 기관 회차 이력 조회 결과를 요청이 고른 projection에 따라 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  moneyCodec,
  type OrganizationAttemptCohort,
  type OrganizationAuctionAttempt,
  type OrganizationAuctionAttemptsV1Response,
} from "@eatbid/contracts";
import { z } from "zod";
import {
  baseRelativeBidRateWire,
  bidRateWire,
  bigintText,
  instantText,
  martBuildLineageWire,
  observedBidRateWire,
} from "../../../../platform/http/wire";
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
      : { kind: "exact", value: bidRateWire(floor) },
    awardMethod: method === "all" || method === "unknown" ? { kind: method } : { kind: "exact", codeValueId: bigintText(method) },
    period: input.period ?? null,
  };
}

interface AttemptProjection {
  readonly includeCohort: boolean;
  readonly includeItemLabel: boolean;
  readonly includeRevision: boolean;
}

function attemptResource(record: OrganizationAttemptRecord, projection: AttemptProjection): OrganizationAuctionAttempt {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    attemptId: bigintText(record.attemptId),
    revisionId: projection.includeRevision ? bigintText(record.revisionId) : undefined,
    announcedAt: instantText(record.announcedAt),
    openedAt: instantText(record.openedAt),
    items: record.items === null ? null : [...record.items],
    itemLabel: projection.includeItemLabel ? record.itemLabel : undefined,
    // 세 비율은 축이 다르다(사정률 상수·관측 사정률·기초금액 분모). 봉투가 같아도 함수를 합치지 않는다.
    floorRate: bidRateWire(record.floorRate),
    awardMethodCodeValueId: projection.includeCohort ? bigintText(record.awardMethodCodeValueId) : undefined,
    baseAmount: z.encode(moneyCodec, record.baseAmount),
    winRate: observedBidRateWire(record.winRate),
    secondRate: observedBidRateWire(record.secondRate),
    awardedBidRate: baseRelativeBidRateWire(record.awardedBidRate),
    dayFloorRate: baseRelativeBidRateWire(record.dayFloorRate),
    listCount: record.listCount,
    belowDayFloorCount: record.belowDayFloorCount,
    winnerSupplierPartyId: bigintText(record.winnerSupplierPartyId),
    supersedesAttemptId: bigintText(record.supersedesAttemptId),
  };
}

export function toOrganizationAttemptsResponse(result: OrganizationAttemptListResult): OrganizationAuctionAttemptsV1Response {
  const { input, query, page } = result;
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
      // 계보는 행이 아니라 이 페이지를 읽은 build 하나가 갖는다(ADR 0034). 활성 build가 아직 없으면
      // 계보를 지어내지 않고 전부 null로 남긴다 — 파생물이 없는 것은 오류가 아니다.
      ...martBuildLineageWire(page.lineage),
      sampleCount: page.sampleCount,
      // 표본을 좁힌 품목을 응답에 되돌려야 sampleCount가 어떤 코호트의 수인지 응답만으로 재현된다.
      item: query.itemAtom,
      // 표본이 개찰된 회차로 좁혀졌는지와 그 기준 시각을 되돌려야 sampleCount가 재현된다(AGENTS 7).
      opened: input.opened,
      asOf: instantText(query.openedAtOrBefore),
      cohort,
    },
  };
}
