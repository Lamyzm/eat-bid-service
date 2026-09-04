/** @module 책임: 결정 화면이 읽는 회차(AuctionAttempt) 1행 요약 파생 테이블 `mart.org_round_summary`를 소유한다. */
import { bigint, char, index, integer, numeric, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { codeValue } from "../core/codes.js";
import { organization } from "../core/organizations.js";
import { auctionAttempt } from "../core/procurement.js";
import { martSchema } from "../namespaces.js";

// 회차(AuctionAttempt) 1행 요약. 흐름·과거 회차·레일 계산이 전부 이 테이블만 읽는다(architecture.md §3.3).
// 파생물이므로 publish 뒤 mart 빌드가 통째로 다시 만들 수 있어야 하며 원본 사실을 덮어쓰지 않는다.
export const orgRoundSummary = martSchema.table(
  "org_round_summary",
  {
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" }).primaryKey().references(() => auctionAttempt.auctionAttemptId),
    organizationId: bigint("organization_id", { mode: "bigint" }).notNull().references(() => organization.organizationId),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    itemLabel: text("item_label"),
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    floorRate: numeric("floor_rate", { precision: 6, scale: 3 }),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    winRate: numeric("win_rate", { precision: 6, scale: 3 }),
    secondRate: numeric("second_rate", { precision: 6, scale: 3 }),
    // 그날 하한은 원본 판정(무효 상단)의 관측값이다. 계산한 실효하한을 넣지 않는다.
    dayFloorRate: numeric("day_floor_rate", { precision: 6, scale: 3 }),
    listCount: integer("list_count"),
    invalidCount: integer("invalid_count"),
    // supplier_party 테이블은 EAT-43에서 생긴다. 그때 FK를 추가하며 지금은 값만 보존한다.
    winnerSupplierPartyId: bigint("winner_supplier_party_id", { mode: "bigint" }),
    supersedesAttemptId: bigint("supersedes_attempt_id", { mode: "bigint" }).references(() => auctionAttempt.auctionAttemptId),
    martRelease: varchar("mart_release", { length: 64 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    calcVersion: varchar("calc_version", { length: 32 }).notNull(),
  },
  (table) => [
    index("org_round_summary_org_announced_idx").on(table.organizationId, table.announcedAt.desc(), table.auctionAttemptId.desc()),
  ],
);
