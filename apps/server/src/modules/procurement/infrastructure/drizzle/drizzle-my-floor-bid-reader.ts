/**
 * @module 책임: 하한선 자리 창 안에서 내 등록 사업자의 투찰을 찾아 같은 회차 명단의 하한 위 줄에서 등수와 낙찰 여부를 붙이고, 그 투찰이 가장 많은 공고지역을 센다.
 *
 * 회차 집합은 시장 조회(`drizzle-floor-line-reader`)와 같은 술어로 고른다 — 다르면 화면의 우리 값이 하한선 점이 없는 공고에 선다.
 * 명단은 개찰 시각으로 나뉜 표라 회차의 개찰 시각을 함께 건다.
 */
import { sql } from "drizzle-orm";
import { baseRelativeBidRate, canonicalDecimal } from "@eatbid/domain";

import type { MyFloorBidReader, MyFloorBidRecord, MyFloorRegionReader, MyFloorRegionRecord } from "../../application/my-floor-bid-reader";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import { floorLinePredicate, latestCodeLabel } from "./drizzle-floor-line-reader";
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

type RegionRow = Readonly<{
  sido_id: string | bigint;
  sido_label: string | null;
  sigungu_id: string | bigint;
  sigungu_label: string | null;
  round_count: string | number;
}>;

export class DrizzleMyFloorBidReader implements MyFloorBidReader, MyFloorRegionReader {
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

  /**
   * 내 투찰에서 출발한다 — 명단은 (업체, 개찰 시각) 색인이 있어 한 해치가 수천 행이고, 회차 요약에서 출발하면 전국 회차를 다 훑는다.
   * 회차는 하한선 점과 같은 술어로 거른다. 같은 수면 코드값 id가 작은 쪽을 골라 같은 입력에 늘 같은 답을 낸다.
   */
  async readTopRegion(
    snapshot: TransactionHandle,
    input: Parameters<MyFloorRegionReader["readTopRegion"]>[1],
  ): Promise<MyFloorRegionRecord | null> {
    if (input.supplierPartyIds.length === 0) return null;
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const parties = bigintArrayLiteral(input.supplierPartyIds);
    const result = await database.execute(sql`
      with mine as (
        select distinct bid.auction_revision_id, bid.opened_at
          from core.bid_submission bid
         where bid.supplier_party_id = any(${parties}::bigint[])
           and bid.opened_at >= ${input.window.from.toString()}::timestamptz
           and bid.opened_at < ${input.window.before.toString()}::timestamptz
      ), round as (
        select distinct summary.auction_attempt_id,
               summary.region_sido_code_value_id as sido_id, summary.region_sigungu_code_value_id as sigungu_id
          from mine
          join mart.org_round_summary summary
            on summary.auction_revision_id = mine.auction_revision_id and summary.opened_at = mine.opened_at
         where ${floorLinePredicate(input.window)}
           and summary.region_sido_code_value_id is not null
           and summary.region_sigungu_code_value_id is not null
      ), region as (
        select round.sido_id, round.sigungu_id, count(*) as round_count
          from round
         group by 1, 2
         order by round_count desc, round.sigungu_id
         limit 1
      )
      select region.sido_id, ${latestCodeLabel(sql`region.sido_id`)} as sido_label,
             region.sigungu_id, ${latestCodeLabel(sql`region.sigungu_id`)} as sigungu_label,
             region.round_count
        from region`);
    const rows = Array.isArray(result) ? result as readonly RegionRow[] : [];
    const row = rows[0];
    if (row === undefined) return null;
    return {
      sidoCodeValueId: bigintValue(row.sido_id),
      sidoLabel: observedLabel(row.sido_label),
      sigunguCodeValueId: bigintValue(row.sigungu_id),
      sigunguLabel: observedLabel(row.sigungu_label),
      roundCount: Number(row.round_count),
    };
  }
}
