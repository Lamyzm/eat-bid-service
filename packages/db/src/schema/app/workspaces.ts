import { sql } from "drizzle-orm";
import { bigint, check, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";

export const workspace = appSchema.table("workspace", {
  workspaceId: bigint("workspace_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// membership의 grain은 workspace와 principal의 한 쌍이며 role은 그 관계의 속성이다.
export const workspaceMembership = appSchema.table(
  "workspace_membership",
  {
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspace.workspaceId),
    principalId: bigint("principal_id", { mode: "bigint" })
      .notNull()
      .references(() => principal.principalId),
    role: varchar("role", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.principalId] }),
    // 값의 권위는 contracts의 Zod enum이고 이 제약은 그 사본을 DB가 강제한다. 자유 문자열로 두면
    // 오타 하나가 권한 없는 역할이 아니라 조용히 통과하는 새 역할이 된다(ADR 0032 §3).
    check("workspace_membership_role_allowed", sql`${table.role} in ('owner', 'member')`),
  ],
);

/**
 * 첫 저장이 만든 개인 workspace를 principal마다 하나로 고정한다.
 *
 * 왜 membership에 전역 unique를 걸지 않는가: 그 제약은 "한 사람은 한 workspace의 owner"라는 도메인
 * 권한 제한이 되어 초대와 다중 소유를 미리 막는다. 여기서 필요한 것은 동시 초기화가 workspace를 둘
 * 만들지 않는다는 보장뿐이고, 그 보장은 이 관계의 PK 하나로 충분하다. 경쟁에서 진 트랜잭션은 통째로
 * 되돌아가므로 주인 없는 workspace도 남지 않는다(ADR 0032 §8).
 */
export const principalDefaultWorkspace = appSchema.table("principal_default_workspace", {
  principalId: bigint("principal_id", { mode: "bigint" })
    .primaryKey()
    .references(() => principal.principalId),
  workspaceId: bigint("workspace_id", { mode: "bigint" })
    .notNull()
    .references(() => workspace.workspaceId),
  initializedAt: timestamp("initialized_at", { withTimezone: true }).notNull().defaultNow(),
});
