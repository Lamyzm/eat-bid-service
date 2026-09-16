/**
 * @module 책임: core schema에서 공고 attempt·revision과 그 revision에 매달린 조직·code value 관계 table을 소유한다.
 *
 * 참여 업체 identity는 `./suppliers.js`, 투찰·낙찰 사실은 `./bidding.js`가 소유한다.
 * 공고 관측 grain과 투찰 결과 grain은 함께 바뀌지 않으므로 이 module에 되돌려 놓지 않는다.
 */
import {
  bigint,
  char,
  check,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { rawObservation } from "../ingest/evidence.js";
import { normalizedRecord } from "../ingest/publication.js";
import { coreSchema } from "../namespaces.js";
import { codeValue } from "./codes.js";
import { organization } from "./organizations.js";

export const auctionAttempt = coreSchema.table(
  "auction_attempt",
  {
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    sourceSystem: varchar("source_system", { length: 64 }).notNull(),
    externalBidId: text("external_bid_id").notNull(),
  },
  (table) => [unique("auction_attempt_source_external_bid_key").on(table.sourceSystem, table.externalBidId)],
);

// attempt는 원천의 논리 입찰 식별자이고 revision은 각 정규화 해석을 보존하는 append-only 단위다.
export const auctionRevision = coreSchema.table(
  "auction_revision",
  {
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    normalizedRecordId: bigint("normalized_record_id", { mode: "bigint" })
      .notNull()
      .references(() => normalizedRecord.normalizedRecordId),
    observationId: bigint("observation_id", { mode: "bigint" })
      .notNull()
      .references(() => rawObservation.observationId),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    displayBidNo: text("display_bid_no"),
    sourceStatus: varchar("source_status", { length: 64 }).notNull(),
    title: text("title").notNull(),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }),
    plannedAmount: numeric("planned_amount", { precision: 18, scale: 2 }),
    // 소스가 표시한 하한율(`PLNPRCE_SUCBD_STD`) 관측 그대로다. 사정률 축의 상수라 예정가격으로
    // 번역한 실효하한과는 다른 값이며, 그 계산은 파생물이므로 core에 앉히지 않는다(ADR 0033 §4-가).
    // 계약이 소수 셋째 자리 고정이라 관측 정밀도를 잃지 않는 `numeric(6,3)`으로 받는다.
    floorRate: numeric("floor_rate", { precision: 6, scale: 3 }),
    currency: char("currency", { length: 3 }).notNull(),
    sourcePayload: jsonb("source_payload").notNull(),
  },
  (table) => [
    unique("auction_revision_normalized_record_key").on(table.normalizedRecordId),
    // 예정가격 0은 금액이 아니라 "추첨된 적 없음"이며 core에는 null로 앉는다. 관측 0은 source_payload가 보존한다
    // (EAT-199). 0을 열에 두면 `is not null` 조회가 그것을 금액으로 센다.
    check(
      "auction_revision_planned_amount_positive",
      sql`${table.plannedAmount} is null or ${table.plannedAmount} > 0`,
    ),
    // 명단·낙찰 행이 들고 있는 attempt가 revision의 attempt와 어긋나지 못하게 하는 복합 FK의 대상이다.
    unique("auction_revision_attempt_pair_key").on(table.auctionRevisionId, table.auctionAttemptId),
  ],
);

// 한 revision에 같은 조직도 서로 다른 업무 역할로 참여할 수 있어 role까지 관계의 grain에 포함한다.
export const auctionOrganization = coreSchema.table(
  "auction_organization",
  {
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionRevision.auctionRevisionId),
    organizationId: bigint("organization_id", { mode: "bigint" })
      .notNull()
      .references(() => organization.organizationId),
    role: varchar("role", { length: 32 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.auctionRevisionId, table.organizationId, table.role] })],
);

// 지역·자격 코드와 공고 조건 코드의 의미를 열로 늘리지 않고 허용된 role을 가진 다대다 관계로 보존한다.
// 낙찰 방식·예정가격 방식이 여기로 오는 이유는 둘 다 소스가 준 외부 코드이기 때문이다. 코드를 열로
// 펴면 새 코드가 생길 때마다 DDL이 움직이고 `(source_system, code_scheme, code)`가 끊긴다(AGENTS 2·6).
export const auctionRevisionCodeValue = coreSchema.table(
  "auction_revision_code_value",
  {
    auctionRevisionId: bigint("auction_revision_id", { mode: "bigint" })
      .notNull()
      .references(() => auctionRevision.auctionRevisionId),
    codeValueId: bigint("code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
    role: varchar("role", { length: 32 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.auctionRevisionId, table.codeValueId, table.role] }),
    // `item`은 품목 원자(`eatbid:auction-item`)다. 라벨 한 문자열이 원자 여러 행으로 투영되므로 한 revision에
    // 같은 role 행이 여럿 서며, PK가 (revision, code, role)이라 그 다중성이 허용된다(EAT-230).
    check(
      "auction_revision_code_value_role_allowed",
      sql`${table.role} in ('location_sido', 'location_sigungu', 'eligibility_area', 'award_method', 'planned_price_method', 'solo_bid_method', 'item')`,
    ),
  ],
);
