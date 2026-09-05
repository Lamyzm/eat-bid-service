/**
 * @module 책임: core schema에서 참여 업체(`SupplierParty`)와 원천 계정 identity의 table을 소유한다.
 *
 * 구매기관(`Organization`)과 참여 업체는 서로 다른 aggregate이므로 조직 module과 같은 파일에 두지 않는다.
 */
import { bigint, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";

// 업체명(`SHIPPER_NM`)은 code label observation으로 남기고, 사업자번호 code value 하나만 법적 정체성으로 쓴다.
// 사업자번호 관측이 없는 계정도 자기 party를 가져야 하므로 그 열은 nullable이고, 나중에 같은 사업자로
// 밝혀져도 자동 병합하지 않는다(ADR 0033, AGENTS 3).
export const supplierParty = coreSchema.table(
  "supplier_party",
  {
    supplierPartyId: bigint("supplier_party_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    type: varchar("type", { length: 32 }).notNull(),
    canonicalName: text("canonical_name"),
    businessNumberCodeValueId: bigint("business_number_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("supplier_party_business_number_key").on(table.businessNumberCodeValueId)],
);

// 한 업체가 원천마다 여러 참여 계정을 가질 수 있어 계정을 별도 행으로 두되, 계정 code value는 하나의
// party만 가리킨다. `(source_supplier_account_id, supplier_party_id)` unique는 명단 행이 party를
// 비정규화해 들고 있을 때 그 짝을 복합 FK로 강제하기 위한 참조 대상이다.
export const sourceSupplierAccount = coreSchema.table(
  "source_supplier_account",
  {
    sourceSupplierAccountId: bigint("source_supplier_account_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    supplierPartyId: bigint("supplier_party_id", { mode: "bigint" })
      .notNull()
      .references(() => supplierParty.supplierPartyId),
    sourceSystem: varchar("source_system", { length: 64 }).notNull(),
    accountCodeValueId: bigint("account_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("source_supplier_account_code_value_key").on(table.accountCodeValueId),
    unique("source_supplier_account_party_key").on(table.sourceSupplierAccountId, table.supplierPartyId),
  ],
);
