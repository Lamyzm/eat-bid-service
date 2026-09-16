/**
 * @module 책임: 한 build가 어휘로 번역하지 못한 원천 조각과 그 행 수 `mart.build_vocabulary_gap`을 소유한다.
 *
 * 다리표(`open_auction_snapshot_item`)는 어휘 안 원자만 싣고 어휘 밖 낱말은 조용히 버린다. 그 수를 세지
 * 않으면 원천이 아홉째 낱말을 보내기 시작한 날 화면은 그 행을 `품목 미상`으로 부르고 아무도 모른다 —
 * 없던 결손이 관측 결손처럼 보인다(AGENTS 3). 그래서 빌더가 build마다 조각과 행 수를 여기 남기고 운영
 * 기대(`item-vocabulary-gap`)가 활성 build에 행이 있으면 알린다(EAT-255).
 */
import { bigint, check, primaryKey, text, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";

export const martBuildVocabularyGap = martSchema.table(
  "build_vocabulary_gap",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    // 어느 어휘로 번역하려다 실패했는가. 품목 다리표는 `eatbid:auction-item`이고, 뒤에 올 회차 요약의
    // 품목 다리표도 같은 표를 쓰므로 체계 이름이 grain에 든다(EAT-256).
    schemeNamespace: varchar("scheme_namespace", { length: 128 }).notNull(),
    // 원천이 준 조각 그대로다. 코드가 아니라 격리된 관측이라 FK가 없다 — 어휘에 없으니 가리킬 코드가 없다.
    fragment: text("fragment").notNull(),
    rowCount: bigint("row_count", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.buildId, table.schemeNamespace, table.fragment] }),
    // 0행짜리 격리는 없다. 조각이 나타났으니 적어도 한 행이 그것을 가졌다.
    check("mart_build_vocabulary_gap_row_count_positive", sql`${table.rowCount} > 0`),
    check("mart_build_vocabulary_gap_fragment_present", sql`length(btrim(${table.fragment})) > 0`),
  ],
);
