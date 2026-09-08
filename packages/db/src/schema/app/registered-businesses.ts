/**
 * @module 책임: 워크스페이스가 자기 분석 기준으로 등록한 사업자와 그 사업장 위치를 사용자 작성 상태로
 * 소유한다.
 *
 * 여기 있는 것은 관측이 아니라 사용자가 적은 값이다. `core.supplier_party`와의 연결은 이 표에 저장하지
 * 않고 읽을 때 `eat:business-number` code value로 정확 대조해 파생한다. FK를 저장해 두면 나중에 원본에서
 * 그 사업자가 처음 관측돼도 저장된 `null`이 그대로 남아 영원히 미연결이 된다(ADR 0032 §7).
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";
import { workspace } from "./workspaces.js";

export const registeredBusiness = appSchema.table(
  "registered_business",
  {
    registeredBusinessId: bigint("registered_business_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspace.workspaceId),
    // 정규화된 사업자등록번호 10자리다. 대조 키이지 식별자가 아니므로 FK도 URL 값도 되지 않는다.
    businessNumber: char("business_number", { length: 10 }).notNull(),
    registeredByPrincipalId: bigint("registered_by_principal_id", { mode: "bigint" })
      .notNull()
      .references(() => principal.principalId),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // 활성 등록의 유일성은 워크스페이스 안에서만 강제한다. 사업자등록번호는 공개 정보라 전역 선점은
    // 방어가 아니라 먼저 넣은 사람이 실사용자의 등록을 막는 서비스 거부다(ADR 0032 §7).
    uniqueIndex("registered_business_active_number_key")
      .on(table.workspaceId, table.businessNumber)
      .where(sql`${table.revokedAt} is null`),
    check("registered_business_number_digits", sql`${table.businessNumber} ~ '^[0-9]{10}$'`),
  ],
);

export const registeredBusinessLocation = appSchema.table(
  "registered_business_location",
  {
    // 위치 미설정은 행이 없는 것이다. 빈 문자열이나 기본 지역을 넣지 않는다.
    registeredBusinessId: bigint("registered_business_id", { mode: "bigint" })
      .primaryKey()
      .references(() => registeredBusiness.registeredBusinessId, { onDelete: "cascade" }),
    // 사용자가 적은 주소 문장 그대로다. 해석된 행정구역 코드도 좌표도 아니며 그 열을 두지 않는다.
    addressText: text("address_text").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByPrincipalId: bigint("updated_by_principal_id", { mode: "bigint" })
      .notNull()
      .references(() => principal.principalId),
  },
  (table) => [
    check(
      "registered_business_location_address_present",
      sql`length(btrim(${table.addressText})) > 0`,
    ),
  ],
);
