/**
 * 사용자 데이터 — 계정에 붙는 값과 사용 이벤트.
 * ⚠ 재적재 보존 대상: 로더가 건드리지 않으며 reset-dev.sql에서도 제외된다.
 */
import {
  pgTable, varchar, integer, bigint, doublePrecision, jsonb, date, timestamp, primaryKey, serial, boolean,
} from "drizzle-orm/pg-core";

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

/** 워크스페이스(Clerk org) ↔ 사업자번호 N개 — "우리집 = 신성+오뚜기" */
export const workspaceBiz = pgTable("workspace_biz", {
  workspaceId: varchar("workspace_id", { length: 64 }).notNull(),
  bizNo: varchar("biz_no", { length: 16 }).notNull(),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.bizNo] })]);

/** 사용 이벤트 — 게이트 측정(화면 열람). 재적재 시 초기화하지 않는다 */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  session: varchar("session", { length: 64 }).notNull(),
  screen: varchar("screen", { length: 40 }).notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
});

