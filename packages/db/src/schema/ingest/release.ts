import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { ingestSchema } from "../namespaces.js";
import { rawObservation } from "./evidence.js";
import { ingestRun } from "./run.js";

const sourceReleaseStatuses = ["planned", "sealed", "failed"] as const;

export const sourceRelease = ingestSchema.table(
  "source_release",
  {
    sourceReleaseId: uuid("source_release_id").primaryKey(),
    source: varchar("source", { length: 64 }).notNull(),
    releaseName: varchar("release_name", { length: 128 }).notNull(),
    status: varchar("status", { length: 16, enum: sourceReleaseStatuses }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    manifestSha256: char("manifest_sha256", { length: 64 }),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    failureCategory: varchar("failure_category", { length: 64 }),
  },
  (table) => [
    unique("source_release_source_release_name_key").on(table.source, table.releaseName),
    uniqueIndex("source_release_source_manifest_sha256_key")
      .on(table.source, table.manifestSha256)
      .where(sql`${table.manifestSha256} is not null`),
    check(
      "source_release_status_allowed",
      sql`${table.status} in ('planned', 'sealed', 'failed')`,
    ),
    check(
      "source_release_manifest_sha256",
      sql`${table.manifestSha256} is null or ${table.manifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "source_release_terminal_metadata",
      sql`(
        ${table.status} = 'sealed'
        and ${table.manifestSha256} is not null
        and ${table.sealedAt} is not null
        and ${table.failureCategory} is null
      ) or (
        ${table.status} = 'failed'
        and ${table.manifestSha256} is null
        and ${table.sealedAt} is null
        and ${table.failureCategory} is not null
      ) or (
        ${table.status} = 'planned'
        and ${table.manifestSha256} is null
        and ${table.sealedAt} is null
        and ${table.failureCategory} is null
      )`,
    ),
  ],
);

export const sourceReleaseRun = ingestSchema.table(
  "source_release_run",
  {
    sourceReleaseId: uuid("source_release_id")
      .notNull()
      .references(() => sourceRelease.sourceReleaseId),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
  },
  (table) => [primaryKey({ columns: [table.sourceReleaseId, table.runId] })],
);

export const sourceReleaseObservation = ingestSchema.table(
  "source_release_observation",
  {
    sourceReleaseId: uuid("source_release_id")
      .notNull()
      .references(() => sourceRelease.sourceReleaseId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [primaryKey({ columns: [table.sourceReleaseId, table.observationId] })],
);

export const sourceReleaseDataset = ingestSchema.table(
  "source_release_dataset",
  {
    sourceReleaseId: uuid("source_release_id")
      .notNull()
      .references(() => sourceRelease.sourceReleaseId),
    endpoint: text("endpoint").notNull(),
    dataset: varchar("dataset", { length: 128 }).notNull(),
    recordType: varchar("record_type", { length: 64 }).notNull(),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    schemaFingerprint: char("schema_fingerprint", { length: 64 }).notNull(),
    expectedCount: bigint("expected_count", { mode: "bigint" }).notNull(),
    observedCount: bigint("observed_count", { mode: "bigint" }).notNull(),
    normalizedCount: bigint("normalized_count", { mode: "bigint" }).notNull(),
    quarantinedCount: bigint("quarantined_count", { mode: "bigint" }).notNull(),
    required: boolean("required").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceReleaseId, table.dataset] }),
    check(
      "source_release_dataset_schema_fingerprint_sha256",
      sql`${table.schemaFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "source_release_dataset_expected_count_nonnegative",
      sql`${table.expectedCount} >= 0`,
    ),
    check(
      "source_release_dataset_observed_count_nonnegative",
      sql`${table.observedCount} >= 0`,
    ),
    check(
      "source_release_dataset_normalized_count_nonnegative",
      sql`${table.normalizedCount} >= 0`,
    ),
    check(
      "source_release_dataset_quarantined_count_nonnegative",
      sql`${table.quarantinedCount} >= 0`,
    ),
    check(
      "source_release_dataset_observed_count_not_above_expected",
      sql`${table.observedCount} <= ${table.expectedCount}`,
    ),
    check(
      "source_release_dataset_terminal_count_not_above_observed",
      sql`${table.normalizedCount} + ${table.quarantinedCount} <= ${table.observedCount}`,
    ),
  ],
);
