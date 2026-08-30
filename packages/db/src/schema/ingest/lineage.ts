import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { ingestSchema } from "../namespaces.js";
import { rawObservation } from "./evidence.js";
import { normalizedRecord, publication } from "./publication.js";
import { ingestRun } from "./run.js";

const attemptStatuses = ["normalized", "quarantined"] as const;

// 성공은 schema fingerprint, 격리는 bounded reason을 가져야 하며 두 종료 상태의 메타데이터가 섞이면 안 된다.
export const normalizationAttempt = ingestSchema.table(
  "normalization_attempt",
  {
    normalizationAttemptId: bigint("normalization_attempt_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
    parserVersion: varchar("parser_version", { length: 128 }).notNull(),
    status: varchar("status", { length: 16, enum: attemptStatuses }).notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    schemaFingerprint: char("schema_fingerprint", { length: 64 }),
    quarantineReason: text("quarantine_reason"),
  },
  (table) => [
    unique("normalization_attempt_run_observation_parser_key").on(
      table.runId,
      table.observationId,
      table.parserVersion,
    ),
    check(
      "normalization_attempt_status_allowed",
      sql`${table.status} in ('normalized', 'quarantined')`,
    ),
    check(
      "normalization_attempt_final_metadata",
      sql`(
        ${table.status} = 'normalized'
        and ${table.schemaFingerprint} is not null
        and ${table.quarantineReason} is null
      ) or (
        ${table.status} = 'quarantined'
        and ${table.quarantineReason} is not null
      )`,
    ),
    check(
      "normalization_attempt_schema_fingerprint_sha256",
      sql`${table.schemaFingerprint} is null or ${table.schemaFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "normalization_attempt_quarantine_reason_bounded",
      sql`${table.quarantineReason} is null or char_length(${table.quarantineReason}) <= 500`,
    ),
  ],
);

// 한 시도가 여러 canonical record를 만들 수 있어 provenance를 다대다 연결로 보존한다.
export const normalizationAttemptRecord = ingestSchema.table(
  "normalization_attempt_record",
  {
    normalizationAttemptId: bigint("normalization_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => normalizationAttempt.normalizationAttemptId),
    normalizedRecordId: bigint("normalized_record_id", { mode: "bigint" })
      .notNull()
      .references(() => normalizedRecord.normalizedRecordId),
  },
  (table) => [
    primaryKey({
      columns: [table.normalizationAttemptId, table.normalizedRecordId],
    }),
  ],
);

export const publicationRecord = ingestSchema.table(
  "publication_record",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.publicationId),
    normalizedRecordId: bigint("normalized_record_id", { mode: "bigint" })
      .notNull()
      .references(() => normalizedRecord.normalizedRecordId),
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.normalizedRecordId] }),
  ],
);

export const replayInput = ingestSchema.table(
  "replay_input",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.runId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [primaryKey({ columns: [table.runId, table.observationId] })],
);
