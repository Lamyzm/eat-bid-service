/**
 * @module 책임: 아침 습관 맞춤 port를 호출자가 연 읽기 스냅샷 위의 집합 SQL 두 번으로 구현한다.
 *
 * 정의는 분석 추출(`q_full_market.sql`·`q_full_regs.sql`, 2026-10-10)과 같다 — 회차마다 마지막 revision의 투찰만 쓰고, 투찰률이
 * 0 이하·200 이상인 줄과 투찰 시각이 없는 줄은 뺀다. 배수는 매달 맞춤과 같은 식(투찰률 ÷ 하한율 × 예정가격 ÷ 기초금액)이다.
 */
import { canonicalDecimal, type Temporal } from "@eatbid/domain";
import { sql, type SQL } from "drizzle-orm";
import type {
  HabitFirmBidRecord,
  HabitMarketRoundRecord,
  HabitWindow,
  MorningHabitReader,
} from "../../application/morning-habit-reader";
import { FLOOR_RELATIVE_RATIO_SCALE, floorRelativeRatio } from "../../domain/market-position-pick";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { ownMarketRevisions } from "./drizzle-market-round-reader";
import { latestRevisionOrder } from "./latest-revision-order";

type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type HabitMarketRoundRow = Readonly<{
  opened_at: PostgresTimestamp;
  deadline_at: PostgresTimestamp;
  parties: readonly string[] | null;
  ratios: readonly string[] | null;
}>;

type HabitFirmBidRow = Readonly<{
  supplier_party_id: string | bigint;
  opened_at: PostgresTimestamp;
  deadline_at: PostgresTimestamp;
  ratio: string;
}>;

type HabitQuery = HabitWindow & { readonly supplierPartyIds: readonly bigint[] };

const RATIO_SQL = sql`round((bid.bid_rate / latest.floor_rate) * (latest.planned_amount / latest.base_amount), ${FLOOR_RELATIVE_RATIO_SCALE}::int)::text`;
const USABLE_BID_SQL = sql`bid.bid_rate > 0 and bid.bid_rate < 200 and bid.submitted_at is not null`;

export function habitMarketRoundQuery(query: HabitQuery): SQL {
  const parties = bigintArrayLiteral(query.supplierPartyIds);
  return sql`
    with ${ownMarketRevisions(query)}
    select latest.opened_at, latest.deadline_at,
           array_agg(bid.supplier_party_id::text order by bid.submitted_at, bid.roster_ordinal)
             filter (where ${USABLE_BID_SQL}) as parties,
           array_agg(${RATIO_SQL} order by bid.submitted_at, bid.roster_ordinal)
             filter (where ${USABLE_BID_SQL}) as ratios
      from latest
      join core.bid_submission bid on bid.auction_revision_id = latest.auction_revision_id
     where latest.planned_amount / latest.base_amount between 0.969 and 1.031
       and latest.deadline_at is not null
     group by latest.auction_attempt_id, latest.opened_at, latest.deadline_at
    -- 매달 맞춤과 같이 마지막 revision에 우리 투찰이 있는 회차만 우리 시장이다. 투찰률이 이상한 우리 줄도 시장 판정에는 센다.
    having bool_or(bid.supplier_party_id = any(${parties}::bigint[]))
     order by latest.opened_at, latest.auction_attempt_id
  `;
}

export function habitFirmBidQuery(query: HabitQuery): SQL {
  const firms = bigintArrayLiteral(query.supplierPartyIds);
  const from = query.openedFrom.toString();
  const before = query.openedBefore.toString();
  return sql`
    with bid as (
      -- (업체, 개찰 시각) 색인으로 좁힌다. 전국 하한율 90 회차 전체를 먼저 고르면 창 안 모든 투찰을 읽는다.
      select bid.auction_attempt_id, bid.auction_revision_id, bid.supplier_party_id, bid.bid_rate, bid.submitted_at,
             bid.roster_ordinal
        from core.bid_submission bid
       where bid.supplier_party_id = any(${firms}::bigint[])
         and bid.opened_at >= ${from}::timestamptz
         and bid.opened_at < ${before}::timestamptz
         and ${USABLE_BID_SQL}
    ), latest as (
      select distinct on (revision.auction_attempt_id)
             revision.auction_attempt_id, revision.auction_revision_id,
             revision.base_amount, revision.planned_amount, revision.floor_rate,
             revision.opened_at, revision.deadline_at
        from core.auction_revision revision
       where revision.auction_attempt_id in (select auction_attempt_id from bid)
         and revision.opened_at >= ${from}::timestamptz
         and revision.opened_at < ${before}::timestamptz
         and revision.planned_amount is not null
         and revision.base_amount > 0
         and revision.floor_rate = ${query.floorRate}::numeric
       order by revision.auction_attempt_id, ${latestRevisionOrder("revision")}
    )
    select bid.supplier_party_id, latest.opened_at, latest.deadline_at, ${RATIO_SQL} as ratio
      from bid
      join latest on latest.auction_revision_id = bid.auction_revision_id
     where latest.deadline_at is not null
     order by bid.supplier_party_id, latest.opened_at, bid.submitted_at, bid.roster_ordinal
  `;
}

function instant(value: PostgresTimestamp): Temporal.Instant {
  const parsed = postgresInstant(value);
  if (parsed === null) throw new TypeError("습관 맞춤 시각이 비어 있다");
  return parsed;
}

const ratioOf = (text: string) => floorRelativeRatio(canonicalDecimal(text, FLOOR_RELATIVE_RATIO_SCALE));

export class DrizzleMorningHabitReader implements MorningHabitReader {
  async findMarketRounds(snapshot: TransactionHandle, query: HabitQuery): Promise<readonly HabitMarketRoundRecord[]> {
    // 빈 목록으로 `any('{}')`를 던지면 한 행도 안 맞는 스캔을 돈다. 사업자가 없으면 시장도 없다.
    if (query.supplierPartyIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const result = await database.execute(habitMarketRoundQuery(query));
    const rows = Array.isArray(result) ? result as HabitMarketRoundRow[] : [];
    return rows.map((row) => {
      const parties = row.parties ?? [];
      const ratios = row.ratios ?? [];
      return {
        openedAt: instant(row.opened_at),
        deadlineAt: instant(row.deadline_at),
        bids: parties.map((party, index) => ({ supplierPartyId: BigInt(party), ratio: ratioOf(ratios[index]!) })),
      };
    });
  }

  async findFirmBids(snapshot: TransactionHandle, query: HabitQuery): Promise<readonly HabitFirmBidRecord[]> {
    if (query.supplierPartyIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const result = await database.execute(habitFirmBidQuery(query));
    const rows = Array.isArray(result) ? result as HabitFirmBidRow[] : [];
    return rows.map((row) => ({
      supplierPartyId: BigInt(row.supplier_party_id),
      openedAt: instant(row.opened_at),
      deadlineAt: instant(row.deadline_at),
      ratio: ratioOf(row.ratio),
    }));
  }
}
