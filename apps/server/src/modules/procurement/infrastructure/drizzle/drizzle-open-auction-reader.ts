/** @module 책임: 열린 공고 목록 port를 활성 mart build 두 개의 조회와 스냅샷 행·기관 요약 매핑으로 구현한다. */
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
  moneyValue,
  observedLabel,
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
    floor_rate: string | null;
    terms_revision_id: string | bigint | null;
    closes_at: PostgresTimestamp;
    base_amount: string | null;
    currency: string | null;
    bid_count: number | null;
    observed_at: PostgresTimestamp;
    source_last_changed_at: PostgresTimestamp;
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
  // 활성 회차 요약 build가 없거나 그 build에 이 기관 회차가 없으면 요약 자체가 없다. 0으로 채우지 않는다 —
  // "회차 0건"과 "요약이 아직 없음"은 다른 사실이다.
  if (!hasOrgBuild || row.attempt_count === null || row.attempt_count === 0) return null;
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
    // 하한율은 사정률 축의 상수이며 mart numeric(6,3)이다. scale 불변식은 이 경계에서 한 번만 닫는다.
    floorRate: bidRateValue(row.floor_rate),
    region: region.sido === null && region.sigungu === null ? null : region,
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

export class DrizzleOpenAuctionReader implements OpenAuctionReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async listOpen(query: OpenAuctionQuery): Promise<OpenAuctionListing> {
    // anchor를 먼저 확인해야 build 전환으로 사라진 cursor가 "목록 끝"으로 위장하지 않는다.
    if (query.cursor !== null && !(await this.hasCursorAnchor(query, query.cursor))) {
      return { kind: "cursor-not-found", cursor: query.cursor };
    }
    const [rows, sampleCount, snapshotLineage, orgSummaryLineage] = await Promise.all([
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
        sampleCount,
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

  private async countRows(query: OpenAuctionQuery): Promise<number> {
    const result = await this.database.execute(sampleCountQuery(query));
    const rows = Array.isArray(result) ? result as ReadonlyArray<{ sample_count: number }> : [];
    return rows[0]?.sample_count ?? 0;
  }
}
