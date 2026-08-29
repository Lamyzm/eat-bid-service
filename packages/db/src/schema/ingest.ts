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
import { ingestSchema } from "./namespaces.js";

const runStatuses = ["planned", "running", "failed", "validated", "published"] as const;
const parserStatuses = ["pending", "normalized", "quarantined"] as const;
const requestUnitStatuses = ["planned", "captured", "failed"] as const;
const publicationStatuses = ["pending", "validated", "published", "failed"] as const;

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

export const rawBlob = ingestSchema.table(
  "raw_blob",
  {
    contentSha256: char("content_sha256", { length: 64 }).primaryKey(),
    objectKey: text("object_key").notNull(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    contentEncoding: varchar("content_encoding", { length: 64 }).notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("raw_blob_object_key_key").on(table.objectKey),
    check("raw_blob_byte_length_nonnegative", sql`${table.byteLength} >= 0`),
  ],
);

export const rawObservation = ingestSchema.table(
  "raw_observation",
  {
    observationId: bigint("observation_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    requestUnitId: bigint("request_unit_id", { mode: "number" })
      .notNull()
      .references(() => requestUnit.requestUnitId),
    source: varchar("source", { length: 64 }).notNull(),
    endpoint: text("endpoint").notNull(),
    requestParams: jsonb("request_params").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    httpStatus: bigint("http_status", { mode: "number" }).notNull(),
    contentSha256: char("content_sha256", { length: 64 })
      .notNull()
      .references(() => rawBlob.contentSha256),
    sourceEntityId: text("source_entity_id"),
    schemaFingerprint: char("schema_fingerprint", { length: 64 }),
    parserStatus: varchar("parser_status", { length: 16, enum: parserStatuses }).notNull(),
    quarantineReason: text("quarantine_reason"),
  },
  (table) => [
    check("raw_observation_parser_status_allowed", sql`${table.parserStatus} in ('pending', 'normalized', 'quarantined')`),
  ],
);

export const normalizedRecord = ingestSchema.table(
  "normalized_record",
  {
    normalizedRecordId: bigint("normalized_record_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    observationId: bigint("observation_id", { mode: "number" })
      .notNull()
      .references(() => rawObservation.observationId),
    recordType: varchar("record_type", { length: 64 }).notNull(),
    sourceEntityId: text("source_entity_id").notNull(),
    normalizedPayload: jsonb("normalized_payload").notNull(),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    normalizedAt: timestamp("normalized_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("normalized_record_observation_type_entity_parser_key").on(
      table.observationId,
      table.recordType,
      table.sourceEntityId,
      table.parserVersion,
    ),
  ],
);

export const publication = ingestSchema.table(
  "publication",
  {
    publicationId: uuid("publication_id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    status: varchar("status", { length: 16, enum: publicationStatuses }).notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    expectedCount: bigint("expected_count", { mode: "number" }).notNull(),
    normalizedCount: bigint("normalized_count", { mode: "number" }).notNull(),
    publishedCount: bigint("published_count", { mode: "number" }).notNull(),
  },
  (table) => [
    unique("publication_run_id_key").on(table.runId),
    check("publication_status_allowed", sql`${table.status} in ('pending', 'validated', 'published', 'failed')`),
    check("publication_expected_count_nonnegative", sql`${table.expectedCount} >= 0`),
    check("publication_normalized_count_nonnegative", sql`${table.normalizedCount} >= 0`),
    check("publication_published_count_nonnegative", sql`${table.publishedCount} >= 0`),
    check(
      "publication_validated_requires_validation_timestamp",
      sql`${table.status} not in ('validated', 'published') or ${table.validatedAt} is not null`,
    ),
    check(
      "publication_published_requires_gate",
      sql`${table.status} <> 'published' or (
        ${table.validatedAt} is not null
        and ${table.activatedAt} is not null
        and ${table.expectedCount} = ${table.normalizedCount}
        and ${table.normalizedCount} = ${table.publishedCount}
      )`,
    ),
  ],
);
