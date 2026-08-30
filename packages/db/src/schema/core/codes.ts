import {
  bigint,
  boolean,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";

export const codeScheme = coreSchema.table(
  "code_scheme",
  {
    codeSchemeId: bigint("code_scheme_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    namespace: text("namespace").notNull(),
    owner: varchar("owner", { length: 128 }).notNull(),
    versionPolicy: varchar("version_policy", { length: 64 }).notNull(),
    validTimePolicy: varchar("valid_time_policy", { length: 64 }).notNull(),
  },
  (table) => [unique("code_scheme_namespace_key").on(table.namespace)],
);

// code 문자열은 scheme 밖에서는 식별자가 아니므로 두 열의 유일성을 함께 강제한다.
export const codeValue = coreSchema.table(
  "code_value",
  {
    codeValueId: bigint("code_value_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    codeSchemeId: bigint("code_scheme_id", { mode: "number" })
      .notNull()
      .references(() => codeScheme.codeSchemeId),
    code: text("code").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    active: boolean("active").default(true).notNull(),
  },
  (table) => [
    unique("code_value_scheme_code_key").on(table.codeSchemeId, table.code),
    check(
      "code_value_valid_time_order",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);

// label은 canonical code를 덮어쓰지 않는 관측 사실이며 원문 observation을 반드시 가리킨다.
export const codeLabelObservation = coreSchema.table(
  "code_label_observation",
  {
    codeLabelObservationId: bigint("code_label_observation_id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    codeValueId: bigint("code_value_id", { mode: "number" })
      .notNull()
      .references(() => codeValue.codeValueId),
    label: text("label").notNull(),
    language: varchar("language", { length: 16 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    observationId: bigint("observation_id", { mode: "number" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("code_label_observation_evidence_key").on(
      table.codeValueId,
      table.label,
      table.language,
      table.observationId,
    ),
  ],
);

// 서로 다른 코드 체계의 매핑은 추론 결과이므로 유효기간과 근거 observation 없이는 만들 수 없다.
export const codeMapping = coreSchema.table(
  "code_mapping",
  {
    codeMappingId: bigint("code_mapping_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    fromCodeValueId: bigint("from_code_value_id", { mode: "number" })
      .notNull()
      .references(() => codeValue.codeValueId),
    toCodeValueId: bigint("to_code_value_id", { mode: "number" })
      .notNull()
      .references(() => codeValue.codeValueId),
    relation: varchar("relation", { length: 32 }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    evidenceObservationId: bigint("evidence_observation_id", { mode: "number" })
      .notNull()
      .references(() => rawObservation.observationId),
    status: varchar("status", { length: 32 }).notNull(),
  },
  (table) => [
    check(
      "code_mapping_has_validity_boundary",
      sql`${table.validFrom} is not null or ${table.validTo} is not null`,
    ),
    check(
      "code_mapping_valid_time_order",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);
