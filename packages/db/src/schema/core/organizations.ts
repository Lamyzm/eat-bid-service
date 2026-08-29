import { bigint, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";

export const organization = coreSchema.table("organization", {
  organizationId: bigint("organization_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  type: varchar("type", { length: 64 }).notNull(),
  canonicalName: text("canonical_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizationIdentifier = coreSchema.table(
  "organization_identifier",
  {
    organizationIdentifierId: bigint("organization_identifier_id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organization.organizationId),
    codeValueId: bigint("code_value_id", { mode: "number" })
      .notNull()
      .references(() => codeValue.codeValueId),
    observationId: bigint("observation_id", { mode: "number" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [unique("organization_identifier_code_value_key").on(table.codeValueId)],
);
