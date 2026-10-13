import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { baseRelativeBidRate, bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";

import {
  DrizzleAccountRepository,
  type AccountDatabase,
} from "../modules/account/infrastructure/drizzle/drizzle-account-repository";
import type { BidDisplayEntry } from "../modules/procurement/application/bid-display-ledger";
import {
  DrizzleBidDisplayLedger,
  type BidDisplayLedgerDatabase,
} from "../modules/procurement/infrastructure/drizzle/drizzle-bid-display-ledger";
import { withAccountDatabase } from "../../fixtures/account.fixture";

const rate = (value: string) => baseRelativeBidRate(canonicalDecimal(value, 4));

const market = (first: string, second: string): BidDisplayEntry => ({
  auctionAttemptId: 501n,
  method: "market-pick",
  methodVersion: "2026-10-10",
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  baseRelativeRates: [rate(first), rate(second)],
  singleBaseRelativeRate: rate(first),
  basisPeriod: "2026-07~2026-09",
  basisObservedThrough: null,
  basisCount: 164,
});

const habit: BidDisplayEntry = {
  auctionAttemptId: 501n,
  method: "morning-habit",
  methodVersion: "2026-10-11",
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  baseRelativeRates: [rate("88.6680")],
  singleBaseRelativeRate: rate("88.6680"),
  basisPeriod: null,
  basisObservedThrough: Temporal.Instant.from("2026-10-14T00:30:00Z"),
  basisCount: 5,
};

describe("화면 장부 저장", () => {
  test("같은 공고·방법·판·금액을 다시 내보내면 줄을 늘리지 않고 마지막 시각과 횟수만 고친다 — API 역할로 쓴다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const account = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const { workspace } = await account.initializeAccount({ subject: "ledger-1", workspaceName: "내 워크스페이스" });
      await owner.unsafe(`
        insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
        overriding system value values (501, 'eat', 'external-501')
      `);
      const ledger = new DrizzleBidDisplayLedger(drizzle({ client: api }) as unknown as BidDisplayLedgerDatabase);
      const first = Temporal.Instant.from("2026-10-14T01:00:00Z");
      const later = Temporal.Instant.from("2026-10-14T01:20:00Z");

      await ledger.record({ workspaceId: workspace.workspaceId, servedAt: first, entries: [market("88.6410", "89.0280"), habit] });
      // 같은 응답 안에서 같은 항목이 두 번 와도 한 번만 쓴다.
      await ledger.record({ workspaceId: workspace.workspaceId, servedAt: later, entries: [market("88.6410", "89.0280"), market("88.6410", "89.0280")] });
      // 금액이 바뀌면 새 줄이다.
      await ledger.record({ workspaceId: workspace.workspaceId, servedAt: later, entries: [market("88.7310", "89.0280")] });

      const rows = await owner.unsafe(`
        select method, first_base_relative_rate::text as first, second_base_relative_rate::text as second,
               single_base_relative_rate::text as single, basis_period, basis_count, served_count,
               to_char(first_served_at at time zone 'UTC', 'HH24:MI') as first_at,
               to_char(last_served_at at time zone 'UTC', 'HH24:MI') as last_at
          from app.bid_display_record
         order by method, first_base_relative_rate
      `);
      expect(rows.map((row) => ({ ...row }))).toEqual([
        { method: "market-pick", first: "88.6410", second: "89.0280", single: "88.6410", basis_period: "2026-07~2026-09", basis_count: 164, served_count: 2, first_at: "01:00", last_at: "01:20" },
        { method: "market-pick", first: "88.7310", second: "89.0280", single: "88.7310", basis_period: "2026-07~2026-09", basis_count: 164, served_count: 1, first_at: "01:20", last_at: "01:20" },
        { method: "morning-habit", first: "88.6680", second: null, single: "88.6680", basis_period: null, basis_count: 5, served_count: 1, first_at: "01:00", last_at: "01:00" },
      ]);
    });
  });
});
