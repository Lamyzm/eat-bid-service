import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
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

export const ingestRun = ingestSchema.table(
  "run",
  {
    runId: uuid("run_id").primaryKey(),
    mode: varchar("mode", { length: 32 }).notNull(),
    status: varchar("status", { length: 16, enum: runStatuses }).notNull(),
    buildSha: char("build_sha", { length: 64 }).notNull(),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    failureCategory: varchar("failure_category", { length: 64 }),
    expectedCount: bigint("expected_count", { mode: "number" }).notNull(),
    capturedCount: bigint("captured_count", { mode: "number" }).notNull(),
    publishedCount: bigint("published_count", { mode: "number" }).notNull(),
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

export const requestUnit = ingestSchema.table(
  "request_unit",
  {
    requestUnitId: bigint("request_unit_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    source: varchar("source", { length: 64 }).notNull(),
    endpoint: text("endpoint").notNull(),
    requestParams: jsonb("request_params").notNull(),
    requestParamsHash: char("request_params_hash", { length: 64 }).notNull(),
    expectedCount: bigint("expected_count", { mode: "number" }).notNull(),
    observedCount: bigint("observed_count", { mode: "number" }).notNull(),
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
  ],
);
