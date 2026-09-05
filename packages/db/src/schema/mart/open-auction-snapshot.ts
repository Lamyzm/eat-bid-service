/**
 * @module 책임: 오늘 화면이 읽는 열린 공고 관측 스냅샷 `mart.open_auction_snapshot`을 소유한다.
 *
 * 이 mart만 수명주기가 다르다. 참여 수 추이는 지난 관측점을 되돌아보므로 물린 build의 행을 곧바로
 * 지우지 않고 `mart.build.retain_until`이 지난 뒤에 회수한다(ADR 0034).
 */
import { bigint, char, check, index, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { codeValue } from "../core/codes.js";
import { organization } from "../core/organizations.js";
import { auctionAttempt } from "../core/procurement.js";
import { rawObservation } from "../ingest/evidence.js";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";
import { martMoney } from "./values.js";

export const openAuctionSnapshot = martSchema.table(
  "open_auction_snapshot",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    openAuctionSnapshotId: bigint("open_auction_snapshot_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    // 목록에만 있고 아직 상세를 따지 않은 공고도 identity 전용 attempt 행으로 먼저 만든다(ADR 0033).
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    // 근거 없는 스냅샷 행은 만들지 않는다. 이 관측이 곧 재파싱의 출발점이다.
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
    organizationId: bigint("organization_id", { mode: "bigint" }).references(() => organization.organizationId),
    // 목록이 표시한 참여 수(`BID_CNT`) 관측이다. 우리가 세지 않는다.
    bidCount: integer("bid_count"),
    sourceLastChangedAt: timestamp("source_last_changed_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    baseAmount: martMoney("base_amount"),
    currency: char("currency", { length: 3 }),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    itemLabel: text("item_label"),
    sourceStatusCodeValueId: bigint("source_status_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
  },
  (table) => [
    unique("open_auction_snapshot_observation_grain_key")
      .on(table.buildId, table.auctionAttemptId, table.observedAt)
      .nullsNotDistinct(),
    index("open_auction_snapshot_build_closes_idx").on(table.buildId, table.closesAt, table.auctionAttemptId),
    // 참여 수 추이는 활성 build 하나를 넘어 `retain_until` 안의 모든 build를 읽는다.
    index("open_auction_snapshot_attempt_observed_idx").on(table.auctionAttemptId, table.observedAt.desc()),
    check(
      "open_auction_snapshot_currency_required_with_amount",
      sql`${table.baseAmount} is null or ${table.currency} is not null`,
    ),
    check(
      "open_auction_snapshot_bid_count_nonnegative",
      sql`${table.bidCount} is null or ${table.bidCount} >= 0`,
    ),
  ],
);
