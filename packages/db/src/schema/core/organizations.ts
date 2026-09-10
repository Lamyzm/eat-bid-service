import { bigint, index, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
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
  (table) => [
    unique("organization_identifier_code_value_key").on(table.codeValueId),
    // 명단·내 투찰의 purchaserObservedAtJoin(server auction-roster-query)은 revision의 구매기관
    // organization_id로 이 표를 조인해 eat:organization code value를 찾는다. 위 unique key는 code_value_id
    // 축이라 organization_id 축의 조인은 별도 index가 있어야 표 전체를 읽지 않는다.
    index("organization_identifier_organization_idx").on(table.organizationId),
  ],
);
