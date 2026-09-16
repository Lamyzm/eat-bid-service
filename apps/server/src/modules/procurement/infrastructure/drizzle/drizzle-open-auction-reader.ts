/** @module 책임: 열린 공고 목록 port를 활성 mart build 두 개의 조회와 스냅샷 행·(기관, 하한율) 요약 매핑으로 구현한다. */
import type {
  OpenAuctionListing,
  OpenAuctionOrgSummaryRecord,
  OpenAuctionQuery,
  OpenAuctionReader,
  OpenAuctionRecord,
} from "../../application/open-auction-reader";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import {
  cursorAnchorQuery,
  OPEN_AUCTION_SNAPSHOT,
  ORG_ROUND_SUMMARY,
  pageQuery,
  sampleCountQuery,
} from "./open-auction-queries";
import {
  baseRelativeBidRateValue,
  bidRateValue,
  bigintValue,
  codeReferenceRecord,
  eligibilityAreaRecords,
  moneyValue,
  observedLabel,
  type EligibilityAreaJson,
} from "./postgres-row-values";

// driver 시간 표현은 AGENTS 17이 지정한 어댑터가 소유하므로 그 경계의 입력 타입을 그대로 파생한다.
type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type RegionColumns<Prefix extends string> =
  & Record<`${Prefix}_code_value_id`, string | bigint | null>
  & Record<`${Prefix}_code` | `${Prefix}_scheme` | `${Prefix}_label`, string | null>;

export type OpenAuctionRow = Readonly<
  & {
    auction_attempt_id: string | bigint;
    organization_id: string | bigint | null;
    organization_label: string | null;
    organization_type: string | null;
    item_label: string | null;
    display_bid_no: string | null;
    floor_rate: string | null;
    terms_revision_id: string | bigint | null;
    closes_at: PostgresTimestamp;
    base_amount: string | null;
    currency: string | null;
    bid_count: number | null;
    observed_at: PostgresTimestamp;
    source_last_changed_at: PostgresTimestamp;
    eligibility_areas: readonly EligibilityAreaJson[] | null;
    attempt_count: number | null;
    median_list_count: number | null;
    list_count_sample_count: number | null;
    last_round_attempt_id: string | bigint | null;
    last_round_opened_at: PostgresTimestamp;
    last_round_awarded_bid_rate: string | null;
    last_round_day_floor_bid_rate: string | null;
    last_round_list_count: number | null;
    last_round_below_day_floor_count: number | null;
  }
  & RegionColumns<"region_sido">
  & RegionColumns<"region_sigungu">
>;

function orgSummary(row: OpenAuctionRow, hasOrgBuild: boolean): OpenAuctionOrgSummaryRecord | null {
  // 코호트를 만들 수 없으면(활성 회차 요약 build 없음·기관 미확인·하한율 미관측) 요약 자체가 없다.
  // 코호트는 있는데 회차가 0건인 것은 셀 수 있는 사실이라 null로 접지 않는다 —
  // "이 하한에서 관측한 회차 0건"과 "요약이 아직 없음"은 화면이 다르게 말해야 한다.
  if (!hasOrgBuild || row.attempt_count === null) return null;
  const lastOpenedAt = postgresInstant(row.last_round_opened_at);
  return {
    attemptCount: row.attempt_count,
    medianListCount: row.median_list_count,
    listCountSampleCount: row.list_count_sample_count ?? 0,
    lastRound: row.last_round_attempt_id === null || lastOpenedAt === null ? null : {
      auctionAttemptId: bigintValue(row.last_round_attempt_id),
      openedAt: lastOpenedAt,
      // 두 값 모두 mart numeric(9,4)의 투찰률 축이다. 3자리 변환을 쓰면 넷째 자리가 잘린다.
      awardedBidRate: baseRelativeBidRateValue(row.last_round_awarded_bid_rate),
      dayFloorBidRate: baseRelativeBidRateValue(row.last_round_day_floor_bid_rate),
      listCount: row.last_round_list_count,
      belowDayFloorCount: row.last_round_below_day_floor_count,
    },
  };
}

