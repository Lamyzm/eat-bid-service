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
import { rawObservation } from "./evidence.js";
import { ingestRun } from "./run.js";

const publicationStatuses = ["pending", "validated", "published", "failed"] as const;

export const normalizedRecord = ingestSchema.table(
  "normalized_record",
  {
    normalizedRecordId: bigint("normalized_record_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    observationId: bigint("observation_id", { mode: "bigint" })
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

// publish는 일부 결과를 노출하는 명령이 아니라 수량 일치·fingerprint·projector version을 모두 갖춘 원자적 gate다.
// 수량 일치는 "기대 = 발행 + 원장에 적은 제외"다(ADR 0061). 제외가 0이면 기대·정규화·발행이 모두 같아야 하는
// 이전 gate와 똑같고, 원장에 없는 결손은 여전히 통과하지 못한다.
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
    expectedCount: bigint("expected_count", { mode: "bigint" }).notNull(),
    normalizedCount: bigint("normalized_count", { mode: "bigint" }).notNull(),
    publishedCount: bigint("published_count", { mode: "bigint" }).notNull(),
    // 발행에서 뺀 레코드 수이며 `ingest.publication_exclusion`의 이 발행 행 수와 같다(ADR 0061). 0이면 이전과
    // 똑같이 전량 발행이다.
    excludedCount: integer("excluded_count").notNull().default(0),
    canonicalFingerprint: char("canonical_fingerprint", { length: 64 }),
    projectorVersion: varchar("projector_version", { length: 128 }),
  },
  (table) => [
    unique("publication_run_id_key").on(table.runId),
    check("publication_status_allowed", sql`${table.status} in ('pending', 'validated', 'published', 'failed')`),
    check("publication_expected_count_nonnegative", sql`${table.expectedCount} >= 0`),
    check("publication_normalized_count_nonnegative", sql`${table.normalizedCount} >= 0`),
    check("publication_published_count_nonnegative", sql`${table.publishedCount} >= 0`),
    check("publication_excluded_count_nonnegative", sql`${table.excludedCount} >= 0`),
    check(
      "publication_activation_chronology",
      sql`${table.activatedAt} is null or ${table.validatedAt} is null or ${table.activatedAt} >= ${table.validatedAt}`,
    ),
    check(
      "publication_validated_requires_validation_timestamp",
      sql`${table.status} not in ('validated', 'published') or ${table.validatedAt} is not null`,
    ),
    check(
      "publication_canonical_fingerprint_sha256",
      sql`${table.canonicalFingerprint} is null or ${table.canonicalFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "publication_projector_version_nonempty",
      sql`${table.projectorVersion} is null or char_length(${table.projectorVersion}) > 0`,
    ),
    check(
      "publication_nonpublished_metadata_empty",
      sql`${table.status} = 'published' or (
        ${table.activatedAt} is null
        and ${table.publishedCount} = 0
        and ${table.canonicalFingerprint} is null
        and ${table.projectorVersion} is null
      )`,
    ),
    check(
      "publication_published_requires_gate",
      sql`${table.status} <> 'published' or (
        ${table.validatedAt} is not null
        and ${table.activatedAt} is not null
        and ${table.expectedCount} = ${table.publishedCount} + ${table.excludedCount}
        and ${table.normalizedCount} >= ${table.publishedCount}
        and ${table.normalizedCount} <= ${table.expectedCount}
        and ${table.canonicalFingerprint} is not null
        and ${table.projectorVersion} is not null
      )`,
    ),
  ],
);
