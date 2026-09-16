/**
 * @module 책임: core schema에서 투찰 명단·낙찰 판정과 재공고 attempt 연결 table을 소유한다.
 *
 * 공고 관측(attempt·revision)과 투찰 결과는 관측 시점과 재실행 단위가 달라 같은 module에서 함께 바뀌지 않는다.
 */
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";
import { auctionAttempt, auctionRevision } from "./procurement.js";
import { sourceSupplierAccount } from "./suppliers.js";

/**
 * 개찰 연도 range 파티션 table이며 `PARTITION BY RANGE ("opened_at")`와 연도 파티션은 Drizzle이
 * 표현하지 못해 migration.sql에 손으로 이어 붙인다(ADR 0033 §3). 여기서는 평범한 table로 선언해
 * 열·제약·인덱스의 저작권을 Drizzle에 남긴다.
 *
 * primary key가 없는 이유: 파티션 키는 unique에 반드시 포함되어야 하는데 `opened_at`은 nullable이다.
 * primary key를 얻자고 not null로 좁히면 개찰 시각을 관측하지 못한 명단 하나가 발행 전체를 격리시킨다.
 * 대신 `unique nulls not distinct` 둘이 대리키와 발행 grain을 각각 지킨다.
 *
 * 승패·무효·실효하한 열을 두지 않는 이유: 원본 `BID_STT`가 유일한 판정 권위이고 그날 하한은 표본 수와
 * 계산 버전을 달고 mart가 발표하는 파생물이다(AGENTS 7·8).
 */
