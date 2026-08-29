import {
  bigint,
  boolean,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
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
  (table) => [unique("code_value_scheme_code_key").on(table.codeSchemeId, table.code)],
);

export const codeLabelObservation = coreSchema.table("code_label_observation", {
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
});

export const codeMapping = coreSchema.table("code_mapping", {
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
});