export function mapOpenAuctionRow(row: OpenAuctionRow, hasOrgBuild: boolean): OpenAuctionRecord {
  const observedAt = postgresInstant(row.observed_at);
  if (observedAt === null) throw new TypeError("Database observed timestamp is required");
  const region = {
    sido: codeReferenceRecord(row.region_sido_code_value_id, row.region_sido_code, row.region_sido_scheme, row.region_sido_label),
    sigungu: codeReferenceRecord(
      row.region_sigungu_code_value_id,
      row.region_sigungu_code,
      row.region_sigungu_scheme,
      row.region_sigungu_label,
    ),
  };
  return {
    auctionAttemptId: bigintValue(row.auction_attempt_id),
    // 조직 FK가 있으면 core.organization 행은 반드시 있고 type은 not null이다. 그래도 없으면 조인이 깨진 것이다.
    organization: row.organization_id === null ? null : {
      organizationId: bigintValue(row.organization_id),
      label: observedLabel(row.organization_label),
      type: row.organization_type ?? "unknown",
    },
    itemLabel: observedLabel(row.item_label),
    displayBidNo: observedLabel(row.display_bid_no),
    // 하한율은 사정률 축의 상수이며 mart numeric(6,3)이다. scale 불변식은 이 경계에서 한 번만 닫는다.
    floorRate: bidRateValue(row.floor_rate),
    region: region.sido === null && region.sigungu === null ? null : region,
    eligibilityAreas: eligibilityAreaRecords(row.eligibility_areas),
    termsRevisionId: row.terms_revision_id === null ? null : bigintValue(row.terms_revision_id),
    closesAt: postgresInstant(row.closes_at),
    // 금액이 있는데 통화가 없는 행은 DDL check가 막는다. 금액이 없으면 통화가 있어도 금액은 null이다.
    baseAmount: row.base_amount === null ? null : moneyValue(row.base_amount, row.currency ?? "", false),
    bidCount: row.bid_count,
    observedAt,
    sourceLastChangedAt: postgresInstant(row.source_last_changed_at),
    orgSummary: orgSummary(row, hasOrgBuild),
  };
}

type OpenAuctionCountRow = Readonly<{
  sample_count: number;
  eligibility_matched_count: number;
  eligibility_unobserved_count: number;
}>;

interface OpenAuctionCounts {
  readonly sampleCount: number;
  readonly eligibilityMatchedCount: number;
  readonly eligibilityUnobservedCount: number;
}

export class DrizzleOpenAuctionReader implements OpenAuctionReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async listOpen(query: OpenAuctionQuery): Promise<OpenAuctionListing> {
    // anchor를 먼저 확인해야 build 전환으로 사라진 cursor가 "목록 끝"으로 위장하지 않는다.
    if (query.cursor !== null && !(await this.hasCursorAnchor(query, query.cursor))) {
      return { kind: "cursor-not-found", cursor: query.cursor };
    }
    const [rows, counts, snapshotLineage, orgSummaryLineage] = await Promise.all([
      this.pageRows(query),
      this.countRows(query),
      readActiveMartBuildLineage(this.database, OPEN_AUCTION_SNAPSHOT),
      readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY),
    ]);
    // 한 행을 더 읽어 다음 페이지 유무를 판단한다. 별도 count로는 keyset 경계를 알 수 없다.
    const hasMore = rows.length > query.limit;
    const auctions = (hasMore ? rows.slice(0, query.limit) : rows)
      .map((row) => mapOpenAuctionRow(row, orgSummaryLineage !== null));
    return {
      kind: "page",
      page: {
        auctions,
        nextCursor: hasMore ? auctions.at(-1)?.auctionAttemptId ?? null : null,
        sampleCount: counts.sampleCount,
        eligibilityMatchedCount: counts.eligibilityMatchedCount,
        eligibilityUnobservedCount: counts.eligibilityUnobservedCount,
        snapshotLineage,
        orgSummaryLineage,
      },
    };
  }

  private async hasCursorAnchor(query: OpenAuctionQuery, cursor: bigint): Promise<boolean> {
    const result = await this.database.execute(cursorAnchorQuery(query, cursor));
    return Array.isArray(result) && result.length > 0;
  }

  private async pageRows(query: OpenAuctionQuery): Promise<OpenAuctionRow[]> {
    const result = await this.database.execute(pageQuery(query));
    return Array.isArray(result) ? result as OpenAuctionRow[] : [];
  }

  private async countRows(query: OpenAuctionQuery): Promise<OpenAuctionCounts> {
    const result = await this.database.execute(sampleCountQuery(query));
    const rows = Array.isArray(result) ? result as ReadonlyArray<OpenAuctionCountRow> : [];
    const row = rows[0];
    return {
      sampleCount: row?.sample_count ?? 0,
      eligibilityMatchedCount: row?.eligibility_matched_count ?? 0,
      eligibilityUnobservedCount: row?.eligibility_unobserved_count ?? 0,
    };
  }
}
