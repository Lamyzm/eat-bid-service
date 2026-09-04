/** @module 책임: 공고 한 건을 core 스키마에서 읽어 도메인 값으로 닫고 driver 시간 표현 경계를 소유한다. */
import { sql, type SQL } from "drizzle-orm";
import { Temporal } from "@eatbid/domain";
import type { AuctionReader, AuctionRecord } from "../../application/auction-reader";
import { auctionId, type AuctionId } from "../../domain/auction-id";
import { bigintValue, moneyValue } from "./postgres-row-values";

export interface AuctionReadDatabase {
  execute(query: SQL): Promise<unknown>;
}

type AuctionRow = Readonly<{
  auction_id: string | bigint;
  revision_id: string | bigint;
  title: string;
  source_status: string;
  display_bid_no: string | null;
  announced_at: Date | string | null;
  deadline_at: Date | string | null;
  opened_at: Date | string | null;
  base_amount: string | null;
  planned_amount: string | null;
  currency: string;
  organization_id: string | bigint | null;
  organization_name: string | null;
  organization_type: string | null;
  source_system: string;
  external_bid_id: string;
  observation_id: string | bigint;
  normalized_record_id: string | bigint;
  content_sha256: string;
}>;

/**
 * AGENTS 17이 지정한 유일한 PostgreSQL 시간 경계다. driver가 주는 `Date | string`은 여기서만
 * 읽고 즉시 Temporal로 닫으므로 다른 어댑터도 이 함수를 통해서만 driver 시간을 해석한다.
 */
export function postgresInstant(value: Date | string | null): Temporal.Instant | null {
  if (value === null) return null;
  try {
    if (value instanceof Date) {
      const epochMilliseconds = value.getTime();
      if (!Number.isFinite(epochMilliseconds)) throw new TypeError("Database timestamp is invalid");
      return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
    }
    return Temporal.Instant.from(value);
  } catch {
    throw new TypeError("Database timestamp is invalid");
  }
}

export function mapAuctionRow(row: AuctionRow): AuctionRecord {
  const announcedAt = postgresInstant(row.announced_at);
  if (announcedAt === null) throw new TypeError("Database announced timestamp is required");
  return {
    auctionId: auctionId(bigintValue(row.auction_id)),
    revisionId: bigintValue(row.revision_id),
    title: row.title,
    status: row.source_status,
    displayBidNumber: row.display_bid_no,
    announcedAt,
    deadlineAt: postgresInstant(row.deadline_at),
    openedAt: postgresInstant(row.opened_at),
    baseAmount: moneyValue(row.base_amount, row.currency, true),
    plannedAmount: moneyValue(row.planned_amount, row.currency, false),
    // 구매기관 관계가 없는 revision은 유효한 상태이므로 빈 이름이나 기본 유형을 지어내지 않는다.
    organization: row.organization_id === null || row.organization_type === null
      ? null
      : {
        organizationId: bigintValue(row.organization_id),
        // 공백뿐인 canonical_name은 이름이 관측된 것이 아니라 비어 있는 것이다. 빈 문자열을 이름으로
        // 내보내면 화면이 이름 없는 기관을 이름 있는 기관처럼 그린다.
        name: row.organization_name === null || row.organization_name.trim() === "" ? null : row.organization_name,
        type: row.organization_type,
      },
    provenance: {
      sourceSystem: row.source_system,
      externalBidId: row.external_bid_id,
      observationId: bigintValue(row.observation_id),
      normalizedRecordId: bigintValue(row.normalized_record_id),
      contentSha256: row.content_sha256,
    },
  };
}

export class DrizzleAuctionReader implements AuctionReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async findById(id: AuctionId): Promise<AuctionRecord | null> {
    // 이 API view는 여러 revision 중 가장 나중에 저장된 해석을 현재 값으로 선택하며, ID 역순이 그 projection 규칙을 명시한다.
    const result = await this.database.execute(sql`
      select
        attempt.auction_attempt_id as auction_id,
        revision.auction_revision_id as revision_id,
        revision.title,
        revision.source_status,
        revision.display_bid_no,
        revision.announced_at,
        revision.deadline_at,
        revision.opened_at,
        revision.base_amount,
        revision.planned_amount,
        revision.currency,
        purchaser_org.organization_id,
        purchaser_org.canonical_name as organization_name,
        purchaser_org.type as organization_type,
        attempt.source_system,
        attempt.external_bid_id,
        revision.observation_id,
        revision.normalized_record_id,
        revision.content_sha256
      from core.auction_attempt attempt
      join core.auction_revision revision
        on revision.auction_attempt_id = attempt.auction_attempt_id
      left join core.auction_organization purchaser
        on purchaser.auction_revision_id = revision.auction_revision_id
        and purchaser.role = 'purchaser'
      left join core.organization purchaser_org
        on purchaser_org.organization_id = purchaser.organization_id
      where attempt.auction_attempt_id = ${id}
      order by revision.auction_revision_id desc, purchaser_org.organization_id asc
      limit 1
    `);
    const rows = Array.isArray(result) ? result as AuctionRow[] : [];
    return rows[0] ? mapAuctionRow(rows[0]) : null;
  }
}
