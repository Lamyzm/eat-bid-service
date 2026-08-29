import {
  bigint,
  char,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { rawObservation } from "../ingest/evidence.js";
import { coreSchema } from "../namespaces.js";
import { organization } from "./organizations.js";

export const auctionAttempt = coreSchema.table(
  "auction_attempt",
  {
    auctionAttemptId: bigint("auction_attempt_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    sourceSystem: varchar("source_system", { length: 64 }).notNull(),
    externalBidId: text("external_bid_id").notNull(),
    displayBidNo: text("display_bid_no").notNull(),
  },
  (table) => [unique("auction_attempt_source_external_bid_key").on(table.sourceSystem, table.externalBidId)],
);

export const auctionRevision = coreSchema.table(
  "auction_revision",
  {
    auctionRevisionId: bigint("auction_revision_id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    auctionAttemptId: bigint("auction_attempt_id", { mode: "number" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    observationId: bigint("observation_id", { mode: "number" })
      .notNull()
      .references(() => rawObservation.observationId),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    sourceStatus: varchar("source_status", { length: 64 }).notNull(),
    title: text("title").notNull(),
    announcedAt: timestamp("announced_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }),
    plannedAmount: numeric("planned_amount", { precision: 18, scale: 2 }),
    currency: char("currency", { length: 3 }),
    sourcePayload: jsonb("source_payload").notNull(),
  },
  (table) => [unique("auction_revision_attempt_content_key").on(table.auctionAttemptId, table.contentSha256)],
);

export const auctionOrganization = coreSchema.table(
  "auction_organization",
  {
    auctionAttemptId: bigint("auction_attempt_id", { mode: "number" })
      .notNull()
      .references(() => auctionAttempt.auctionAttemptId),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organization.organizationId),
    role: varchar("role", { length: 32 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.auctionAttemptId, table.organizationId, table.role] })],
);
