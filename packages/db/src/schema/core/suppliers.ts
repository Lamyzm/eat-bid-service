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

// 한 계정은 시점에 따라 다른 party로 관측된다. 사업자번호는 계정의 영구 속성이 아니라 투찰마다 소스가
// 보내는 관측이기 때문이다(ADR 0049). 계정 200075(스마일푸드)는 2025-11에 `3261902824`, 2025-12부터
// `5019589353`으로 투찰했고 상호도 계정도 그대로였다 — 개인사업자의 법인 전환에서 흔하다.
//
// 그래서 계정 code value에 party 하나를 영구히 묶지 않고 `(계정 code value, party)` 짝마다 행을 둔다.
// `(source_supplier_account_id, supplier_party_id)` unique는 그대로 남긴다. 명단 행이 party를 비정규화해
// 들고 있을 때 그 짝을 복합 FK로 강제하는 참조 대상이며, 시점을 담는 것과 무결성을 지키는 것은 별개다.
//
// 반대 방향(한 사업자번호에 계정 여럿)은 이미 있었고 그대로 동작한다 — party 유일 키가 사업자번호인 것은
// 바뀌지 않는다.
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
    // 이 짝을 처음 본 관측이다. 같은 짝이 뒤에 또 나와도 행을 늘리지 않으므로 최초 관측이 남는다.
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("source_supplier_account_code_party_key").on(table.accountCodeValueId, table.supplierPartyId),
    unique("source_supplier_account_party_key").on(table.sourceSupplierAccountId, table.supplierPartyId),
  ],
);
