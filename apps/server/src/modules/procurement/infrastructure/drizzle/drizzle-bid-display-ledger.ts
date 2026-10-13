/**
 * @module 책임: 화면 장부 port를 `app.bid_display_record`에 대한 upsert 한 번으로 구현한다. 같은 공고·방법·판·금액이면 줄을 늘리지 않고
 * 마지막으로 내보낸 시각과 횟수만 고친다.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Temporal } from "@eatbid/domain";

import type { BidDisplayEntry, BidDisplayLedger } from "../../application/bid-display-ledger";

export interface BidDisplayLedgerDatabase {
  execute(query: SQL): Promise<unknown>;
}

/** 같은 문장 안에서 같은 키를 두 번 고치면 PostgreSQL이 거부한다(ON CONFLICT가 한 행을 두 번 건드림). 넣기 전에 키로 하나만 남긴다. */
function keyOf(entry: BidDisplayEntry): string {
  return [
    entry.auctionAttemptId,
    entry.method,
    entry.methodVersion,
    entry.floorRate,
    entry.baseRelativeRates[0],
    entry.baseRelativeRates[1] ?? "",
    entry.singleBaseRelativeRate ?? "",
  ].join("|");
}

export function bidDisplayUpsert(input: {
  readonly workspaceId: bigint;
  readonly servedAt: Temporal.Instant;
  readonly entries: readonly BidDisplayEntry[];
}): SQL | null {
  const unique = [...new Map(input.entries.map((entry) => [keyOf(entry), entry])).values()];
  if (unique.length === 0) return null;
  const servedAt = input.servedAt.toString();
  const values = unique.map((entry) => sql`(
    ${input.workspaceId}::bigint, ${entry.auctionAttemptId}::bigint, ${entry.method}, ${entry.methodVersion},
    ${entry.floorRate}::numeric, ${entry.baseRelativeRates[0]}::numeric, ${entry.baseRelativeRates[1] ?? null}::numeric,
    ${entry.singleBaseRelativeRate}::numeric, ${entry.basisPeriod}, ${entry.basisObservedThrough?.toString() ?? null}::timestamptz,
    ${entry.basisCount}::integer, ${servedAt}::timestamptz, ${servedAt}::timestamptz
  )`);
  // 근거 열(basis_*)은 처음 내보낸 때의 것을 남긴다. 같은 금액이 다시 나간 것은 근거가 아니라 노출 횟수로 센다.
  return sql`
    insert into app.bid_display_record (
      workspace_id, auction_attempt_id, method, method_version, floor_rate,
      first_base_relative_rate, second_base_relative_rate, single_base_relative_rate,
      basis_period, basis_observed_through, basis_count, first_served_at, last_served_at
    )
    values ${sql.join(values, sql`, `)}
    on conflict on constraint bid_display_record_shown_value_key do update
      set last_served_at = greatest(app.bid_display_record.last_served_at, excluded.last_served_at),
          first_served_at = least(app.bid_display_record.first_served_at, excluded.first_served_at),
          served_count = app.bid_display_record.served_count + 1
  `;
}

export class DrizzleBidDisplayLedger implements BidDisplayLedger {
  constructor(private readonly database: BidDisplayLedgerDatabase) {}

  async record(input: Parameters<BidDisplayLedger["record"]>[0]): Promise<void> {
    const statement = bidDisplayUpsert(input);
    if (statement === null) return;
    // 읽기 스냅샷과 섞지 않는 독립 문장이다. 읽기 transaction 안에서 쓰면 그 transaction이 끝날 때 기록이 함께 사라질 수 있다.
    await this.database.execute(statement);
  }
}
