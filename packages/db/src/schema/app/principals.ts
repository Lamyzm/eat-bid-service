import { bigint, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { appSchema } from "../namespaces.js";

export const principal = appSchema.table("principal", {
  principalId: bigint("principal_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 이메일 같은 변경 가능한 속성으로 병합하지 않고 공급자·발급자·subject의 외부 정체성을 내부 principal에 연결한다.
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
