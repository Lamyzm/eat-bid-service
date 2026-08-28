/**
 * 투찰 원장 — 630만 행. 재적재 대상(로더가 DELETE 후 COPY).
 */
import {
  pgTable, varchar, integer, bigint, doublePrecision, jsonb, date, timestamp, primaryKey, serial, boolean,
} from "drizzle-orm/pg-core";

/** 업체별 투찰 이력(성적표·버릇 진단용) */
export const firmBids = pgTable("firm_bids", {
  bidId: varchar("bid_id", { length: 32 }).notNull(),
  bizNo: varchar("biz_no", { length: 16 }).notNull(),
  bidRate: doublePrecision("bid_rate"),
  won: integer("won").notNull().default(0),
  openedAt: date("opened_at"),
  floorRate: doublePrecision("floor_rate"),
  winRate: doublePrecision("win_rate"),      // 그 공고의 실제 낙찰률
  basePrice: bigint("base_price", { mode: "number" }),
  sigungu: varchar("sigungu", { length: 40 }),
  schoolName: varchar("school_name", { length: 160 }),
}, (t) => [primaryKey({ columns: [t.bidId, t.bizNo] })]);

