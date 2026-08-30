import { sql, type SQL } from "drizzle-orm";
import { canonicalDecimal, krw, Temporal, type Money } from "@eatbid/domain";
import type { AuctionReader, AuctionRecord } from "../../application/auction-reader";
import { auctionId, type AuctionId } from "../../domain/auction-id";

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
  source_system: string;
  external_bid_id: string;
  observation_id: string | bigint;
  normalized_record_id: string | bigint;
  content_sha256: string;
}>;

function bigintValue(value: string | bigint): bigint {
  // 드라이버 설정에 따라 문자열로 오는 bigint도 Number를 거치지 않고 동일한 도메인 값으로 복원한다.
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed <= 0n) throw new TypeError("Database ID must be a positive bigint");
  return parsed;
}

function postgresInstant(value: Date | string | null): Temporal.Instant | null {
  if (value === null) return null;
  try {
    // PostgreSQL driver Date는 이 이름 붙은 경계에서 epoch millisecond만 읽고 즉시 Temporal로 닫는다.
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

function moneyValue(amount: string | null, currency: string, required: true): Money;
function moneyValue(amount: string | null, currency: string, required: false): Money | null;
function moneyValue(amount: string | null, currency: string, required: boolean): Money | null {
  if (amount === null) {
    if (required) throw new TypeError("Database base amount is required");
    return null;
  }
  if (currency !== "KRW") throw new TypeError("Database currency must be KRW");
  try {
    // PostgreSQL numeric 문자열은 부동소수점으로 바꾸지 않고 domain factory가 scale 불변식을 확인한다.
    return krw(canonicalDecimal(amount, 2));
  } catch {
    throw new TypeError("Database money amount is invalid");
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
        attempt.source_system,
        attempt.external_bid_id,
        revision.observation_id,
        revision.normalized_record_id,
        revision.content_sha256
      from core.auction_attempt attempt
      join core.auction_revision revision
        on revision.auction_attempt_id = attempt.auction_attempt_id
      where attempt.auction_attempt_id = ${id}
      order by revision.auction_revision_id desc
      limit 1
    `);
    const rows = Array.isArray(result) ? result as AuctionRow[] : [];
    return rows[0] ? mapAuctionRow(rows[0]) : null;
  }
}
