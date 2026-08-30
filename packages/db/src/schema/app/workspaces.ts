import { bigint, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
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
  (table) => [primaryKey({ columns: [table.workspaceId, table.principalId] })],
);
