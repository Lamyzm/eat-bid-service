/**
 * @module 책임: 오늘 투찰·공고 상세가 워크스페이스에 내보낸 방법별 추천 금액(1번·2번·한 장)을 화면 장부로 소유한다.
 *
 * 복기는 그때 화면에 보인 값과 개찰 사실을 대조한다(PDR-0008 결정 7). 아침 갱신은 화면을 연 시각마다 값이 달라 나중에 되살릴 수
 * 없으므로, 서버가 금액을 내보낼 때 남긴 이 기록만이 "그때 무엇을 보였는가"의 권위다. 분석 결과가 아니라 사용자에게 보인 상태라 `app`에
 * 둔다(ADR 0068).
 */
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, numeric, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { auctionAttempt } from "../core/procurement.js";
import { appSchema } from "../namespaces.js";
import { workspace } from "./workspaces.js";

export const bidDisplayRecord = appSchema.table(
  "bid_display_record",
  {
    bidDisplayRecordId: bigint("bid_display_record_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspace.workspaceId),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    method: varchar("method", { length: 32 }).notNull(),
    // 방법 표의 판이다. 같은 금액이라도 판이 다르면 근거가 다르므로 다른 줄이다.
    methodVersion: varchar("method_version", { length: 32 }).notNull(),
    // 금액을 낸 하한율이다. 화면의 사정률은 기초금액 대비 %를 이 값으로 나눈 것이라(ADR 0066) 둘을 함께 남겨야 되살릴 수 있다.
    floorRate: numeric("floor_rate", { precision: 6, scale: 3 }).notNull(),
    // 화면에 보인 기초금액 대비 %다. 배수가 아니라 화면 숫자 그대로 남긴다 — 장부는 "무엇을 보였는가"의 기록이다.
    firstBaseRelativeRate: numeric("first_base_relative_rate", { precision: 8, scale: 4 }).notNull(),
    // 등록 사업자가 하나면 두 장 금액이 없다.
    secondBaseRelativeRate: numeric("second_base_relative_rate", { precision: 8, scale: 4 }),
    // 한 곳만 넣을 때의 금액이다. 전국 공식에는 없다.
    singleBaseRelativeRate: numeric("single_base_relative_rate", { precision: 8, scale: 4 }),
    // 맞춤은 고른 창(`2026-07~2026-09`), 아침 갱신은 반영한 마지막 같은 날 개찰 시각이 근거다. 처음 내보낸 때의 근거를 남긴다.
    basisPeriod: varchar("basis_period", { length: 32 }),
    basisObservedThrough: timestamp("basis_observed_through", { withTimezone: true }),
    // 맞춤은 창 안 공고 수, 전국 공식은 대역을 고른 참여 수, 아침 갱신은 오늘 자리가 보인 단골 수다.
    basisCount: integer("basis_count"),
    firstServedAt: timestamp("first_served_at", { withTimezone: true }).notNull(),
    lastServedAt: timestamp("last_served_at", { withTimezone: true }).notNull(),
    servedCount: integer("served_count").notNull().default(1),
  },
  (table) => [
    // 같은 공고에 같은 판·같은 금액을 다시 내보내면 줄을 늘리지 않고 마지막 시각만 고친다. 금액이 바뀌면 새 줄이다.
    unique("bid_display_record_shown_value_key")
      .on(
        table.workspaceId,
        table.auctionAttemptId,
        table.method,
        table.methodVersion,
        table.floorRate,
        table.firstBaseRelativeRate,
        table.secondBaseRelativeRate,
        table.singleBaseRelativeRate,
      )
      .nullsNotDistinct(),
    index("bid_display_record_workspace_served_idx").on(table.workspaceId, table.firstServedAt),
    check(
      "bid_display_record_method_known",
      sql`${table.method} in ('market-pick', 'national-rule', 'morning-habit')`,
    ),
    check("bid_display_record_served_order", sql`${table.firstServedAt} <= ${table.lastServedAt}`),
    check("bid_display_record_served_count_positive", sql`${table.servedCount} >= 1`),
  ],
);
