/**
 * @module 책임: 복기 port를 활성 build의 회차 요약·명단·낙찰 결정과 화면 장부에 대한 집합 SQL로 구현한다.
 *
 * 회차는 내 사업자의 투찰(업체·개찰 시각 색인)에서 출발해 회차 요약(활성 build, 최신 revision)에 붙인다. 회차 요약을 먼저 훑으면
 * 전국 회차 전부를 읽는다. 우리 투찰이 그 최신 revision 명단에 있어야 우리 공고로 센다(맞춤 시장과 같은 정의).
 */
import { sql, type SQL } from "drizzle-orm";
import type { Temporal } from "@eatbid/domain";

import type {
  BidReviewLedgerRecord,
  BidReviewMonthRecord,
  BidReviewReader,
  BidReviewRoundRecord,
} from "../../application/bid-review-reader";
import type { BidDisplayMethod } from "../../application/bid-display-ledger";
import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { transactionDatabase, type TransactionHandle } from "../../../../platform/database/unit-of-work";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { activeMartBuildId } from "./drizzle-mart-build-reader";
import { organizationLabelSql } from "./organization-label-sql";

type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type MonthRow = Readonly<{ month: string; rounds: number | string; bids: number | string; wins: number | string }>;

type RoundRow = Readonly<{
  auction_attempt_id: string | bigint;
  opened_at: PostgresTimestamp;
  deadline_at: PostgresTimestamp;
  display_bid_no: string | null;
  title: string | null;
  organization_label: string | null;
  item_label: string | null;
  base_amount: string;
  planned_amount: string | null;
  floor_rate: string;
  bidder_count: number | string;
  competitor_rates: readonly string[] | null;
  own_parties: readonly string[] | null;
  own_labels: readonly (string | null)[] | null;
  own_rates: readonly string[] | null;
  winner_party: string | bigint | null;
  winner_label: string | null;
  winner_rate: string | null;
}>;

type LedgerRow = Readonly<{
  auction_attempt_id: string | bigint;
  method: string;
  method_version: string;
  floor_rate: string;
  first_rate: string;
  second_rate: string | null;
  first_served_at: PostgresTimestamp;
}>;

const ROUND_SUMMARY = "org_round_summary";
const USABLE_RATE = sql`bid.bid_rate > 0 and bid.bid_rate < 200`;

function ownRounds(parties: string, range: SQL): SQL {
  return sql`
    own as (
      -- 같은 회차의 여러 revision에 우리 줄이 있어도 최신 revision 하나만 남긴다(아래 summary 조인).
      select own_bid.auction_attempt_id, own_bid.auction_revision_id, count(*)::integer as bids
        from core.bid_submission own_bid
       where own_bid.supplier_party_id = any(${parties}::bigint[]) ${range}
       group by own_bid.auction_attempt_id, own_bid.auction_revision_id
    ), rounds as (
      select summary.*, own.bids
        from own
        join mart.org_round_summary summary
          on summary.build_id = ${activeMartBuildId(ROUND_SUMMARY)}
         and summary.auction_attempt_id = own.auction_attempt_id
         and summary.auction_revision_id = own.auction_revision_id
    )`;
}

export function bidReviewMonthsQuery(supplierPartyIds: readonly bigint[]): SQL {
  const parties = bigintArrayLiteral(supplierPartyIds);
  return sql`
    with ${ownRounds(parties, sql``)}
    select to_char(rounds.opened_at at time zone 'Asia/Seoul', 'YYYY-MM') as month,
           count(*)::integer as rounds,
           sum(rounds.bids)::integer as bids,
           count(*) filter (where rounds.winner_supplier_party_id = any(${parties}::bigint[]))::integer as wins
      from rounds
     where rounds.opened_at is not null and rounds.floor_rate is not null
     group by 1
     order by 1
  `;
}

export function bidReviewRoundsQuery(input: {
  readonly supplierPartyIds: readonly bigint[];
  readonly openedFrom: Temporal.Instant;
  readonly openedBefore: Temporal.Instant;
}): SQL {
  const parties = bigintArrayLiteral(input.supplierPartyIds);
  const range = sql`and own_bid.opened_at >= ${input.openedFrom.toString()}::timestamptz
                    and own_bid.opened_at < ${input.openedBefore.toString()}::timestamptz`;
  return sql`
    with ${ownRounds(parties, range)}
    select rounds.auction_attempt_id, rounds.opened_at, revision.deadline_at, revision.display_bid_no, revision.title,
           ${organizationLabelSql(sql`rounds.organization_id`)} as organization_label,
           rounds.item_label, rounds.base_amount::text as base_amount, rounds.planned_amount::text as planned_amount,
           rounds.floor_rate::text as floor_rate,
           roster.bidder_count, roster.competitor_rates, roster.own_parties, roster.own_labels, roster.own_rates,
           rounds.winner_supplier_party_id as winner_party, roster.winner_label, roster.winner_rate
      from rounds
      join core.auction_revision revision on revision.auction_revision_id = rounds.auction_revision_id
      join lateral (
        select count(*)::integer as bidder_count,
               array_agg(bid.bid_rate::text order by bid.bid_rate)
                 filter (where not (bid.supplier_party_id = any(${parties}::bigint[])) and ${USABLE_RATE}) as competitor_rates,
               array_agg(bid.supplier_party_id::text order by bid.bid_rate)
                 filter (where bid.supplier_party_id = any(${parties}::bigint[]) and ${USABLE_RATE}) as own_parties,
               array_agg(bid.supplier_label order by bid.bid_rate)
                 filter (where bid.supplier_party_id = any(${parties}::bigint[]) and ${USABLE_RATE}) as own_labels,
               array_agg(bid.bid_rate::text order by bid.bid_rate)
                 filter (where bid.supplier_party_id = any(${parties}::bigint[]) and ${USABLE_RATE}) as own_rates,
               -- 낙찰 업체의 이름과 투찰률은 명단 줄에서 읽는다(ADR 0063). 요약의 기초금액 축 낙찰률은 비는 회차가 있다.
               min(bid.supplier_label) filter (where bid.supplier_party_id = rounds.winner_supplier_party_id) as winner_label,
               min(bid.bid_rate::text) filter (where bid.supplier_party_id = rounds.winner_supplier_party_id and ${USABLE_RATE}) as winner_rate
          from core.bid_submission bid
         where bid.auction_revision_id = rounds.auction_revision_id
           and bid.opened_at is not distinct from rounds.opened_at
      ) roster on true
     -- 개찰 시각·하한율을 모르는 회차는 대조할 날도 눈금도 없다. 달 목록도 같은 조건으로 센다.
     where rounds.floor_rate is not null and rounds.opened_at is not null
     order by rounds.opened_at, rounds.auction_attempt_id
  `;
}

