/**
 * 공고·학교·업체·시장 — 레이크에서 재적재되는 테이블.
 * ⚠ 재적재 시 로더가 DELETE 후 다시 채운다(파일 경계 = 삭제 대상 경계).
 */
import {
  pgTable, varchar, integer, bigint, doublePrecision, jsonb, date, timestamp, primaryKey, serial, boolean,
} from "drizzle-orm/pg-core";

/** 공급업체 — 자격 풋프린트(투찰해온 시군구)는 데이터에서 역추론 */
export const firms = pgTable("firms", {
  bizNo: varchar("biz_no", { length: 16 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  regions: jsonb("regions").$type<string[]>().notNull().default([]),
  firstSeen: date("first_seen"),
  lastSeen: date("last_seen"),
  totalBids: integer("total_bids").notNull().default(0),
  totalWins: integer("total_wins").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 학교(발주기관) */
export const schools = pgTable("schools", {
  id: varchar("id", { length: 200 }).primaryKey(), // sigungu|name
  name: varchar("name", { length: 160 }).notNull(),
  sido: varchar("sido", { length: 40 }).notNull(),
  sigungu: varchar("sigungu", { length: 40 }).notNull(),
  category: varchar("category", { length: 20 }).notNull(), // 축산|수산|농산|공산|기타
  nAuctions: integer("n_auctions").notNull(),
  medField: integer("med_field").notNull(),           // 참여 업체 수 중앙값
  medBase: bigint("med_base", { mode: "number" }),    // 기초가 중앙값
  rsd: doublePrecision("rsd"),                        // 예정가 출렁임(2sd)
  /** 하한율별 통계: { "90": {n,mean,dense:{lo,hi,pct},p:[...],recur:[[v,c]]} } */
  byFloor: jsonb("by_floor").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 학교별 공고 이력(상세 시트·차트용 행) */
export const schoolAuctions = pgTable("school_auctions", {
  bidId: varchar("bid_id", { length: 32 }).primaryKey(),
  schoolId: varchar("school_id", { length: 200 }).notNull(),
  category: varchar("category", { length: 20 }),   // 품목은 공고의 속성 (학교 아님)
  openedAt: date("opened_at").notNull(),
  floorRate: doublePrecision("floor_rate"),
  basePrice: bigint("base_price", { mode: "number" }),
  winRate: doublePrecision("win_rate"),
  nValid: integer("n_valid").notNull(),
  winnerBizNo: varchar("winner_biz_no", { length: 16 }),
  plannedPrice: bigint("planned_price", { mode: "number" }),
  dlvryStart: date("dlvry_start"),
  dlvryEnd: date("dlvry_end"),
  /** 복수예가 15개: [{r: 예가/기초 비율, c: 추첨 여부}] */
  reserves: jsonb("reserves").$type<{ r: number; c: boolean }[]>(),
});

/** 학교별 단골 참여 업체 — 사실 전부(참여·낙찰·낙찰값·보통 쓰는 자리), 해석 라벨 금지 */
export const schoolRoster = pgTable("school_roster", {
  schoolId: varchar("school_id", { length: 200 }).notNull(),
  bizNo: varchar("biz_no", { length: 16 }).notNull(),
  name: varchar("name", { length: 128 }),
  partN: integer("part_n").notNull(),          // 참여 횟수
  winN: integer("win_n").notNull().default(0), // 낙찰 횟수
  winRates: jsonb("win_rates").$type<number[]>().notNull().default([]),  // 낙찰했던 값들
  medRate: doublePrecision("med_rate"),        // 보통 쓰는 자리(투찰 중앙값)
}, (t) => [primaryKey({ columns: [t.schoolId, t.bizNo] })]);

/** 자격 레이더 — 열린 공고 (수집 시점 스냅샷) */
export const openAuctions = pgTable("open_auctions", {
  bidNo: varchar("bid_no", { length: 32 }).primaryKey(),
  schoolName: varchar("school_name", { length: 160 }),
  sigungu: varchar("sigungu", { length: 40 }),
  allowedRegions: jsonb("allowed_regions").$type<string[]>().notNull().default([]),
  basePrice: bigint("base_price", { mode: "number" }),
  floorRate: doublePrecision("floor_rate"),
  category: varchar("category", { length: 20 }),
  deadline: timestamp("deadline"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

/** 시장 지도 — 시군구×품목 구조 */
export const marketRegions = pgTable("market_regions", {
  sido: varchar("sido", { length: 40 }).notNull(),
  sigungu: varchar("sigungu", { length: 40 }).notNull(),
  category: varchar("category", { length: 20 }).notNull(),
  perYear: integer("per_year").notNull(),
  medField: integer("med_field").notNull(),
  expWin: doublePrecision("exp_win").notNull(),   // 연간공고 ÷ 업체수
  medBase: bigint("med_base", { mode: "number" }),
  marketYr: bigint("market_yr", { mode: "number" }),
  top5Share: integer("top5_share"),
  detail: jsonb("detail").$type<Record<string, unknown>>(), // topwinners·ytrend·mons·schools
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.sigungu, t.category] })]);

