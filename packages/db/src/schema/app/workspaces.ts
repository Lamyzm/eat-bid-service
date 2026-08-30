import { bigint, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";

export const workspace = appSchema.table("workspace", {
  workspaceId: bigint("workspace_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
