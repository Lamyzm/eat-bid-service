/** @module 책임: 기관 회차 이력 port를 활성 build의 mart.org_round_summary keyset 조회와 행 매핑으로 구현한다. */
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
import { activeMartBuildId, readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import {
  baseRelativeBidRateValue,
  bidRateValue,
  bigintValue,
  moneyValue,
  observedBidRateValue,
} from "./postgres-row-values";

const ORG_ROUND_SUMMARY = "org_round_summary";

// driver 시간 표현은 AGENTS 17이 지정한 어댑터가 소유하므로 그 경계의 입력 타입을 그대로 파생한다.
type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type OrganizationAttemptRow = Readonly<{
  auction_attempt_id: string | bigint;
  announced_at: PostgresTimestamp;
  opened_at: PostgresTimestamp;
  item_code_value_id: string | bigint | null;
  item_label: string | null;
  floor_rate: string | null;
  award_method_code_value_id: string | bigint | null;
  base_amount: string | null;
  currency: string;
  awarded_assessment_rate: string | null;
  runner_up_assessment_rate: string | null;
  awarded_bid_rate: string | null;
  day_floor_bid_rate: string | null;
  list_count: number | null;
  below_day_floor_count: number | null;
  winner_supplier_party_id: string | bigint | null;
  supersedes_attempt_id: string | bigint | null;
}>;

// Instant는 driver가 모르는 타입이라 ISO 문자열로 넘기고 SQL 쪽에서 timestamptz로 닫는다. Date를 거치면
// 밀리초 아래가 잘리고 계층 경계를 `Date`로 통과시키는 셈이라 금지다(AGENTS 15).
function instantParameter(value: Temporal.Instant | null): string | null {
  return value === null ? null : value.toString();
}

function requiredInstant(value: PostgresTimestamp, label: string): Temporal.Instant {
  const instant = postgresInstant(value);
  if (instant === null) throw new TypeError(`Database ${label} timestamp is required`);
  return instant;
}

/** 페이지·전체 개수·cursor가 동일 집단을 보도록 술어를 공유한다. unknown은 SQL NULL과만 일치한다. */
function cohortCondition(query: OrganizationAttemptQuery) {
  const floor = query.floorRate;
  const method = query.awardMethodCodeValueId;
  const floorCondition = floor === undefined || floor === "all" ? sql`true`
    : floor === "unknown" ? sql`summary.floor_rate is null` : sql`summary.floor_rate = ${floor}::numeric`;
  const methodCondition = method === undefined || method === "all" ? sql`true`
    : method === "unknown" ? sql`summary.award_method_code_value_id is null`
      : sql`summary.award_method_code_value_id = ${method}::bigint`;
  return sql`${floorCondition} and ${methodCondition}
    and (${query.itemCodeValueId}::bigint is null or summary.item_code_value_id = ${query.itemCodeValueId}::bigint)
    and (${instantParameter(query.openedAtOrBefore)}::timestamptz is null
      or summary.opened_at <= ${instantParameter(query.openedAtOrBefore)}::timestamptz)
    and (${instantParameter(query.openedFrom ?? null)}::timestamptz is null
      or summary.opened_at >= ${instantParameter(query.openedFrom ?? null)}::timestamptz)
    and (${instantParameter(query.openedBefore ?? null)}::timestamptz is null
      or summary.opened_at < ${instantParameter(query.openedBefore ?? null)}::timestamptz)`;
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
    itemLabel: row.item_label?.trim() || null,
    floorRate: bidRateValue(row.floor_rate),
    awardMethodCodeValueId: row.award_method_code_value_id === null ? null : bigintValue(row.award_method_code_value_id),
    baseAmount: moneyValue(row.base_amount, row.currency, true),
    // 사정률 축(분모가 예정가격)의 관측값이다. V1 계약의 이름이 아직 축을 담지 못해 그대로 싣는다.
    winRate: observedBidRateValue(row.awarded_assessment_rate),
    secondRate: observedBidRateValue(row.runner_up_assessment_rate),
    // 같은 낙찰을 투찰률 축으로 옮긴 값이다. 화면의 손잡이가 투찰률이라 "이 값이면 낙찰" 판정은
    // winRate가 아니라 이 값과 견줘야 한다(EAT-71). 예정가격이 아직 없는 회차는 null이다.
    awardedBidRate: baseRelativeBidRateValue(row.awarded_bid_rate),
    // 그날 하한도 같은 투찰률 축이다. 금액 축(`day_floor_amount`)이 소스 규칙의 권위이고 이 비율은
    // 기초금액 분모의 표시용 파생값이라 넷째 자리까지 그대로 옮긴다(설계 §1.3).
    dayFloorRate: baseRelativeBidRateValue(row.day_floor_bid_rate),
    listCount: row.list_count,
    // 유효·무효 판정은 우리가 하지 않는다. 우리가 센 것은 그날 하한 미만 명단 행 수뿐이다(PDR-0002).
    belowDayFloorCount: row.below_day_floor_count,
    winnerSupplierPartyId: row.winner_supplier_party_id === null
      ? null
      : bigintValue(row.winner_supplier_party_id),
    supersedesAttemptId: row.supersedes_attempt_id === null
      ? null
      : bigintValue(row.supersedes_attempt_id),
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
    if (query.cursor !== null && !(await this.hasCursorAnchor(query))) {
      return { kind: "cursor-not-found", cursor: query.cursor };
    }
    const [rows, sampleCount, lineage] = await Promise.all([
      this.pageRows(query),
      this.countAttempts(query),
      readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY),
    ]);
    // 한 행을 더 읽어 다음 페이지 유무를 판단한다. 별도 count로는 keyset 경계를 알 수 없다.
    const hasMore = rows.length > query.limit;
    const attempts = (hasMore ? rows.slice(0, query.limit) : rows).map(mapAttemptRow);
    return {
      kind: "page",
      page: {
        attempts,
        nextCursor: hasMore ? attempts.at(-1)?.attemptId ?? null : null,
        sampleCount,
        lineage,
      },
    };
  }

  private async hasCursorAnchor(query: OrganizationAttemptQuery): Promise<boolean> {
    const result = await this.database.execute(sql`
      select 1 as present
      from mart.org_round_summary summary
      where summary.build_id = ${activeMartBuildId(ORG_ROUND_SUMMARY)}
        and summary.auction_attempt_id = ${query.cursor}::bigint
        and summary.organization_id = ${query.organizationId}
        and ${cohortCondition(query)}
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
        summary.award_method_code_value_id,
        summary.base_amount,
        summary.currency,
        summary.awarded_assessment_rate,
        summary.runner_up_assessment_rate,
        summary.awarded_bid_rate,
        summary.day_floor_bid_rate,
        summary.list_count,
        summary.below_day_floor_count,
        summary.winner_supplier_party_id,
        summary.supersedes_attempt_id
      from mart.org_round_summary summary
      where summary.build_id = ${activeMartBuildId(ORG_ROUND_SUMMARY)}
        and summary.organization_id = ${query.organizationId}
        and ${cohortCondition(query)}
        and (${query.cursor}::bigint is null
             or (summary.announced_at, summary.auction_attempt_id)
                < (select cursor_row.announced_at, cursor_row.auction_attempt_id
                   from mart.org_round_summary cursor_row
                   where cursor_row.build_id = summary.build_id
                     and cursor_row.auction_attempt_id = ${query.cursor}::bigint
                     and cursor_row.organization_id = ${query.organizationId}))
      -- nulls last까지 org_round_summary_build_org_announced_idx와 같아야 planner가 정렬 없이 인덱스
      -- pathkey를 그대로 쓴다. 위 cursor 튜플 비교도 이 순서 의미를 그대로 따른다.
      order by summary.announced_at desc nulls last, summary.auction_attempt_id desc nulls last
      limit ${query.limit + 1}
    `);
    return Array.isArray(result) ? result as OrganizationAttemptRow[] : [];
  }

  private async countAttempts(query: OrganizationAttemptQuery): Promise<number> {
    // 표본 수는 cursor와 무관해야 하므로 페이지 조건을 뺀 같은 인덱스 범위를 한 번 더 센다. 개찰 기준은
    // 페이지와 같은 시각이어야 표본 수와 행이 같은 코호트를 말한다.
    const result = await this.database.execute(sql`
      select count(*)::int as sample_count
      from mart.org_round_summary summary
      where summary.build_id = ${activeMartBuildId(ORG_ROUND_SUMMARY)}
        and summary.organization_id = ${query.organizationId}
        and ${cohortCondition(query)}
    `);
    const rows = Array.isArray(result) ? result as ReadonlyArray<{ sample_count: number }> : [];
    return rows[0]?.sample_count ?? 0;
  }
}
