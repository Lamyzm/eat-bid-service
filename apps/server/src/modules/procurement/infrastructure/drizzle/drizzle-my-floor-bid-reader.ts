/**
 * @module 책임: 하한선 자리 창 안에서 내 등록 사업자의 투찰을 찾아, 같은 회차 명단의 하한 위 줄에서 등수와 낙찰 여부를 붙인다.
 *
 * 회차 집합은 시장 조회(`drizzle-floor-line-reader`)와 같은 술어로 고른다 — 다르면 화면의 우리 값이 하한선 점이 없는 공고에 선다.
 * 명단은 개찰 시각으로 나뉜 표라 회차의 개찰 시각을 함께 건다.
 */
import { sql } from "drizzle-orm";
import { baseRelativeBidRate, canonicalDecimal } from "@eatbid/domain";

import type { MyFloorBidReader, MyFloorBidRecord } from "../../application/my-floor-bid-reader";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import { floorLinePredicate } from "./drizzle-floor-line-reader";
import { supplierPartyLabelSql } from "./organization-label-sql";
import { bigintValue, observedLabel } from "./postgres-row-values";

type BidRow = Readonly<{
  auction_attempt_id: string | bigint;
  supplier_party_id: string | bigint;
  supplier_name: string | null;
  rate: string;
  valid: boolean;
  valid_bidder_count: string | number;
  rank: string | number;
  won: boolean;
}>;

export class DrizzleMyFloorBidReader implements MyFloorBidReader {
  async readBids(
    snapshot: TransactionHandle,
    input: Parameters<MyFloorBidReader["readBids"]>[1],
  ): Promise<readonly MyFloorBidRecord[]> {
    if (input.supplierPartyIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const parties = bigintArrayLiteral(input.supplierPartyIds);
    // 실격 투찰의 금액 열은 자리표시자라 쓰지 않고 투찰률(예정가격 대비)을 기초금액 대비로 옮긴다. 200 이상은 자리표시자다.
    // 등수는 같은 회차에서 하한 위로 낸 다른 업체마다 가장 낮은 값 가운데 내 값보다 낮은 수 + 1이다 — 같은 값이면 같은 등수다.
    const result = await database.execute(sql`
      with candidate as (
        select summary.auction_attempt_id, summary.auction_revision_id, summary.opened_at, summary.floor_rate,
               summary.planned_amount, summary.base_amount, summary.winner_supplier_party_id
          from mart.org_round_summary summary
         where ${floorLinePredicate(input.window)}
           and summary.region_sigungu_code_value_id = ${input.sigunguCodeValueId.toString()}::bigint
      ), mine as (
        select candidate.*, bid.supplier_party_id, bid.bid_rate, bid.roster_ordinal
          from candidate
          join core.bid_submission bid
            on bid.auction_revision_id = candidate.auction_revision_id and bid.opened_at = candidate.opened_at
         where bid.supplier_party_id = any(${parties}::bigint[])
           and bid.bid_rate > 0 and bid.bid_rate < 200
      ), best as (
        select candidate.auction_attempt_id, bid.supplier_party_id, min(bid.bid_rate) as rate
          from candidate
          join core.bid_submission bid
            on bid.auction_revision_id = candidate.auction_revision_id and bid.opened_at = candidate.opened_at
         where candidate.auction_attempt_id in (select mine.auction_attempt_id from mine)
           and bid.bid_rate >= candidate.floor_rate and bid.bid_rate < 200
         group by 1, 2
      ), party_name as (
        select party.supplier_party_id, ${supplierPartyLabelSql(sql`party.supplier_party_id`)} as name
          from (select distinct mine.supplier_party_id from mine) party
      )
      select mine.auction_attempt_id, mine.supplier_party_id, party_name.name as supplier_name,
             round(mine.bid_rate * mine.planned_amount / mine.base_amount, 4)::text as rate,
             mine.bid_rate >= mine.floor_rate as valid,
             (select count(*) from best where best.auction_attempt_id = mine.auction_attempt_id) as valid_bidder_count,
             (select count(*) from best
               where best.auction_attempt_id = mine.auction_attempt_id
                 and best.supplier_party_id <> mine.supplier_party_id
                 and best.rate < mine.bid_rate) + 1 as rank,
             coalesce(mine.winner_supplier_party_id = mine.supplier_party_id, false) as won
        from mine
        left join party_name on party_name.supplier_party_id = mine.supplier_party_id
       order by mine.opened_at, mine.auction_attempt_id, mine.roster_ordinal`);
    const rows = Array.isArray(result) ? result as readonly BidRow[] : [];
    return rows.map((row) => ({
      attemptId: bigintValue(row.auction_attempt_id),
      supplierPartyId: bigintValue(row.supplier_party_id),
      supplierName: observedLabel(row.supplier_name),
      rate: baseRelativeBidRate(canonicalDecimal(row.rate, 4)),
      outcome: row.valid
        ? { kind: "valid" as const, rank: Number(row.rank), validBidderCount: Number(row.valid_bidder_count), won: row.won }
        : { kind: "below-floor" as const },
    }));
  }
}
