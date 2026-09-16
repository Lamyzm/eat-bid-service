/** @module 책임: 열린 공고 목록 조회 결과(reader query와 페이지)를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import {
  moneyCodec,
  type OpenAuction,
  type OpenAuctionListV1Response,
  type OpenAuctionOrgSummary,
} from "@eatbid/contracts";
import { z } from "zod";
import {
  baseRelativeBidRateWire,
  bidRateWire,
  bigintText,
  codeReferenceWire,
  instantText,
  martBuildLineageWire,
} from "../../../../platform/http/wire";
import type { OpenAuctionListResult } from "../../application/list-open-auctions";
import type { OpenAuctionOrgSummaryRecord, OpenAuctionRecord } from "../../application/open-auction-reader";

function orgSummaryResource(summary: OpenAuctionOrgSummaryRecord): OpenAuctionOrgSummary {
  return {
    attemptCount: summary.attemptCount,
    medianListCount: summary.medianListCount,
    listCountSampleCount: summary.listCountSampleCount,
    lastRound: summary.lastRound === null ? null : {
      auctionAttemptId: bigintText(summary.lastRound.auctionAttemptId),
      openedAt: instantText(summary.lastRound.openedAt),
      awardedBidRate: baseRelativeBidRateWire(summary.lastRound.awardedBidRate),
      dayFloorBidRate: baseRelativeBidRateWire(summary.lastRound.dayFloorBidRate),
      listCount: summary.lastRound.listCount,
      belowDayFloorCount: summary.lastRound.belowDayFloorCount,
    },
  };
}

function openAuctionResource(record: OpenAuctionRecord): OpenAuction {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    auctionAttemptId: bigintText(record.auctionAttemptId),
    organization: record.organization === null ? null : {
      organizationId: bigintText(record.organization.organizationId),
      label: record.organization.label,
      type: record.organization.type,
    },
    itemLabel: record.itemLabel,
    displayBidNo: record.displayBidNo,
    soloBidMethod: codeReferenceWire(record.soloBidMethod),
    floorRate: bidRateWire(record.floorRate),
    region: record.region === null ? null : {
      sido: codeReferenceWire(record.region.sido),
      sigungu: codeReferenceWire(record.region.sigungu),
    },
    // 관측하지 못한 제한지역은 빈 배열이 아니라 null로 실어 화면이 `제한지역 미관측`을 말하게 한다.
    eligibilityAreas: record.eligibilityAreas === null
      ? null
      : record.eligibilityAreas.map((area) => codeReferenceWire(area)),
    termsRevisionId: bigintText(record.termsRevisionId),
    closesAt: instantText(record.closesAt),
    baseAmount: record.baseAmount === null ? null : z.encode(moneyCodec, record.baseAmount),
    bidCount: record.bidCount,
    observedAt: instantText(record.observedAt),
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
      asOf: instantText(query.asOf),
      sido: bigintText(query.sidoCodeValueId),
      sigungu: query.sigunguCodeValueIds === null
        ? null
        : query.sigunguCodeValueIds.map((id) => bigintText(id)),
      eligibilityArea: query.eligibilityAreaCodeValueIds === null
        ? null
        : query.eligibilityAreaCodeValueIds.map((id) => bigintText(id)),
      // 필터가 없을 때 0을 싣지 않는다. 0은 "아무것도 잡히지 않았다"이고 null은 "묻지 않았다"이다.
      eligibilityMatchedCount: query.eligibilityAreaCodeValueIds === null ? null : page.eligibilityMatchedCount,
      eligibilityUnobservedCount: query.eligibilityAreaCodeValueIds === null ? null : page.eligibilityUnobservedCount,
      items: query.itemAtoms === null ? null : [...query.itemAtoms],
      itemUnknown: query.includeUnknownItem ? "include" : null,
      q: query.searchText,
      bidState: query.onlyWithoutBids ? "none" : null,
      closesWithinHours: query.closesWithinHours,
      closesOn: query.closesOnKst,
      announcedOn: query.announcedOnKst,
      baseAmountMin: query.baseAmountMin,
      baseAmountMax: query.baseAmountMax,
      openAuctionSnapshotBuild: martBuildLineageWire(page.snapshotLineage),
      orgRoundSummaryBuild: martBuildLineageWire(page.orgSummaryLineage),
    },
  };
}
