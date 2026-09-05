/**
 * @module 책임: mart 파생물의 빌드 정체성 원장 `mart.build`와 그 상태·계보 제약을 소유한다.
 *
 * 개별 mart 표의 열은 각자의 module이 소유하고, 여기에는 "어떤 봉인된 입력을 어떤 계산 규칙으로
 * 읽어 언제 활성화했는가"만 둔다(ADR 0034).
 */
import { bigint, check, index, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { publication } from "../ingest/publication.js";
import { sourceRelease } from "../ingest/release.js";
import { martSchema } from "../namespaces.js";

// 이 목록이 곧 빌더가 존재하는 mart의 전부다. 이름을 늘리기 전에 빌더와 표가 먼저 있어야 한다.
export const martNames = [
  "org_round_summary",
  "win_rate_distribution_monthly",
  "open_auction_snapshot",
] as const;

export const martBuildStatuses = ["building", "verified", "active", "superseded", "failed"] as const;

/**
 * 활성 build는 `mart_build_active_key` partial unique index가 mart마다 최대 하나로 강제한다.
 * 전환이 이름 바꾸기나 파티션 ATTACH 없이 한 트랜잭션의 UPDATE 둘로 끝나는 이유이며, 동시 전환은
 * 두 번째가 이 index 위반으로 끊긴다(ADR 0034, AGENTS 10).
 */
export const martBuild = martSchema.table(
  "build",
  {
    buildId: bigint("build_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    martName: varchar("mart_name", { length: 64, enum: martNames }).notNull(),
    sourceReleaseId: uuid("source_release_id")
      .notNull()
      .references(() => sourceRelease.sourceReleaseId),
    // 수동 전량 재빌드는 촉발한 발행이 없다. null은 "모른다"가 아니라 "발행이 촉발하지 않았다"이며
    // 멱등 키가 `nulls not distinct`라 같은 입력의 수동 재빌드가 둘로 갈라지지 않는다.
    publicationId: uuid("publication_id").references(() => publication.publicationId),
    calcVersion: varchar("calc_version", { length: 32 }).notNull(),
    // 배포 스탬프 BUILD_SHA다. 40자 SHA-1과 64자 hex를 모두 받는 계약을 `ingest.run`과 공유한다.
    builderVersion: varchar("builder_version", { length: 64 }).notNull(),
    // 이 build의 지역 축이 어떤 CodeScheme namespace인지다. 지역 축이 없는 mart는 null이다.
    // 열 이름이 아니라 build가 체계를 기록해야 체계가 바뀔 때 과거 build의 해석이 사후에 달라지지
    // 않는다(AGENTS 6, ADR 0034).
    regionScheme: varchar("region_scheme", { length: 64 }),
    status: varchar("status", { length: 16, enum: martBuildStatuses }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    rowCount: bigint("row_count", { mode: "bigint" }),
    // superseded build를 언제 회수해도 되는지다. 참여 수 추이가 지난 관측점을 읽는 mart만 길게 잡는다.
    retainUntil: timestamp("retain_until", { withTimezone: true }),
    failureCategory: varchar("failure_category", { length: 64 }),
  },
  (table) => [
    unique("mart_build_idempotency_key")
      .on(table.martName, table.calcVersion, table.sourceReleaseId, table.publicationId)
      .nullsNotDistinct(),
    uniqueIndex("mart_build_active_key").on(table.martName).where(sql`${table.status} = 'active'`),
    index("mart_build_mart_status_idx").on(table.martName, table.status),
    check(
      "mart_build_name_allowed",
      sql`${table.martName} in ('org_round_summary', 'win_rate_distribution_monthly', 'open_auction_snapshot')`,
    ),
    check(
      "mart_build_status_allowed",
      sql`${table.status} in ('building', 'verified', 'active', 'superseded', 'failed')`,
    ),
    check(
      "mart_build_builder_version_build_sha",
      sql`${table.builderVersion} ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'`,
    ),
    check("mart_build_row_count_nonnegative", sql`${table.rowCount} is null or ${table.rowCount} >= 0`),
    // 검증되지 않은 build는 행 수를 모른다. 상태와 계보 증거를 함께 묶어야 "검증했다고 적혀 있으나
    // 무엇을 셌는지 모르는" 행이 생기지 않는다.
    check(
      "mart_build_verified_requires_evidence",
      sql`${table.status} not in ('verified', 'active', 'superseded')
        or (${table.computedAt} is not null and ${table.rowCount} is not null)`,
    ),
    check(
      "mart_build_active_requires_activation",
      sql`${table.status} <> 'active'
        or (${table.activatedAt} is not null and ${table.failureCategory} is null and ${table.supersededAt} is null)`,
    ),
    check(
      "mart_build_superseded_requires_timestamp",
      sql`${table.status} <> 'superseded' or (${table.supersededAt} is not null and ${table.activatedAt} is not null)`,
    ),
    check(
      "mart_build_failed_requires_category",
      sql`(${table.status} = 'failed') = (${table.failureCategory} is not null)`,
    ),
    check(
      "mart_build_failed_is_never_activated",
      sql`${table.status} <> 'failed' or ${table.activatedAt} is null`,
    ),
    check(
      "mart_build_activation_chronology",
      sql`${table.activatedAt} is null or ${table.computedAt} is null or ${table.activatedAt} >= ${table.computedAt}`,
    ),
    check(
      "mart_build_supersession_chronology",
      sql`${table.supersededAt} is null or ${table.activatedAt} is null or ${table.supersededAt} >= ${table.activatedAt}`,
    ),
  ],
);
