import { describe, expect, test } from "bun:test";
import { isMoney, Temporal } from "@eatbid/domain";

describe("DrizzleAuctionReader row 경계", () => {
  test("전체 database row를 application 값으로 매핑하고 내부 payload는 버린다", async () => {
    const adapter = await import("./drizzle-auction-reader").catch(() => undefined);
    expect(adapter, "Drizzle auction adapter must exist").toBeDefined();
    const record = adapter!.mapAuctionRow({
      auction_id: "9007199254740993",
      revision_id: "9007199254740995",
      title: "Fresh produce supply",
      source_status: "OPEN",
      display_bid_no: null,
      announced_at: "2026-08-30T00:00:00.123456789Z",
      deadline_at: new Date("2026-08-30T01:00:00.000Z"),
      opened_at: null,
      base_amount: "1234567890.50",
      planned_amount: null,
      currency: "KRW",
      source_system: "eat",
      external_bid_id: "external-opaque-id",
      observation_id: "9007199254740997",
      normalized_record_id: "9007199254740999",
      content_sha256: "a".repeat(64),
      source_payload: { mustNotEscape: true },
    } as never);
    expect(record).toMatchObject({
      auctionId: 9_007_199_254_740_993n,
      revisionId: 9_007_199_254_740_995n,
      title: "Fresh produce supply",
      status: "OPEN",
      displayBidNumber: null,
      openedAt: null,
      baseAmount: { amount: "1234567890.50", currency: "KRW" },
      plannedAmount: null,
      provenance: {
        sourceSystem: "eat",
        externalBidId: "external-opaque-id",
        observationId: 9_007_199_254_740_997n,
        normalizedRecordId: 9_007_199_254_740_999n,
        contentSha256: "a".repeat(64),
      },
    });
    expect(record.announcedAt).toBeInstanceOf(Temporal.Instant);
    expect(record.announcedAt.toString()).toBe("2026-08-30T00:00:00.123456789Z");
    expect(record.deadlineAt?.toString()).toBe("2026-08-30T01:00:00Z");
    expect(isMoney(record.baseAmount)).toBe(true);
  });
});
