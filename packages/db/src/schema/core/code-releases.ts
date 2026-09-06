/** @module 책임: 정부 코드 파일 한 벌이 만든 release와 그 release가 말한 코드 계층 사실을 저장한다. */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { sourceRelease } from "../ingest/release.js";
import { coreSchema } from "../namespaces.js";
import { codeScheme, codeValue } from "./codes.js";

// release는 봉인된 원본 입력 하나에서 나온 코드 한 벌이다. 승격 grain과 세 행 수를 여기 두는 이유는
// "무엇을 뺐는가"가 release 밖에 있으면 빠뜨림이 침묵하기 때문이다(AGENTS 3, ADR 0035 결정 2).
export const codeRelease = coreSchema.table(
  "code_release",
  {
    codeReleaseId: bigint("code_release_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    // 봉인된 원본 입력이 없으면 release도 없다. raw 저장 성공 전에 canonical 행을 공개하지 않는
    // 규칙이 FK 하나로 강제된다(AGENTS 변경 절차, ADR 0025).
    sourceReleaseId: uuid("source_release_id").notNull(),
    codeSchemeId: bigint("code_scheme_id", { mode: "bigint" })
      .notNull()
      .references(() => codeScheme.codeSchemeId),
    sourceVersion: varchar("source_version", { length: 128 }).notNull(),
    // 원본이 기준일자를 주지 않으면 null이다. 우리가 받은 시각으로 대신 채우면 그것이 정부의 발표일로
    // 읽히고, 개편 시점을 묻는 소비자가 우리 실행 시각을 답으로 받는다.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    promotedGrain: text("promoted_grain").array().notNull(),
    sourceRowCount: integer("source_row_count").notNull(),
    memberCount: integer("member_count").notNull(),
    excludedRowCount: integer("excluded_row_count").notNull(),
  },
  (table) => [
    // 같은 봉인 입력에서 같은 체계의 release를 두 번 만들지 않는다. 재실행은 같은 행에 도달해야 한다.
    foreignKey({
      name: "code_release_source_release_fkey",
      columns: [table.sourceReleaseId],
      foreignColumns: [sourceRelease.sourceReleaseId],
    }),
    unique("code_release_source_release_scheme_key").on(table.sourceReleaseId, table.codeSchemeId),
    check("code_release_promoted_grain_present", sql`array_length(${table.promotedGrain}, 1) >= 1`),
    check(
      "code_release_row_counts_nonnegative",
      sql`${table.sourceRowCount} >= 0 and ${table.memberCount} >= 0 and ${table.excludedRowCount} >= 0`,
    ),
    // 승격한 행과 뺀 행의 합이 원본 행 수와 같아야 한다. 이 등식이 없으면 파서가 조용히 흘린 행이
    // 어느 쪽에도 세어지지 않는다.
    check(
      "code_release_row_counts_partition_source",
      sql`${table.memberCount} + ${table.excludedRowCount} = ${table.sourceRowCount}`,
    ),
  ],
);

// member는 release가 말한 사실이다. 계층이 여기 있는 이유는 개편 때 상위가 바뀌기 때문이며,
// 정체성 표인 `code_value`에 두면 개편이 과거 행을 덮어쓴다(ADR 0035 결정 3).
export const codeReleaseMember = coreSchema.table(
  "code_release_member",
  {
    codeReleaseId: bigint("code_release_id", { mode: "bigint" }).notNull(),
    codeValueId: bigint("code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    parentCodeValueId: bigint("parent_code_value_id", { mode: "bigint" }),
    grain: varchar("grain", { length: 64 }).notNull(),
    active: boolean("active").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: "code_release_member_pkey", columns: [table.codeReleaseId, table.codeValueId] }),
    foreignKey({
      name: "code_release_member_release_fkey",
      columns: [table.codeReleaseId],
      foreignColumns: [codeRelease.codeReleaseId],
    }),
    // 상위는 **같은 release 안의 member**만 가리킨다. release를 건너뛰어 가리키면 활성 release의
    // 계층을 읽는 질의가 옛 개편의 상위를 섞어 읽는다.
    foreignKey({
      name: "code_release_member_parent_fkey",
      columns: [table.codeReleaseId, table.parentCodeValueId],
      foreignColumns: [table.codeReleaseId, table.codeValueId],
    }),
    check("code_release_member_parent_is_not_self", sql`${table.parentCodeValueId} is distinct from ${table.codeValueId}`),
    check(
      "code_release_member_valid_time_order",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);
