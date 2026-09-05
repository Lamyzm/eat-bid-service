/**
 * @module 책임: 결정 화면이 읽는 회차(AuctionAttempt) 1행 요약 파생 테이블 `mart.org_round_summary`를 소유한다.
 *
 * 계보(어느 release·어느 계산 규칙·언제)는 이 표가 아니라 `mart.build`가 갖고, 여기에는 build 하나에
 * 매달린 회차 요약만 둔다(ADR 0034).
 */
import { bigint, char, date, index, integer, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { codeValue } from "../core/codes.js";
import { organization } from "../core/organizations.js";
import { auctionAttempt, auctionRevision } from "../core/procurement.js";
import { supplierParty } from "../core/suppliers.js";
import { martSchema } from "../namespaces.js";
import { martBuild } from "./build.js";
import { assessmentRate, bidRate, martMoney, observedRate } from "./values.js";

// 회차(AuctionAttempt) 1행 요약. 흐름·과거 회차·레일 계산이 전부 이 테이블만 읽는다(architecture.md §3.3).
// grain은 `(build_id, auction_attempt_id)`이며 한 attempt의 최신 revision 하나를 요약한다.
export const orgRoundSummary = martSchema.table(
  "org_round_summary",
  {
    buildId: bigint("build_id", { mode: "bigint" })
      .notNull()
      .references(() => martBuild.buildId),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    // 어느 해석을 요약했는지 없으면 이 행을 원본에서 재현할 수 없다.
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionRevision.auctionRevisionId),
    organizationId: bigint("organization_id", { mode: "bigint" })
      .notNull()
      .references(() => organization.organizationId),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    itemLabel: text("item_label"),
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    floorRate: observedRate("floor_rate"),
    // 사정률 코호트를 단가입찰과 섞지 않기 위한 키다. 코드 자체는 core의 code value가 소유한다.
    awardMethodCodeValueId: bigint("award_method_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    baseAmount: martMoney("base_amount").notNull(),
    plannedAmount: martMoney("planned_amount"),
    currency: char("currency", { length: 3 }).notNull(),
    // 관측. 낙찰 판정 행의 사정률(분모가 예정가격)이다.
    awardedAssessmentRate: assessmentRate("awarded_assessment_rate"),
    // 관측. 원본 `RNK=2` 행의 사정률이지 "유효 투찰 중 2등"이 아니다.
    runnerUpAssessmentRate: assessmentRate("runner_up_assessment_rate"),
    // 파생. `floor(floor_rate / 100 * planned_amount, 2)`이며 내림이다. 소스의 규칙이 사는 축이
    // 금액이고, 올림하면 유효한 투찰 하나를 없는 것으로 만든다. 레일의 "이 값이면" 비교는 이 열로 한다.
    dayFloorAmount: martMoney("day_floor_amount"),
    // 파생·표시용. 그날 하한을 투찰률 축(기초금액 분모)으로 번역한 값이다. 비교의 권위는 금액 축이다.
    dayFloorBidRate: bidRate("day_floor_bid_rate"),
    // 파생·표시용. 낙찰 사정률을 같은 투찰률 축으로 옮긴 값이다.
    awardedBidRate: bidRate("awarded_bid_rate"),
    listCount: integer("list_count"),
    // 파생. 사정률 축에서 `bid_rate < floor_rate`를 센다. 나눗셈이 없어 반올림 없이 정확하다.
    belowDayFloorCount: integer("below_day_floor_count"),
    withdrawnCount: integer("withdrawn_count"),
    // `withdrawn_count`의 분모 성숙도다. 개찰 직후의 0과 한 달 뒤의 0은 같은 사실이 아니다.
    withdrawalCohortAgeDays: integer("withdrawal_cohort_age_days"),
    winnerSupplierPartyId: bigint("winner_supplier_party_id", { mode: "bigint" })
      .references(() => supplierParty.supplierPartyId),
    supersedesAttemptId: bigint("supersedes_attempt_id", { mode: "bigint" })
      .references(() => auctionAttempt.auctionAttemptId),
    // `ds_bidHistory` 보유율이 낮아 사슬 없음과 미확인을 한 값으로 숨기면 화면이 거짓말한다.
    lineageStatus: varchar("lineage_status", { length: 16, enum: ["observed", "unknown"] }).notNull(),
    openedMonthKst: date("opened_month_kst"),
  },
  (table) => [
    primaryKey({ columns: [table.buildId, table.auctionAttemptId] }),
    // 서버 어댑터의 `order by`와 `nulls last`까지 같아야 planner가 정렬 없이 이 index의 pathkey를 쓴다.
    index("org_round_summary_build_org_announced_idx").on(
      table.buildId,
      table.organizationId,
      table.announcedAt.desc().nullsLast(),
      table.auctionAttemptId.desc().nullsLast(),
    ),
    index("org_round_summary_build_org_item_announced_idx").on(
      table.buildId,
      table.organizationId,
      table.itemCodeValueId,
      table.announcedAt.desc().nullsLast(),
      table.auctionAttemptId.desc().nullsLast(),
    ),
    check(
      "org_round_summary_lineage_status_allowed",
      sql`${table.lineageStatus} in ('observed', 'unknown')`,
    ),
    // 금액에 통화가 없으면 그 금액은 해석할 수 없는 숫자다(AGENTS 15).
    check(
      "org_round_summary_day_floor_requires_planned_amount",
      sql`${table.dayFloorAmount} is null or (${table.plannedAmount} is not null and ${table.floorRate} is not null)`,
    ),
    check(
      "org_round_summary_below_day_floor_needs_floor_rate",
      sql`${table.belowDayFloorCount} is null or ${table.floorRate} is not null`,
    ),
    check(
      "org_round_summary_counts_nonnegative",
      sql`(${table.listCount} is null or ${table.listCount} >= 0)
        and (${table.belowDayFloorCount} is null or ${table.belowDayFloorCount} >= 0)
        and (${table.withdrawnCount} is null or ${table.withdrawnCount} >= 0)`,
    ),
    check(
      "org_round_summary_below_day_floor_within_list",
      sql`${table.belowDayFloorCount} is null or ${table.listCount} is null
        or ${table.belowDayFloorCount} <= ${table.listCount}`,
    ),
  ],
);