export function bidReviewLedgerQuery(input: { readonly workspaceId: bigint; readonly auctionAttemptIds: readonly bigint[] }): SQL {
  return sql`
    select record.auction_attempt_id, record.method, record.method_version, record.floor_rate::text as floor_rate,
           record.first_base_relative_rate::text as first_rate, record.second_base_relative_rate::text as second_rate,
           record.first_served_at
      from app.bid_display_record record
     where record.workspace_id = ${input.workspaceId}::bigint
       and record.auction_attempt_id = any(${bigintArrayLiteral(input.auctionAttemptIds)}::bigint[])
     order by record.auction_attempt_id, record.method, record.first_served_at
  `;
}

const count = (value: number | string) => Number(value);

function instant(value: PostgresTimestamp): Temporal.Instant {
  const parsed = postgresInstant(value);
  if (parsed === null) throw new TypeError("복기 회차 시각이 비어 있다");
  return parsed;
}

function isMethod(value: string): value is BidDisplayMethod {
  return value === "market-pick" || value === "national-rule" || value === "morning-habit";
}

export class DrizzleBidReviewReader implements BidReviewReader {
  async listMonths(snapshot: TransactionHandle, input: { readonly supplierPartyIds: readonly bigint[] }): Promise<readonly BidReviewMonthRecord[]> {
    if (input.supplierPartyIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const result = await database.execute(bidReviewMonthsQuery(input.supplierPartyIds));
    const rows = Array.isArray(result) ? result as MonthRow[] : [];
    return rows.map((row) => ({ month: row.month, rounds: count(row.rounds), bids: count(row.bids), wins: count(row.wins) }));
  }

  async findRounds(
    snapshot: TransactionHandle,
    input: Parameters<BidReviewReader["findRounds"]>[1],
  ): Promise<readonly BidReviewRoundRecord[]> {
    if (input.supplierPartyIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const result = await database.execute(bidReviewRoundsQuery(input));
    const rows = Array.isArray(result) ? result as RoundRow[] : [];
    return rows.map((row) => {
      const parties = row.own_parties ?? [];
      const labels = row.own_labels ?? [];
      const rates = row.own_rates ?? [];
      return {
        auctionAttemptId: BigInt(row.auction_attempt_id),
        openedAt: instant(row.opened_at),
        deadlineAt: postgresInstant(row.deadline_at),
        displayBidNo: row.display_bid_no,
        title: row.title,
        organizationLabel: row.organization_label,
        itemLabel: row.item_label,
        baseAmount: row.base_amount,
        plannedAmount: row.planned_amount,
        floorRate: row.floor_rate,
        bidderCount: count(row.bidder_count),
        competitorRates: row.competitor_rates ?? [],
        own: parties.map((party, index) => ({ supplierPartyId: BigInt(party), label: labels[index] ?? null, rate: rates[index]! })),
        award: row.winner_party === null || row.winner_rate === null ? null : {
          supplierPartyId: BigInt(row.winner_party),
          label: row.winner_label,
          rate: row.winner_rate,
        },
      };
    });
  }

  async findLedger(
    snapshot: TransactionHandle,
    input: Parameters<BidReviewReader["findLedger"]>[1],
  ): Promise<readonly BidReviewLedgerRecord[]> {
    if (input.auctionAttemptIds.length === 0) return [];
    const database = transactionDatabase(snapshot) as AuctionReadDatabase;
    const result = await database.execute(bidReviewLedgerQuery(input));
    const rows = Array.isArray(result) ? result as LedgerRow[] : [];
    return rows.flatMap((row) => isMethod(row.method) ? [{
      auctionAttemptId: BigInt(row.auction_attempt_id),
      method: row.method,
      methodVersion: row.method_version,
      floorRate: row.floor_rate,
      baseRelativeRates: row.second_rate === null ? [row.first_rate] : [row.first_rate, row.second_rate],
      firstServedAt: instant(row.first_served_at),
    }] : []);
  }
}
