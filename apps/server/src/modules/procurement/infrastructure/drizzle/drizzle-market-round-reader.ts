/**
 * @module 책임: 최근 3개월 맞춤의 시장 공고 port를 호출자가 연 읽기 스냅샷 위의 집합 SQL 한 번으로 구현한다.
 *
 * 정의는 분석 스크립트 `tools/m1/revalidate-2026-10/sql/10-market-rounds-2026-06-09.sql`과 같다 — 창 안 그 하한율의 회차마다
 * 마지막 revision을 고르고, 그 revision에 등록 사업자의 투찰이 있으면 나머지 투찰을 경쟁 배치로 낸다. 정의가 갈리면 검증
 * 수치가 이 계산의 근거가 되지 못한다.
 */
import { sql, type SQL } from "drizzle-orm";
import { canonicalDecimal } from "@eatbid/domain";
import type { MarketRoundQuery, MarketRoundReader } from "../../application/market-round-reader";
import { FLOOR_RELATIVE_RATIO_SCALE, floorRelativeRatio, type MarketRound } from "../../domain/market-position-pick";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";

type MarketRoundRow = Readonly<{
  auction_attempt_id: string | bigint;
  competitor_ratios: readonly string[] | null;
}>;

/**
 * 투찰률(예정가격 대비 %)을 하한 기준액 대비로 옮긴다: x = 투찰률 ÷ 하한율 × 예정가격 ÷ 기초금액. 실격 투찰의 금액 열은
 * 자리표시자라 쓰지 않고 투찰률로 계산한다(실험 기록 §2). 예정가격이 기초금액 ±3.1% 밖이면 추첨 장치 밖의 값이라 뺀다.
 */
export function marketRoundQuery(query: MarketRoundQuery): SQL {
  const parties = bigintArrayLiteral(query.supplierPartyIds);
  const from = query.openedFrom.toString();
  const before = query.openedBefore.toString();
  return sql`
    with own as (
      -- (업체, 개찰 시각) 색인으로 먼저 좁힌다. 회차 전체를 훑고 나서 업체를 고르면 창 안의 모든 투찰을 읽는다.
      select distinct own_bid.auction_attempt_id
        from core.bid_submission own_bid
       where own_bid.supplier_party_id = any(${parties}::bigint[])
         and own_bid.opened_at >= ${from}::timestamptz
         and own_bid.opened_at < ${before}::timestamptz
    ), latest as (
      select distinct on (revision.auction_attempt_id)
             revision.auction_attempt_id, revision.auction_revision_id,
             revision.base_amount, revision.planned_amount, revision.floor_rate
        from core.auction_revision revision
        join own on own.auction_attempt_id = revision.auction_attempt_id
       where revision.opened_at >= ${from}::timestamptz
         and revision.opened_at < ${before}::timestamptz
         and revision.planned_amount is not null
         and revision.base_amount > 0
         and revision.floor_rate = ${query.floorRate}::numeric
       order by revision.auction_attempt_id, revision.auction_revision_id desc
    )
    select latest.auction_attempt_id,
           array_agg(round((bid.bid_rate / latest.floor_rate) * (latest.planned_amount / latest.base_amount),
                           ${FLOOR_RELATIVE_RATIO_SCALE}::int)::text
                     order by bid.bid_rate, bid.roster_ordinal)
             filter (where not (bid.supplier_party_id = any(${parties}::bigint[]))
                       and bid.bid_rate > 0 and bid.bid_rate < 200) as competitor_ratios
      from latest
      join core.bid_submission bid on bid.auction_revision_id = latest.auction_revision_id
     where latest.planned_amount / latest.base_amount between 0.969 and 1.031
     group by latest.auction_attempt_id
    -- 마지막 revision에 우리 투찰이 있어야 그 회차가 우리 시장이다. 앞 revision에만 있던 투찰은 정정 전 기록이다.
    having bool_or(bid.supplier_party_id = any(${parties}::bigint[]))
     order by latest.auction_attempt_id
  `;
}

export class DrizzleMarketRoundReader implements MarketRoundReader {
  async findRounds(snapshot: TransactionHandle, query: MarketRoundQuery): Promise<readonly MarketRound[]> {
    // 빈 목록으로 `any('{}')`를 던지면 한 행도 안 맞는 스캔을 돈다. 사업자가 없으면 시장도 없다.
    if (query.supplierPartyIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const result = await database.execute(marketRoundQuery(query));
    const rows = Array.isArray(result) ? result as MarketRoundRow[] : [];
    return rows.map((row) => ({
      competitorRatios: (row.competitor_ratios ?? []).map((ratio) =>
        floorRelativeRatio(canonicalDecimal(ratio, FLOOR_RELATIVE_RATIO_SCALE))),
    }));
  }
}
