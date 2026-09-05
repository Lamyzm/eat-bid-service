/**
 * @module 책임: 한 build가 읽은 (지역, 달) 구간의 모집단 보유율 `mart.build_coverage`를 소유한다.
 *
 * 지표 행과 grain이 다르고 입력이 `ingest.request_unit`이라 mart 표들과 함께 바뀌지 않는다.
 */
import { bigint, check, date, unique, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { codeValue } from "../core/codes.js";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";

export const coverageValues = ["complete", "partial", "none", "unknown"] as const;

/**
 * `unknown`이 넷째 값인 이유: 지금 수집한 구간에는 시도 축이 없어 그 grain의 분모를 낼 수 없다.
 * 이것을 `partial`로 뭉개면 화면이 "일부 수집됨"이라고 거짓말한다. 모르면 모른다고 말한다(AGENTS 3).
 *
 * API는 요청 코호트에 걸린 행들의 가장 나쁜 값을 응답에 싣는다(`none` > `unknown` > `partial` > `complete`).
 */
export const martBuildCoverage = martSchema.table(
  "build_coverage",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    // null은 전국이다. 지역 축 없이 수집된 구간의 분모가 사는 자리이며 체계는 build가 기록한다.
    regionCodeValueId: bigint("region_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    monthKst: date("month_kst").notNull(),
    expectedCount: bigint("expected_count", { mode: "bigint" }).notNull(),
    observedCount: bigint("observed_count", { mode: "bigint" }).notNull(),
    normalizedCount: bigint("normalized_count", { mode: "bigint" }).notNull(),
    quarantinedCount: bigint("quarantined_count", { mode: "bigint" }).notNull(),
    coverage: varchar("coverage", { length: 16, enum: coverageValues }).notNull(),
  },
  (table) => [
    unique("mart_build_coverage_grain_key")
      .on(table.buildId, table.regionCodeValueId, table.monthKst)
      .nullsNotDistinct(),
    check(
      "mart_build_coverage_value_allowed",
      sql`${table.coverage} in ('complete', 'partial', 'none', 'unknown')`,
    ),
    check(
      "mart_build_coverage_counts_nonnegative",
      sql`${table.expectedCount} >= 0 and ${table.observedCount} >= 0
        and ${table.normalizedCount} >= 0 and ${table.quarantinedCount} >= 0`,
    ),
    // 종단 수가 관측 수를 넘으면 그 구간의 분모 해석이 이미 깨진 것이다.
    check(
      "mart_build_coverage_terminal_within_observed",
      sql`${table.normalizedCount} + ${table.quarantinedCount} <= ${table.observedCount}`,
    ),
  ],
);
