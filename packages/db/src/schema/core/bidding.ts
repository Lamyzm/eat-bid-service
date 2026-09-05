/**
 * @module 책임: core schema에서 투찰 명단·낙찰 판정과 재공고 attempt 연결 table을 소유한다.
 *
 * 공고 관측(attempt·revision)과 투찰 결과는 관측 시점과 재실행 단위가 달라 같은 module에서 함께 바뀌지 않는다.
 */
import {
  bigint,
  char,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";
import { auctionRevision } from "./procurement.js";
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