export const bidSubmission = coreSchema.table(
  "bid_submission",
  {
    bidSubmissionId: bigint("bid_submission_id", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" }).notNull(),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    rosterOrdinal: integer("roster_ordinal").notNull(),
    sourceSupplierAccountId: bigint("source_supplier_account_id", { mode: "bigint" }).notNull(),
    supplierPartyId: bigint("supplier_party_id", { mode: "bigint" }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    effectiveAmount: numeric("effective_amount", { precision: 18, scale: 2 }),
    currency: char("currency", { length: 3 }).notNull(),
    // `SAJEONG_PCT`는 상한이 없고 정수부 12자리가 관측된다. numeric(6,3)에 넣으면 값을 잃는다.
    bidRate: numeric("bid_rate", { precision: 15, scale: 3 }).notNull(),
    rank: integer("rank"),
    sourceStatusCodeValueId: bigint("source_status_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    withdrawalCodeValueId: bigint("withdrawal_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    drawNumbers: text("draw_numbers").array().notNull().default(sql`'{}'`),
    observedRosterSize: integer("observed_roster_size"),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("bid_submission_surrogate_key").on(table.bidSubmissionId, table.openedAt).nullsNotDistinct(),
    unique("bid_submission_roster_grain_key")
      .on(table.auctionRevisionId, table.rosterOrdinal, table.openedAt)
      .nullsNotDistinct(),
    // 명단 행이 attempt와 party를 비정규화해 들고 있으므로 그 짝이 revision·계정과 어긋나지 못하게 한다.
    foreignKey({
      name: "bid_submission_auction_revision_fkey",
      columns: [table.auctionRevisionId, table.auctionAttemptId],
      foreignColumns: [auctionRevision.auctionRevisionId, auctionRevision.auctionAttemptId],
    }),
    foreignKey({
      name: "bid_submission_supplier_account_fkey",
      columns: [table.sourceSupplierAccountId, table.supplierPartyId],
      foreignColumns: [
        sourceSupplierAccount.sourceSupplierAccountId,
        sourceSupplierAccount.supplierPartyId,
      ],
    }),
    index("bid_submission_auction_attempt_idx").on(table.auctionAttemptId),
    index("bid_submission_supplier_party_opened_idx").on(table.supplierPartyId, table.openedAt),
  ],
);

/**
 * revision당 낙찰 판정은 0 또는 1이다. 전수 리포트의 `multiple_award_rows = 0`이 근거이고, 위반이
 * 관측되면 두 행을 만드는 것이 아니라 격리한다(ADR 0033 §1).
 *
 * `awarded_roster_ordinal`이 FK가 아닌 이유: 명단은 파티션 table이고, 연도 파티션을 더할 때마다 하는
 * DETACH/ATTACH가 그 FK와 씨름하게 된다. 운영 절차의 단순함을 참조 무결성보다 위에 두고, 좌표의 존재와
 * 판정 코드는 projector가 같은 트랜잭션에서 검증한다(ADR 0033 §4-라).
 */
export const awardDecision = coreSchema.table(
  "award_decision",
  {
    awardDecisionId: bigint("award_decision_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" }).notNull(),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" }).notNull(),
    awardedRosterOrdinal: integer("awarded_roster_ordinal").notNull(),
    sourceSupplierAccountId: bigint("source_supplier_account_id", { mode: "bigint" }).notNull(),
    supplierPartyId: bigint("supplier_party_id", { mode: "bigint" }).notNull(),
    // `SUCBD_DT`는 날짜 정밀도다. 같은 날 안의 선후를 이 값으로 판단하지 않는다.
    awardedAt: timestamp("awarded_at", { withTimezone: true }),
    awardedAmount: numeric("awarded_amount", { precision: 18, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    awardedRate: numeric("awarded_rate", { precision: 15, scale: 3 }).notNull(),
    // 원본 `RNK=2` 행의 값이지 "유효 투찰 중 2등"이 아니다. 우리가 유효를 판정하지 않는다.
    runnerUpRate: numeric("runner_up_rate", { precision: 15, scale: 3 }),
    sourceStatusCodeValueId: bigint("source_status_code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("award_decision_auction_revision_key").on(table.auctionRevisionId),
    foreignKey({
      name: "award_decision_auction_revision_fkey",
      columns: [table.auctionRevisionId, table.auctionAttemptId],
      foreignColumns: [auctionRevision.auctionRevisionId, auctionRevision.auctionAttemptId],
    }),
    foreignKey({
      name: "award_decision_supplier_account_fkey",
      columns: [table.sourceSupplierAccountId, table.supplierPartyId],
      foreignColumns: [
        sourceSupplierAccount.sourceSupplierAccountId,
        sourceSupplierAccount.supplierPartyId,
      ],
    }),
  ],
);

/**
 * 재입찰 사슬 관계이며 `domain-and-data.md` §3.1이 `AuctionRelation`으로 부르던 것이다.
 *
 * 사슬 상대를 외부 문자열이 아니라 내부 attempt id로만 잇는다(AGENTS 2). 아직 수집하지 않은 상대는
 * `core.auction_attempt`에 identity 전용 행으로 먼저 만들며, 그래서 revision이 0개인 attempt는
 * "관계로만 알려진 공고"라는 유효한 상태다. 공고 수를 세는 질의는 revision 존재를 조건으로 삼아야 한다.
 */
export const auctionAttemptLink = coreSchema.table(
  "auction_attempt_link",
  {
    auctionAttemptLinkId: bigint("auction_attempt_link_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionRevision.auctionRevisionId),
    fromAuctionAttemptId: bigint("from_auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    toAuctionAttemptId: bigint("to_auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    relation: varchar("relation", { length: 32 }).notNull(),
    // 표시값이다. 접미사를 차수로 읽지 않으며 관계 키로도 쓰지 않는다.
    displayBidNo: text("display_bid_no"),
    sourceStatusCodeValueId: bigint("source_status_code_value_id", { mode: "bigint" })
      .references(() => codeValue.codeValueId),
    bidOpenedFrom: timestamp("bid_opened_from", { withTimezone: true }),
    bidClosedAt: timestamp("bid_closed_at", { withTimezone: true }),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }),
    plannedAmount: numeric("planned_amount", { precision: 18, scale: 2 }),
    currency: char("currency", { length: 3 }),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
  },
  (table) => [
    unique("auction_attempt_link_observation_key").on(
      table.auctionRevisionId,
      table.toAuctionAttemptId,
      table.relation,
    ),
    check(
      "auction_attempt_link_relation_allowed",
      sql`${table.relation} in ('parent', 'chain_member')`,
    ),
    // 금액에 통화가 없으면 그 금액은 해석할 수 없는 숫자다(AGENTS 15).
    check(
      "auction_attempt_link_currency_required_with_amount",
      sql`(${table.baseAmount} is null and ${table.plannedAmount} is null) or ${table.currency} is not null`,
    ),
    // 사슬 상대의 예정가격도 같은 해석이다: 0은 추첨된 적 없음이고 null로 앉는다(EAT-199).
    check(
      "auction_attempt_link_planned_amount_positive",
      sql`${table.plannedAmount} is null or ${table.plannedAmount} > 0`,
    ),
  ],
);
