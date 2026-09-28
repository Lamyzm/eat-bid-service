import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { ingestSchema } from "../namespaces.js";
import { rawObservation } from "./evidence.js";
import { normalizedRecord, publication } from "./publication.js";

const exclusionStages = ["normalize", "project"] as const;

/**
 * 발행에서 뺀 레코드 하나마다 한 행이다(ADR 0061). 제외의 단위는 관측 하나에서 나온 공고 상세 한 건 전체이며
 * 줄 단위 부분 행이 아니다. 이 원장이 있어야 `expected = published + excluded`가 "기록된 결손"이 되고, 원장에
 * 없는 결손은 여전히 발행을 막는다 — 기록 없이 사라지는 레코드는 허용하지 않는다.
 *
 * `normalize` 단계의 제외는 정규화 레코드가 없고(파싱 자체가 그 한 건에서 실패), `project` 단계의 제외는
 * 정규화 레코드를 가리킨다(해석은 됐지만 투영 계약이 그 한 건을 거부). 두 단계를 섞으면 replay가 무엇을
 * 다시 해야 하는지 원장에서 읽을 수 없으므로 check로 묶는다.
 */
export const publicationExclusion = ingestSchema.table(
  "publication_exclusion",
  {
    publicationId: uuid("publication_id")
      .notNull()
      .references(() => publication.publicationId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
    normalizedRecordId: bigint("normalized_record_id", { mode: "bigint" })
      .references(() => normalizedRecord.normalizedRecordId),
    stage: varchar("stage", { length: 16, enum: exclusionStages }).notNull(),
    reasonCode: text("reason_code").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "publication_exclusion_pkey",
      columns: [table.publicationId, table.observationId],
    }),
    check("publication_exclusion_stage_allowed", sql`${table.stage} in ('normalize', 'project')`),
    check(
      "publication_exclusion_stage_record",
      sql`(
        ${table.stage} = 'normalize'
        and ${table.normalizedRecordId} is null
      ) or (
        ${table.stage} = 'project'
        and ${table.normalizedRecordId} is not null
      )`,
    ),
    check("publication_exclusion_reason_code_nonempty", sql`char_length(${table.reasonCode}) > 0`),
    check("publication_exclusion_reason_bounded", sql`char_length(${table.reason}) <= 500`),
  ],
);
