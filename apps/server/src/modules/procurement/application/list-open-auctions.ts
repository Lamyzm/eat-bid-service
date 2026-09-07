/** @module 책임: 열린 공고 목록 조회의 실패 분류, "열림" 기준 시각 확정과 스냅샷 record→공개 V1 응답 직렬화를 소유한다. */
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
import type { BaseRelativeBidRate, Clock, Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
import type { CodeReferenceRecord } from "./auction-reader";
import { AuctionDependencyUnavailable } from "./find-auction";
import type { MartBuildLineage } from "./mart-build-lineage";
import type {
  OpenAuctionOrgSummaryRecord,
  OpenAuctionPage,
  OpenAuctionQuery,
  OpenAuctionReader,
  OpenAuctionRecord,
} from "./open-auction-reader";

/**
 * cursor는 활성 스냅샷 build의 열린 공고만 가리킨다. build 전환으로 사라진 cursor를 빈 목록으로 답하면
 * 화면이 "끝"과 "목록이 갱신됨"을 구분하지 못하므로 요청 오류로 닫는다. EAT-37의 `AttemptCursorInvalid`와
 * 모양이 같지만 소유자(기관 이력 vs 열린 목록)가 달라 합치지 않는다.
 */
export class OpenAuctionCursorInvalid extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly cursor: bigint) {
    super(`Cursor ${cursor.toString(10)} is not an open auction in the active snapshot build`);
    this.name = "OpenAuctionCursorInvalid";
  }
}

/** HTTP query에서 온 조회 입력이다. 기준 시각은 여기 없고 use case가 clock에서 읽어 reader query로 옮긴다. */
export interface ListOpenAuctionsInput {
  readonly regionCodeValueId: bigint | null;
  readonly itemLabel: string | null;
  readonly closesWithinHours: number | null;
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
  readonly cursor: bigint | null;
  readonly limit: number;
}

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

export function toOpenAuctionListResponse(query: OpenAuctionQuery, page: OpenAuctionPage): OpenAuctionListV1Response {
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

export class ListOpenAuctions {
  constructor(private readonly reader: OpenAuctionReader, private readonly clock: Clock) {}

  execute(input: ListOpenAuctionsInput): Effect.Effect<
    OpenAuctionListV1Response,
    OpenAuctionCursorInvalid | AuctionDependencyUnavailable,
    never
  > {
    // "열림"은 현재 시각의 함수라 정적 계약에 넣을 수 없다. 주입된 clock을 요청당 한 번만 읽어 페이지·표본
    // 수·다음 페이지 판정이 같은 기준 시각을 쓰게 한다(AGENTS 17).
    const query: OpenAuctionQuery = { ...input, asOf: this.clock.now() };
    return Effect.tryPromise({
      try: () => this.reader.listOpen(query),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((listing) => listing.kind === "page"
        ? Effect.succeed(toOpenAuctionListResponse(query, listing.page))
        : Effect.fail(new OpenAuctionCursorInvalid(listing.cursor))),
    );
  }
}
