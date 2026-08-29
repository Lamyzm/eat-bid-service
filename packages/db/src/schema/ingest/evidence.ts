import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ingestSchema } from "../namespaces.js";
import { ingestRun, requestUnit } from "./run.js";

const parserStatuses = ["pending", "normalized", "quarantined"] as const;

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
    foreignKey({
      name: "raw_observation_request_unit_run_id_fkey",
      columns: [table.requestUnitId, table.runId],
      foreignColumns: [requestUnit.requestUnitId, requestUnit.runId],
    }),
    check("raw_observation_parser_status_allowed", sql`${table.parserStatus} in ('pending', 'normalized', 'quarantined')`),
  ],
);
