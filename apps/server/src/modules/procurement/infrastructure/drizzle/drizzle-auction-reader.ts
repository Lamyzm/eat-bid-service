import { sql, type SQL } from "drizzle-orm";
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
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed <= 0n) throw new TypeError("Database ID must be a positive bigint");
  return parsed;
}

function dateValue(value: Date | string | null): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new TypeError("Database timestamp is invalid");
  return parsed;
}

export function mapAuctionRow(row: AuctionRow): AuctionRecord {
  return {
    auctionId: auctionId(bigintValue(row.auction_id)),
    revisionId: bigintValue(row.revision_id),
    title: row.title,
    status: row.source_status,
    displayBidNumber: row.display_bid_no,
    announcedAt: dateValue(row.announced_at),
    deadlineAt: dateValue(row.deadline_at),
    openedAt: dateValue(row.opened_at),
    baseAmount: row.base_amount,
    plannedAmount: row.planned_amount,
    currency: row.currency,
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
