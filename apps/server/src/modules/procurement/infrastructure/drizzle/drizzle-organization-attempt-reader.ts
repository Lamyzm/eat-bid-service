/** @module 책임: 기관 회차 이력 port를 mart.org_round_summary keyset 조회와 행 매핑으로 구현한다. */
import { sql } from "drizzle-orm";
import type { Temporal } from "@eatbid/domain";
import type {
  OrganizationAttemptListing,
  OrganizationAttemptQuery,
  OrganizationAttemptReader,
  OrganizationAttemptRecord,
} from "../../application/organization-attempt-reader";
import type { OrganizationId } from "../../domain/organization-id";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { bidRateValue, bigintValue, moneyValue } from "./postgres-row-values";

// driver 시간 표현은 AGENTS 17이 지정한 어댑터가 소유하므로 그 경계의 입력 타입을 그대로 파생한다.
type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type OrganizationAttemptRow = Readonly<{
  auction_attempt_id: string | bigint;
  announced_at: PostgresTimestamp;
  opened_at: PostgresTimestamp;
  item_code_value_id: string | bigint | null;
  item_label: string | null;
  floor_rate: string | null;
  base_amount: string | null;
  currency: string;
  win_rate: string | null;
  second_rate: string | null;
  day_floor_rate: string | null;
  list_count: number | null;
  invalid_count: number | null;
  winner_supplier_party_id: string | bigint | null;
  supersedes_attempt_id: string | bigint | null;
  mart_release: string;
  computed_at: PostgresTimestamp;
  calc_version: string;
}>;

function requiredInstant(value: PostgresTimestamp, label: string): Temporal.Instant {
  const instant = postgresInstant(value);
  if (instant === null) throw new TypeError(`Database ${label} timestamp is required`);
  return instant;
}

export function mapAttemptRow(row: OrganizationAttemptRow): OrganizationAttemptRecord {
  return {
    attemptId: bigintValue(row.auction_attempt_id),
    announcedAt: requiredInstant(row.announced_at, "announced"),
    openedAt: postgresInstant(row.opened_at),
    // 라벨 없는 품목은 화면 계약을 만족하지 못한다. 라벨을 지어내지 않고 unknown으로 남긴다.
    // 공백뿐인 라벨도 "없음"이다. 계약이 min(1)을 요구하므로 여기서 걸러야 유효한 mart 행이 500이 되지 않는다.
    item: row.item_code_value_id === null || row.item_label === null || row.item_label.trim() === ""
      ? null
      : { codeValueId: bigintValue(row.item_code_value_id), label: row.item_label.trim() },
    floorRate: bidRateValue(row.floor_rate),
    baseAmount: moneyValue(row.base_amount, row.currency, true),
    winRate: bidRateValue(row.win_rate),
    secondRate: bidRateValue(row.second_rate),
    dayFloorRate: bidRateValue(row.day_floor_rate),
    listCount: row.list_count,
    invalidCount: row.invalid_count,
    winnerSupplierPartyId: row.winner_supplier_party_id === null
      ? null
      : bigintValue(row.winner_supplier_party_id),
    supersedesAttemptId: row.supersedes_attempt_id === null
      ? null
      : bigintValue(row.supersedes_attempt_id),
    martRelease: row.mart_release,
    computedAt: requiredInstant(row.computed_at, "computed"),
    calcVersion: row.calc_version,
  };
}

export class DrizzleOrganizationAttemptReader implements OrganizationAttemptReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async exists(id: OrganizationId): Promise<boolean> {
    // 존재 확인은 파생물이 아니라 권위 있는 core 사실에서 읽어야 mart 빌드 지연이 404로 새지 않는다.
    const result = await this.database.execute(sql`
      select 1 as present from core.organization where organization_id = ${id} limit 1
    `);
    return Array.isArray(result) && result.length > 0;
  }

  async listAttempts(query: OrganizationAttemptQuery): Promise<OrganizationAttemptListing> {
    // anchor를 먼저 확인해야 남의 기관 cursor와 사라진 cursor가 "이력 끝"으로 위장하지 않는다.
    if (query.cursor !== null && !(await this.hasCursorAnchor(query.organizationId, query.cursor))) {
      return { kind: "cursor-not-found", cursor: query.cursor };
    }
    const [rows, sampleCount] = await Promise.all([this.pageRows(query), this.countAttempts(query)]);
    // 한 행을 더 읽어 다음 페이지 유무를 판단한다. 별도 count로는 keyset 경계를 알 수 없다.
    const hasMore = rows.length > query.limit;
    const attempts = (hasMore ? rows.slice(0, query.limit) : rows).map(mapAttemptRow);
    return {
      kind: "page",
      page: {
        attempts,
        nextCursor: hasMore ? attempts.at(-1)?.attemptId ?? null : null,
        sampleCount,
      },
    };
  }

  private async hasCursorAnchor(id: OrganizationId, cursor: bigint): Promise<boolean> {
    const result = await this.database.execute(sql`
      select 1 as present
      from mart.org_round_summary summary
      where summary.auction_attempt_id = ${cursor}::bigint
        and summary.organization_id = ${id}
      limit 1
    `);
    return Array.isArray(result) && result.length > 0;
  }

  private async pageRows(query: OrganizationAttemptQuery): Promise<OrganizationAttemptRow[]> {
    const result = await this.database.execute(sql`
      select
        summary.auction_attempt_id,
        summary.announced_at,
        summary.opened_at,
        summary.item_code_value_id,
        summary.item_label,
        summary.floor_rate,
        summary.base_amount,
        summary.currency,
        summary.win_rate,
        summary.second_rate,
        summary.day_floor_rate,
        summary.list_count,
        summary.invalid_count,
        summary.winner_supplier_party_id,
        summary.supersedes_attempt_id,
        summary.mart_release,
        summary.computed_at,
        summary.calc_version
      from mart.org_round_summary summary
      where summary.organization_id = ${query.organizationId}
        and (${query.itemCodeValueId}::bigint is null
             or summary.item_code_value_id = ${query.itemCodeValueId}::bigint)
        and (${query.cursor}::bigint is null
             or (summary.announced_at, summary.auction_attempt_id)
                < (select cursor_row.announced_at, cursor_row.auction_attempt_id
                   from mart.org_round_summary cursor_row
                   where cursor_row.auction_attempt_id = ${query.cursor}::bigint
                     and cursor_row.organization_id = ${query.organizationId}))
      -- nulls last까지 org_round_summary_org_announced_idx와 같아야 planner가 정렬 없이 인덱스
      -- pathkey를 그대로 쓴다. 위 cursor 튜플 비교도 이 순서 의미를 그대로 따른다.
      order by summary.announced_at desc nulls last, summary.auction_attempt_id desc nulls last
      limit ${query.limit + 1}
    `);
    return Array.isArray(result) ? result as OrganizationAttemptRow[] : [];
  }

  private async countAttempts(query: OrganizationAttemptQuery): Promise<number> {
    // 표본 수는 cursor와 무관해야 하므로 페이지 조건을 뺀 같은 인덱스 범위를 한 번 더 센다.
    const result = await this.database.execute(sql`
      select count(*)::int as sample_count
      from mart.org_round_summary summary
      where summary.organization_id = ${query.organizationId}
        and (${query.itemCodeValueId}::bigint is null
             or summary.item_code_value_id = ${query.itemCodeValueId}::bigint)
    `);
    const rows = Array.isArray(result) ? result as ReadonlyArray<{ sample_count: number }> : [];
    return rows[0]?.sample_count ?? 0;
  }
}
