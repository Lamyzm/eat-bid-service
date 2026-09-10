import {
  bigint,
  boolean,
  index,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";

export const codeScheme = coreSchema.table(
  "code_scheme",
  {
    codeSchemeId: bigint("code_scheme_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    namespace: text("namespace").notNull(),
    owner: varchar("owner", { length: 128 }).notNull(),
    versionPolicy: varchar("version_policy", { length: 64 }).notNull(),
    validTimePolicy: varchar("valid_time_policy", { length: 64 }).notNull(),
  },
  (table) => [unique("code_scheme_namespace_key").on(table.namespace)],
);

// code 문자열은 scheme 밖에서는 식별자가 아니므로 두 열의 유일성을 함께 강제한다.
export const codeValue = coreSchema.table(
  "code_value",
  {
    codeValueId: bigint("code_value_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    codeSchemeId: bigint("code_scheme_id", { mode: "bigint" })
      .notNull()
      .references(() => codeScheme.codeSchemeId),
    code: text("code").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    active: boolean("active").default(true).notNull(),
  },
  (table) => [
    unique("code_value_scheme_code_key").on(table.codeSchemeId, table.code),
    check(
      "code_value_valid_time_order",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);

// label은 canonical code를 덮어쓰지 않는 관측 사실이며 원문 observation을 반드시 가리킨다.
export const codeLabelObservation = coreSchema.table(
  "code_label_observation",
  {
    codeLabelObservationId: bigint("code_label_observation_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    codeValueId: bigint("code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    label: text("label").notNull(),
    language: varchar("language", { length: 16 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("code_label_observation_evidence_key").on(
      table.codeValueId,
      table.label,
      table.language,
      table.observationId,
    ),
    // 공고 상세·열린 공고 목록·코드 조회는 행마다 lateral로 "이 code value의 가장 나중 관측 라벨 하나"를
    // `where code_value_id = ? order by observed_at desc, code_label_observation_id desc limit 1`로 집는다
    // (server의 codeReferenceJoin·regionReferenceJoin·DrizzleCodeReader.members). 재수집마다 관측이 쌓이므로
    // 정렬을 index pathkey가 줘야 한다. 위 evidence key는 label·language가 관측 시각 앞에 있어 이 정렬을
    // 못 주며, 명단·내 투찰의 `code_value_id = ? and observation_id = ?` 조회는 그 evidence key가 맡는다.
    // `nullsFirst()`를 명시하는 이유: server SQL의 plain `desc`는 PostgreSQL에서 `desc nulls first`인데
    // drizzle의 `desc()`만으로는 `DESC NULLS LAST`가 생성되고, 두 열이 not null이어도 planner는 nulls 방향이
    // 다른 pathkey를 같은 정렬로 보지 않아 index를 읽고도 top-N sort를 다시 한다(EAT-153 EXPLAIN 실측).
    index("code_label_observation_value_observed_idx").on(
      table.codeValueId,
      table.observedAt.desc().nullsFirst(),
      table.codeLabelObservationId.desc().nullsFirst(),
    ),
  ],
);

// 서로 다른 코드 체계의 매핑은 추론 결과이므로 유효기간과 근거 observation 없이는 만들 수 없다.
export const codeMapping = coreSchema.table(
  "code_mapping",
  {
    codeMappingId: bigint("code_mapping_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    fromCodeValueId: bigint("from_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    toCodeValueId: bigint("to_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    relation: varchar("relation", { length: 32 }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    evidenceObservationId: bigint("evidence_observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
    status: varchar("status", { length: 32 }).notNull(),
  },
  (table) => [
    check(
      "code_mapping_has_validity_boundary",
      sql`${table.validFrom} is not null or ${table.validTo} is not null`,
    ),
    check(
      "code_mapping_valid_time_order",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);
