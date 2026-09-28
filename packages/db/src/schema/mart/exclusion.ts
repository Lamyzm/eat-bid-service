/**
 * @module 책임: 한 build가 `ingest.publication_exclusion`에서 파생해 싣는 제외 사실 두 가지 — 달별 제외 공고 수
 * `mart.build_exclusion_month`와 최신 관측이 반영되지 않은 공고 `mart.build_stale_auction` — 를 소유한다.
 *
 * 왜 mart인가: 서버는 core·mart만 읽고 ingest를 읽지 않는다(`eatbid_api` 역할에 ingest 권한이 없다). 제외 원장은
 * ingest에 있으므로 화면이 그 사실을 보려면 dataplane mart 빌더가 build마다 파생해 실어야 한다(ADR 0061 결정 5·6).
 * 보유율(`build_coverage`)처럼 지표가 아니라 "그 지표를 어떻게 읽어야 하는가"를 말하는 부속 사실이라 mart 이름을
 * 늘리지 않고 build에 매단다.
 */
import { bigint, check, date, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auctionAttempt, auctionRevision } from "../core/procurement.js";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";

/**
 * 한 달에 원장이 적은 제외 공고 수다. 발행 수와 섞은 비율이 아니라 따로 센 수다(ADR 0061 결정 6) — 섞으면
 * "빼고 다 들어왔다"와 "다 들어왔다"가 같은 숫자가 된다.
 *
 * 달은 그 관측을 받은 목록 창(`P_BID_BGNG_DT`)의 시작 달이다. `ingest.backfill_coverage`가 창을 세는 자리와 같다.
 * 창에 이어지지 않는 관측은 어느 달인지 말할 수 없으므로 행이 없다 — 그 뷰도 같은 관측을 세지 않는다.
 * 제외가 한 건도 없는 달은 행이 없고, 읽는 쪽은 그것을 0건으로 읽는다.
 */
export const martBuildExclusionMonth = martSchema.table(
  "build_exclusion_month",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    monthKst: date("month_kst").notNull(),
    // 원장에 적힌 적이 있는 공고 수다. 뒤에 재파싱으로 해소된 것도 센다 — 원장은 지워지지 않는 기록이다.
    excludedAuctionCount: bigint("excluded_auction_count", { mode: "bigint" }).notNull(),
    // 그 가운데 제외된 관측이 아직 어느 revision도 만들지 못한 공고 수다. 지금도 반영되지 않은 결손은 이쪽이다.
    unresolvedAuctionCount: bigint("unresolved_auction_count", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.buildId, table.monthKst] }),
    // 0건인 달은 행을 만들지 않는다. 행이 있으면 적어도 한 공고가 원장에 있다.
    check("mart_build_exclusion_month_excluded_positive", sql`${table.excludedAuctionCount} > 0`),
    check(
      "mart_build_exclusion_month_unresolved_within_excluded",
      sql`${table.unresolvedAuctionCount} >= 0 and ${table.unresolvedAuctionCount} <= ${table.excludedAuctionCount}`,
    ),
  ],
);

/**
 * 이미 공개된 공고의 **더 늦은 관측**이 제외돼 옛 revision이 현행으로 남은 공고다(ADR 0061 결정 5 마지막 항).
 * 화면이 "최신 관측 반영 안 됨"을 말하는 유일한 재료다.
 *
 * `auction_revision_id`는 build 시점의 현행 revision(서버와 같은 규칙: id가 가장 큰 것)이다. 읽는 쪽은 지금 보여
 * 주는 revision과 이 값이 같을 때만 표시한다 — build 뒤에 새 revision이 발행됐다면 그 표시는 이미 틀린 말이다.
 *
 * 관측 시각이 둘인 이유는 화면이 "언제 받은 내용을 반영하지 못했고, 지금 보이는 것은 언제 받은 것인가"를 함께
 * 말해야 하기 때문이다. 둘 다 `ingest.raw_observation.fetched_at`에서 오며 서버는 그 표를 읽지 못한다.
 */
export const martBuildStaleAuction = martSchema.table(
  "build_stale_auction",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionRevision.auctionRevisionId),
    // 제외된 관측 가운데 가장 늦은 것의 수신 시각이다.
    excludedObservedAt: timestamp("excluded_observed_at", { withTimezone: true }).notNull(),
    // 현행 revision이 해석한 관측의 수신 시각이다.
    reflectedObservedAt: timestamp("reflected_observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.buildId, table.auctionAttemptId] }),
    // 제외된 관측이 현행보다 늦지 않으면 최신은 이미 반영돼 있다. 그런 행은 거짓 경고다.
    check(
      "mart_build_stale_auction_excluded_after_reflected",
      sql`${table.excludedObservedAt} > ${table.reflectedObservedAt}`,
    ),
  ],
);
