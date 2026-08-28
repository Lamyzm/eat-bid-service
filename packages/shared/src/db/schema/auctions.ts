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
  // S-1: 품목별 회차 수 — "축산 24회" 같은 분모 표기의 원천.
  //      {"축산":24,"수산":25,"공산":25} 형태.
  // 기관코드 — 학교의 정체성 키. 이름·주소는 행정 개편으로 바뀌지만(2026-07 인천
  // 자치구 개편) 코드는 그대로다. 실측: 한 PURR_CD 에 기관명 2개 = 0/6,590.
  // schools.id 는 그대로 둔다 — URL 에 들어가는 값이라 바꾸면 링크가 깨진다.
  purrCd: varchar("purr_cd", { length: 32 }),
  catCounts: jsonb("cat_counts").$type<Record<string, number>>(),
  // S-1: 품목×하한 통계. {"축산":{"90":{...}},"전체":{"90":{...}}}
  //      "전체" 키는 전 품목 합산(섞였다고 표기하고 쓰는 기본값).
  //      by_floor(아래)는 "전체"와 같은 값 — 기존 소비자 호환용으로 남긴다.
  byCatFloor: jsonb("by_cat_floor"),
  byFloor: jsonb("by_floor").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 학교별 공고 이력(상세 시트·차트용 행) */
export const schoolAuctions = pgTable("school_auctions", {
  bidId: varchar("bid_id", { length: 32 }).primaryKey(),
  schoolId: varchar("school_id", { length: 200 }).notNull(),
  // 대표 품목 — 기존 계약 호환(zod Category enum). 다중이면 CAT_KEYS 순서로 하나.
  category: varchar("category", { length: 20 }),   // 품목은 공고의 속성 (학교 아님)
  // 실제 품목 전부. 한 공고가 여러 품목인 경우가 10.3%다 — 대표만 두면 나머지가 사라진다.
  categories: jsonb("categories").$type<string[]>(),
  // 분류 출처: main_item(발주처 지정) | name_rule(이름 추정) | none.
  // 추정을 사실처럼 말하지 않도록 화면이 구분할 수 있어야 한다.
  categorySrc: varchar("category_src", { length: 16 }),
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

/**
 * 학교×품목별 단골 참여 업체 — S-1 처방.
 * school_roster(품목 혼합)와 병존한다: 축산 사장에게 수산 조합이 보이던 문제를
 * 고치되, 기존 소비자를 깨지 않기 위해 새 테이블로 분리했다.
 */
export const schoolRosterCat = pgTable("school_roster_cat", {
  schoolId: varchar("school_id", { length: 200 }).notNull(),
  category: varchar("category", { length: 16 }).notNull(),
  bizNo: varchar("biz_no", { length: 16 }).notNull(),
  name: varchar("name", { length: 128 }),
  partN: integer("part_n").notNull(),
  winN: integer("win_n").notNull().default(0),
  winRates: jsonb("win_rates").$type<number[]>().notNull().default([]),
  medRate: doublePrecision("med_rate"),
}, (t) => [primaryKey({ columns: [t.schoolId, t.category, t.bizNo] })]);

/** 자격 레이더 — 열린 공고 (수집 시점 스냅샷) */
export const openAuctions = pgTable("open_auctions", {
  bidNo: varchar("bid_no", { length: 32 }).primaryKey(),
  schoolName: varchar("school_name", { length: 160 }),
  sigungu: varchar("sigungu", { length: 40 }),
  allowedRegions: jsonb("allowed_regions").$type<string[]>().notNull().default([]),
  basePrice: bigint("base_price", { mode: "number" }),
  floorRate: doublePrecision("floor_rate"),
  category: varchar("category", { length: 20 }),
  categories: jsonb("categories").$type<string[]>(),
  categorySrc: varchar("category_src", { length: 16 }),
  // deadline 은 개찰 시각(OPNG_DT)이다 — 마감이 아니다.
  // 실측: BID_END_DT != OPNG_DT 가 1,200/1,200, 차이 정확히 1시간.
  // 화면 카운트다운은 bidEndAt 을 써야 한다. deadline 은 "개찰 결과를 언제 보나"에 쓴다.
  deadline: timestamp("deadline"),
  bidEndAt: timestamp("bid_end_at"),      // 투찰 마감
  bidBeginAt: timestamp("bid_begin_at"),  // 투찰 시작 — "아직 시작 전" 구분용
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
  // sido 가 빠져 있었다. 집계는 (sido,sgg,cat) 로 하는데 충돌 대상이 (sgg,cat) 이라
  // 여러 시도에 있는 같은 이름(`남구`·`동구`·`중구` 등 51개)이 품목당 1행으로 뭉개졌다.
  // 어느 도시가 살아남는지는 insert 순서가 정했고, 지도가 도시를 뒤섞어 보여줬다.
}, (t) => [primaryKey({ columns: [t.sido, t.sigungu, t.category] })]);

