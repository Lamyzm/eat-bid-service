/**
 * 서빙 DB 스키마 — 계약의 단일 진실.
 * data-plane(Python)이 이 DDL에 맞춰 적재하고, server(Nest)가 drizzle로 읽고,
 * web이 도메인 zod 타입으로 소비한다.
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

/** 워크스페이스(Clerk org) ↔ 사업자번호 N개 — "우리집 = 신성+오뚜기" */
export const workspaceBiz = pgTable("workspace_biz", {
  workspaceId: varchar("workspace_id", { length: 64 }).notNull(),
  bizNo: varchar("biz_no", { length: 16 }).notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.bizNo] })]);

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

/** 사용 이벤트 — 게이트 측정(화면 열람). 재적재 시 초기화하지 않는다 */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  session: varchar("session", { length: 64 }).notNull(),
  screen: varchar("screen", { length: 40 }).notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
});

/* ─────────── 인증 (Better Auth, 셀프호스팅) ───────────
 * 계정 데이터는 재적재로 날아가면 안 된다 — schema.sql의 DROP 프리앰블에서 제외.
 * 게스트 모드 유지: 로그인 없이도 전 기능 동작(브라우저 localStorage 폴백).
 */
export const user = pgTable("user", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 200 }),
  email: varchar("email", { length: 320 }).notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: varchar("image", { length: 1000 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  token: varchar("token", { length: 400 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  accountId: varchar("account_id", { length: 200 }).notNull(),
  providerId: varchar("provider_id", { length: 64 }).notNull(),
  accessToken: varchar("access_token", { length: 2000 }),
  refreshToken: varchar("refresh_token", { length: 2000 }),
  idToken: varchar("id_token", { length: 2000 }),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: varchar("scope", { length: 500 }),
  password: varchar("password", { length: 400 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: varchar("id", { length: 64 }).primaryKey(),
  identifier: varchar("identifier", { length: 320 }).notNull(),
  value: varchar("value", { length: 400 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ─────────── 계정에 붙는 사용자 데이터 (localStorage 이관 대상) ───────────
 * 기존 workspace_biz는 workspaceId(브라우저 키) 기반이라 유지하고,
 * 계정 기반은 user_biz로 분리한다 — 게스트→로그인 병합 시 양쪽을 읽는다.
 */
export const userBiz = pgTable("user_biz", {
  userId: varchar("user_id", { length: 64 }).notNull(),
  bizNo: varchar("biz_no", { length: 16 }).notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.bizNo] })]);

export const userRegion = pgTable("user_region", {
  userId: varchar("user_id", { length: 64 }).notNull(),
  sigungu: varchar("sigungu", { length: 40 }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.sigungu] })]);

export const userMark = pgTable("user_mark", {
  userId: varchar("user_id", { length: 64 }).notNull(),
  bidNo: varchar("bid_no", { length: 32 }).notNull(),
  status: varchar("status", { length: 8 }).notNull(),
  rate: doublePrecision("rate"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.bidNo] })]);
