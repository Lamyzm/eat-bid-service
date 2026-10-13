import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { baseRelativeBidRate, bidRate, canonicalDecimal, Temporal } from "@eatbid/domain";

import { DrizzleAccountRepository, type AccountDatabase } from "../modules/account/infrastructure/drizzle/drizzle-account-repository";
import { DrizzleBidDisplayLedger, type BidDisplayLedgerDatabase } from "../modules/procurement/infrastructure/drizzle/drizzle-bid-display-ledger";
import { DrizzleBidReviewReader } from "../modules/procurement/infrastructure/drizzle/drizzle-bid-review-reader";
import { createUnitOfWork } from "../platform/database/unit-of-work";
import { disposableDatabase } from "../../fixtures/disposable-database.fixture";
import { ACTIVE_BUILD_ID, MY_SUPPLIER_PARTY_ID, seedOwnBid } from "../../fixtures/own-bid.fixture";

// 내 투찰 표본 위에 8101 회차를 개찰·예정가격·낙찰이 있는 회차로 바꾼다. build가 활성이 되면 trigger가 행 쓰기를 막아 그 전에 고친다.
const reviewDatabase = disposableDatabase({
  task: "eat341-bid-review",
  migrationApplyCount: 1,
  seed: (owner) => seedOwnBid(owner, {
    beforeActivation: async (client) => {
      await client.unsafe(`
        update mart.org_round_summary
           set opened_at = '2026-09-05T05:00:00Z', planned_amount = 990000.00, item_label = '농산물',
               winner_supplier_party_id = 7702
         where build_id = ${ACTIVE_BUILD_ID} and auction_attempt_id = 8101
      `);
    },
  }),
});

describe("복기 조회 SQL", () => {
  test("내 업체 투찰에서 출발해 활성 build의 최신 revision 회차만 달로 세고, 명단의 다른 업체·내 투찰·낙찰 업체 투찰률을 함께 읽는다", async () => {
    await reviewDatabase.withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const snapshot = createUnitOfWork({
        transaction: (work) => database.transaction((transaction) => work(transaction), { isolationLevel: "repeatable read", accessMode: "read only" }),
      });
      const reader = new DrizzleBidReviewReader();
      const parties = [MY_SUPPLIER_PARTY_ID];

      const months = await snapshot.run((handle) => reader.listMonths(handle, { supplierPartyIds: parties }));
      // 개찰 시각이 있는 회차는 8101 하나다. 같은 회차의 새 해석(9111)에는 내 줄이 없지만 활성 build가 9101을 고정했다.
      expect(months).toEqual([{ month: "2026-09", rounds: 1, bids: 2, wins: 0 }]);

      const rounds = await snapshot.run((handle) => reader.findRounds(handle, {
        supplierPartyIds: parties,
        openedFrom: Temporal.Instant.from("2026-08-31T15:00:00Z"),
        openedBefore: Temporal.Instant.from("2026-09-30T15:00:00Z"),
      }));
      expect(rounds).toHaveLength(1);
      const [round] = rounds;
      expect(round).toMatchObject({
        auctionAttemptId: 8101n,
        title: "농산물 구매",
        itemLabel: "농산물",
        baseAmount: "500000.00",
        plannedAmount: "990000.00",
        floorRate: "90.000",
        bidderCount: 3,
        competitorRates: ["89.002"],
        award: { supplierPartyId: 7702n, rate: "89.002" },
      });
      // 실격 투찰의 금액 열은 자리표시자라 쓰지 않고 투찰률로 읽는다. 투찰률 순서다.
      expect(round!.own.map((bid) => [bid.supplierPartyId, bid.rate])).toEqual([[MY_SUPPLIER_PARTY_ID, "89.001"], [MY_SUPPLIER_PARTY_ID, "101.975"]]);
      expect(round!.openedAt.toString()).toBe("2026-09-05T05:00:00Z");
    });
  });

  test("장부는 워크스페이스와 공고로 골라 내보낸 순서대로 읽는다", async () => {
    await reviewDatabase.withDatabase(async ({ api }) => {
      const database = drizzle({ client: api });
      const account = new DrizzleAccountRepository(database as unknown as AccountDatabase);
      const { workspace } = await account.initializeAccount({ subject: "review-1", workspaceName: "내 워크스페이스" });
      const ledger = new DrizzleBidDisplayLedger(database as unknown as BidDisplayLedgerDatabase);
      const rate = (value: string) => baseRelativeBidRate(canonicalDecimal(value, 4));
      await ledger.record({
        workspaceId: workspace.workspaceId,
        servedAt: Temporal.Instant.from("2026-09-04T12:00:00Z"),
        entries: [{
          auctionAttemptId: 8101n, method: "market-pick", methodVersion: "2026-09-01", floorRate: bidRate(canonicalDecimal("90.000", 3)),
          baseRelativeRates: [rate("88.6410"), rate("89.0280")], singleBaseRelativeRate: rate("88.6410"),
          basisPeriod: "2026-06~2026-08", basisObservedThrough: null, basisCount: 164,
        }],
      });
      const snapshot = createUnitOfWork({ transaction: (work) => database.transaction((transaction) => work(transaction)) });
      const rows = await snapshot.run((handle) => new DrizzleBidReviewReader().findLedger(handle, {
        workspaceId: workspace.workspaceId,
        auctionAttemptIds: [8101n, 8102n],
      }));
      expect(rows).toEqual([{
        auctionAttemptId: 8101n,
        method: "market-pick",
        methodVersion: "2026-09-01",
        floorRate: "90.000",
        baseRelativeRates: ["88.6410", "89.0280"],
        firstServedAt: Temporal.Instant.from("2026-09-04T12:00:00Z"),
      }]);
    });
  });
});
