/**
 * 인증 테이블 — Better Auth 라이브러리 규격.
 * ⚠ 수정 금지: 컬럼명·타입은 better-auth 코어(@better-auth/core get-tables)가 정한다.
 *    변경이 필요하면 라이브러리 버전 스키마를 먼저 대조할 것.
 * ⚠ 재적재 보존 대상 — schema.sql DROP 대상이 아니다.
 */
import {
  pgTable, varchar, integer, bigint, doublePrecision, jsonb, date, timestamp, primaryKey, serial, boolean,
} from "drizzle-orm/pg-core";

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
  // better-auth 1.7.x: account.issuer 필수 (provider 발급자 식별 — 누락 시 콜백 실패)
  issuer: varchar("issuer", { length: 200 }).notNull().default(""),
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

