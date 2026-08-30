import { bigint, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";

export const principal = appSchema.table("principal", {
  principalId: bigint("principal_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const identitySubject = appSchema.table(
  "identity_subject",
  {
    identitySubjectId: bigint("identity_subject_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    principalId: bigint("principal_id", { mode: "bigint" })
      .notNull()
      .references(() => principal.principalId),
    provider: varchar("provider", { length: 64 }).notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("identity_subject_provider_issuer_subject_key")
      .on(table.provider, table.issuer, table.subject),
  ],
);
