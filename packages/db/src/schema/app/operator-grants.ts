/**
 * @module 책임: 운영자 권한의 부여·회수 이력을 사용자 작성 상태로 소유한다(ADR 0032 §3).
 *
 * principal의 boolean 열이 아니라 별도 표인 이유는 운영자 권한이 사람의 속성이 아니라 부여·회수되는 권한이기
 * 때문이다. 누가 언제 왜 줬는지가 사고 조사의 1차 자료이고, boolean은 한 번의 UPDATE로 그 흔적 없이 뒤집힌다.
 * 그래서 회수도 행을 지우지 않고 `revoked_at`을 채운다.
 *
 * 첫 운영자는 부여해 줄 운영자가 없으므로 자기 자신이 부여자인 행 하나로 시작한다. 그 절차와 이유 문구는
 * `docs/operations/operator-grant.md`가 소유한다.
 */
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";

export const operatorGrant = appSchema.table(
  "operator_grant",
  {
    operatorGrantId: bigint("operator_grant_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    principalId: bigint("principal_id", { mode: "bigint" })
      .notNull()
      .references(() => principal.principalId),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedByPrincipalId: bigint("granted_by_principal_id", { mode: "bigint" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    reason: text("reason").notNull(),
  },
  (table) => [
    // 같은 표를 두 번 가리키는 FK라 자동 이름이 해시로 나온다. 해시 이름은 뒤 마이그레이션이 제약을 지울 때
    // 이름을 맞히지 못하게 하므로 이름을 고정한다.
    foreignKey({
      name: "operator_grant_granted_by_principal_fkey",
      columns: [table.grantedByPrincipalId],
      foreignColumns: [principal.principalId],
    }),
    // 살아 있는 부여는 사람마다 하나다. 둘이면 하나를 회수해도 권한이 남아 회수가 회수가 아니게 된다.
    uniqueIndex("operator_grant_active_principal_key")
      .on(table.principalId)
      .where(sql`${table.revokedAt} is null`),
    index("operator_grant_principal_idx").on(table.principalId),
    check("operator_grant_reason_present", sql`length(btrim(${table.reason})) > 0`),
    check("operator_grant_revoked_after_granted", sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt}`),
  ],
);
