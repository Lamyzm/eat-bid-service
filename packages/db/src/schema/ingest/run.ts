import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ingestSchema } from "../namespaces.js";

const runStatuses = ["planned", "running", "failed", "validated", "published"] as const;
const requestUnitStatuses = ["planned", "captured", "failed"] as const;

// run의 종료 상태는 종료 시각과 실패/발행 메타데이터를 함께 고정해 부분 완료를 성공으로 해석하지 못하게 한다.
export const ingestRun = ingestSchema.table(
  "run",
  {
    runId: uuid("run_id").primaryKey(),
    mode: varchar("mode", { length: 32 }).notNull(),
    status: varchar("status", { length: 16, enum: runStatuses }).notNull(),
    // build_sha는 release commit 스탬프이고 40자 SHA-1과 64자 hex를 모두 받는다. char(64)는 40자를
    // 공백으로 채워 저장해 run ledger 대조와 checkpoint 비교가 조용히 어긋난다.
    buildSha: varchar("build_sha", { length: 64 }).notNull(),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    failureCategory: varchar("failure_category", { length: 64 }),
    expectedCount: bigint("expected_count", { mode: "bigint" }).notNull(),
    capturedCount: bigint("captured_count", { mode: "bigint" }).notNull(),
    publishedCount: bigint("published_count", { mode: "bigint" }).notNull(),
  },
  (table) => [
    check("run_status_allowed", sql`${table.status} in ('planned', 'running', 'failed', 'validated', 'published')`),
    check("run_expected_count_nonnegative", sql`${table.expectedCount} >= 0`),
    check("run_captured_count_nonnegative", sql`${table.capturedCount} >= 0`),
    check("run_published_count_nonnegative", sql`${table.publishedCount} >= 0`),
    check("run_end_chronology", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`),
    check(
      "run_terminal_metadata",
      sql`(
        ${table.status} = 'failed'
        and ${table.failureCategory} is not null
        and ${table.endedAt} is not null
      ) or (
        ${table.status} = 'published'
        and ${table.failureCategory} is null
        and ${table.endedAt} is not null
      ) or (
        ${table.status} in ('planned', 'running', 'validated')
        and ${table.failureCategory} is null
        and ${table.endedAt} is null
      )`,
    ),
    check(
      "run_published_count_matches_expected",
      sql`(
        ${table.status} = 'published'
        and ${table.publishedCount} = ${table.expectedCount}
      ) or (
        ${table.status} <> 'published'
        and ${table.publishedCount} = 0
      )`,
    ),
  ],
);

// 정규화된 요청 매개변수 hash가 한 run 안의 논리 요청 단위를 멱등하게 식별한다.
export const requestUnit = ingestSchema.table(
  "request_unit",
  {
    requestUnitId: bigint("request_unit_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    source: varchar("source", { length: 64 }).notNull(),
    endpoint: text("endpoint").notNull(),
    requestParams: jsonb("request_params").notNull(),
    requestParamsHash: char("request_params_hash", { length: 64 }).notNull(),
    expectedCount: bigint("expected_count", { mode: "bigint" }).notNull(),
    observedCount: bigint("observed_count", { mode: "bigint" }).notNull(),
    // 몇 번째 HTTP 시도에서 이 요청 단위의 관측을 얻었는지는 해석이 아니라 관측이다. 소스가 얼마나
    // 불안정했는지를 사후에 세려면 성공한 실행에도 남아야 하므로 실패 카테고리와 따로 기록한다.
    // 재시도가 없었던 요청이 1이라 계획 시점의 기본값도 1이다.
    attemptCount: integer("attempt_count").notNull().default(1),
    status: varchar("status", { length: 16, enum: requestUnitStatuses }).notNull(),
  },
  (table) => [
    unique("request_unit_id_run_id_key").on(table.requestUnitId, table.runId),
    unique("request_unit_run_source_endpoint_params_key").on(
      table.runId,
      table.source,
      table.endpoint,
      table.requestParamsHash,
    ),
    check("request_unit_expected_count_nonnegative", sql`${table.expectedCount} >= 0`),
    check("request_unit_observed_count_nonnegative", sql`${table.observedCount} >= 0`),
    check("request_unit_attempt_count_positive", sql`${table.attemptCount} >= 1`),
  ],
);
