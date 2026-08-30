import { bigint, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";

export const organization = coreSchema.table("organization", {
  organizationId: bigint("organization_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  type: varchar("type", { length: 64 }).notNull(),
  canonicalName: text("canonical_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 이름과 유형은 바뀔 수 있으므로 식별자로 쓰지 않고 증거가 있는 code value가 조직을 유일하게 가리키게 한다.
export const organizationIdentifier = coreSchema.table(
  "organization_identifier",
  {
    organizationIdentifierId: bigint("organization_identifier_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    organizationId: bigint("organization_id", { mode: "bigint" })
      .notNull()
      .references(() => organization.organizationId),
    codeValueId: bigint("code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [unique("organization_identifier_code_value_key").on(table.codeValueId)],
);
