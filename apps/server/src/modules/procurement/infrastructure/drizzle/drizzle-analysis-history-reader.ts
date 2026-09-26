/** @module 책임: 분석 전체 개찰 이력 port를 고정 build의 회차 요약 한 페이지 조회로 구현하고 행을 도메인 값으로 닫는다. */
import { AUCTION_ITEM_ATOMS, type AuctionItemAtom } from "@eatbid/contracts";
import type {
  AnalysisHistoryPageReading,
  AnalysisHistoryQuery,
  AnalysisHistoryReader,
  AnalysisHistoryRowRecord,
} from "../../application/analysis-history-reader";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import { analysisHistoryPageSql } from "./analysis-history-query";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { ORG_ROUND_SUMMARY, readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { bigintValue, moneyValue, observedBidRateValue, observedLabel } from "./postgres-row-values";

// 시각 열의 driver 표현은 PostgreSQL 어댑터가 정한 한 타입만 쓴다(ADR 0042, AGENTS 17).
type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type PageRow = Readonly<{
  total_count: string | number | bigint;
  cursor_found: boolean;
  auction_attempt_id: string | bigint | null;
  auction_revision_id: string | bigint | null;
  organization_id: string | bigint | null;
  organization_name: string | null;
  announced_at: PostgresTimestamp;
  opened_at: PostgresTimestamp;
  awarded_assessment_rate: string | null;
  runner_up_assessment_rate: string | null;
  list_count: number | null;
  below_day_floor_count: number | null;
  winner_supplier_party_id: string | bigint | null;
  winner_name: string | null;
  items: readonly string[] | null;
  base_amount: string | null;
  currency: string | null;
}>;

const ATOMS = new Set<string>(AUCTION_ITEM_ATOMS);

/** 다리 행의 코드 가운데 계약의 원자만 싣는다. 모르는 코드를 원자인 척 내보내지 않는다. */
function itemAtoms(codes: readonly string[] | null): readonly AuctionItemAtom[] | null {
  if (codes === null) return null;
  return codes.filter((code): code is AuctionItemAtom => ATOMS.has(code));
}

function rowRecord(row: PageRow): AnalysisHistoryRowRecord {
  const announcedAt = postgresInstant(row.announced_at);
  const rate = observedBidRateValue(row.awarded_assessment_rate);
  if (row.auction_attempt_id === null || row.auction_revision_id === null || row.organization_id === null
    || announcedAt === null || rate === null || row.currency === null) {
    // 코호트 술어가 낙찰 사정률 없는 회차를 이미 뺐다. 여기서 비면 술어와 mart 제약이 갈라진 것이다.
    throw new TypeError("Analysis history row violates the cohort invariants");
  }
  return {
    attemptId: bigintValue(row.auction_attempt_id),
    revisionId: bigintValue(row.auction_revision_id),
    organizationId: bigintValue(row.organization_id),
    organizationName: observedLabel(row.organization_name),
    announcedAt,
    openedAt: postgresInstant(row.opened_at),
    items: itemAtoms(row.items),
    assessmentRate: rate,
    secondRate: observedBidRateValue(row.runner_up_assessment_rate),
    listCount: row.list_count,
    belowDayFloorCount: row.below_day_floor_count,
    winner: row.winner_supplier_party_id === null
      ? null
      : { supplierPartyId: bigintValue(row.winner_supplier_party_id), name: observedLabel(row.winner_name) },
    baseAmount: moneyValue(row.base_amount, row.currency, true),
  };
}

export class DrizzleAnalysisHistoryReader implements AnalysisHistoryReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  activeLineage(): Promise<MartBuildLineage | null> {
    return readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY);
  }

  async readPage(query: AnalysisHistoryQuery): Promise<AnalysisHistoryPageReading> {
    const result = await this.database.execute(analysisHistoryPageSql(query));
    const rows = Array.isArray(result) ? result as readonly PageRow[] : [];
    const head = rows[0];
    // 집합이 비어도 anchor 한 줄이 온다. 그 줄이 없으면 질의 모양이 깨진 것이다.
    if (head === undefined) throw new TypeError("Analysis history query returned no anchor row");
    if (!head.cursor_found) return { kind: "cursor-not-found" };
    const records = rows.filter((row) => row.auction_attempt_id !== null).map(rowRecord);
    return {
      kind: "page",
      rows: records.slice(0, query.limit),
      hasMore: records.length > query.limit,
      totalCount: Number(head.total_count),
    };
  }
}
