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

export const rawBlob = ingestSchema.table(
  "raw_blob",
  {
    contentSha256: char("content_sha256", { length: 64 }).primaryKey(),
    objectKey: text("object_key").notNull(),
    byteLength: bigint("byte_length", { mode: "bigint" }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    contentEncoding: varchar("content_encoding", { length: 64 }).notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("raw_blob_object_key_key").on(table.objectKey),
    check("raw_blob_byte_length_nonnegative", sql`${table.byteLength} >= 0`),
  ],
);

// 원문 blob을 content hash로 먼저 고정한 뒤 관측 메타데이터가 이를 참조해야 재현 가능한 증거 사슬이 된다.
export const rawObservation = ingestSchema.table(
  "raw_observation",
  {
    observationId: bigint("observation_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    requestUnitId: bigint("request_unit_id", { mode: "bigint" })
      .notNull()
      .references(() => requestUnit.requestUnitId),
    source: varchar("source", { length: 64 }).notNull(),
    endpoint: text("endpoint").notNull(),
    requestParams: jsonb("request_params").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    httpStatus: bigint("http_status", { mode: "bigint" }).notNull(),
    contentSha256: char("content_sha256", { length: 64 })
      .notNull()
      .references(() => rawBlob.contentSha256),
  },
  (table) => [
    // request unit과 observation이 다른 run에서 잘못 연결되는 것을 단일 FK보다 강하게 막는다.
    foreignKey({
      name: "raw_observation_request_unit_run_id_fkey",
      columns: [table.requestUnitId, table.runId],
      foreignColumns: [requestUnit.requestUnitId, requestUnit.runId],
    }),
  ],
);
