/** @module 책임: 열린 공고 목록 조회 결과(reader query와 페이지)를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  instantCodec,
  moneyCodec,
  type BaseRelativeBidRateWire,
  type CodeReference,
  type MartBuildLineageWire,
  type OpenAuction,
  type OpenAuctionListV1Response,
  type OpenAuctionOrgSummary,
} from "@eatbid/contracts";
import type { BaseRelativeBidRate, Temporal } from "@eatbid/domain";
import { z } from "zod";
import type { CodeReferenceRecord } from "../../application/auction-reader";
import type { OpenAuctionListResult } from "../../application/list-open-auctions";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import type { OpenAuctionOrgSummaryRecord, OpenAuctionRecord } from "../../application/open-auction-reader";

function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

function bigintText(value: bigint | null): string | null {
  return value === null ? null : value.toString(10);
}

// scale과 범위는 어댑터가 이미 닫았다. 여기서 다시 만들면 같은 불변식이 두 곳에 생겨 조용히 갈라진다.
function baseRelativeRateText(value: BaseRelativeBidRate | null): BaseRelativeBidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
}

function codeReference(value: CodeReferenceRecord | null): CodeReference | null {
  return value === null ? null : { ...value, codeValueId: value.codeValueId.toString(10) };
}

// 활성 build가 없으면 계보를 지어내지 않고 전부 null로 남긴다 — 파생물이 없는 것은 오류가 아니다.
function lineageWire(lineage: MartBuildLineage | null): MartBuildLineageWire {
  return {
    buildId: lineage === null ? null : lineage.buildId.toString(10),
    sourceReleaseId: lineage?.sourceReleaseId ?? null,
    calcVersion: lineage?.calcVersion ?? null,
    computedAt: lineage === null ? null : z.encode(instantCodec, lineage.computedAt),
    coverage: lineage?.coverage ?? null,
    regionScheme: lineage?.regionScheme ?? null,
  };
}

function orgSummaryResource(summary: OpenAuctionOrgSummaryRecord): OpenAuctionOrgSummary {
  return {
    attemptCount: summary.attemptCount,
    medianListCount: summary.medianListCount,
    listCountSampleCount: summary.listCountSampleCount,
    lastRound: summary.lastRound === null ? null : {
      auctionAttemptId: summary.lastRound.auctionAttemptId.toString(10),
      openedAt: z.encode(instantCodec, summary.lastRound.openedAt),
      awardedBidRate: baseRelativeRateText(summary.lastRound.awardedBidRate),
      dayFloorBidRate: baseRelativeRateText(summary.lastRound.dayFloorBidRate),
      listCount: summary.lastRound.listCount,
      belowDayFloorCount: summary.lastRound.belowDayFloorCount,
    },
  };
}

function openAuctionResource(record: OpenAuctionRecord): OpenAuction {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    auctionAttemptId: record.auctionAttemptId.toString(10),
    organization: record.organization === null ? null : {
      organizationId: record.organization.organizationId.toString(10),
      label: record.organization.label,
      type: record.organization.type,
    },
    itemLabel: record.itemLabel,
    floorRate: record.floorRate === null ? null : { value: record.floorRate, unit: "percentage-points" },
    region: record.region === null ? null : {
      sido: codeReference(record.region.sido),
      sigungu: codeReference(record.region.sigungu),
    },
    termsRevisionId: bigintText(record.termsRevisionId),
    closesAt: instantText(record.closesAt),
    baseAmount: record.baseAmount === null ? null : z.encode(moneyCodec, record.baseAmount),
    bidCount: record.bidCount,
    observedAt: z.encode(instantCodec, record.observedAt),
    sourceLastChangedAt: instantText(record.sourceLastChangedAt),
    orgSummary: record.orgSummary === null ? null : orgSummaryResource(record.orgSummary),
  };
}

export function toOpenAuctionListResponse(result: OpenAuctionListResult): OpenAuctionListV1Response {
  const { query, page } = result;
  return {
    auctions: page.auctions.map(openAuctionResource),
    nextCursor: bigintText(page.nextCursor),
    meta: {
      sampleCount: page.sampleCount,
      // 열림 판정의 기준 시각과 요청 필터를 그대로 되돌려야 sampleCount가 어느 코호트의 수인지 응답만으로
      // 재현된다(AGENTS 7).
      asOf: z.encode(instantCodec, query.asOf),
      region: bigintText(query.regionCodeValueId),
      item: query.itemLabel,
      closesWithinHours: query.closesWithinHours,
      baseAmountMin: query.baseAmountMin,
      baseAmountMax: query.baseAmountMax,
      openAuctionSnapshotBuild: lineageWire(page.snapshotLineage),
      orgRoundSummaryBuild: lineageWire(page.orgSummaryLineage),
    },
  };
}
