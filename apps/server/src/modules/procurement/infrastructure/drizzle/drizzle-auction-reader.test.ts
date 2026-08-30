import { describe, expect, test } from "bun:test";

describe("검증 범위를 정의한다 — DrizzleAuctionReader row boundary", () => {
  test("매핑 결과를 검증한다 — maps a complete database row into application values and drops internal payload", async () => {
    const adapter = await import("./drizzle-auction-reader").catch(() => undefined);
    expect(adapter, "Drizzle auction adapter must exist").toBeDefined();
    expect(adapter!.mapAuctionRow({
      auction_id: "9007199254740993",
      revision_id: "9007199254740995",
      title: "Fresh produce supply",
      source_status: "OPEN",
      display_bid_no: null,
      announced_at: new Date("2026-08-30T00:00:00.000Z"),
      deadline_at: null,
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
    } as never)).toEqual({
      auctionId: 9_007_199_254_740_993n,
      revisionId: 9_007_199_254_740_995n,
      title: "Fresh produce supply",
      status: "OPEN",
      displayBidNumber: null,
      announcedAt: new Date("2026-08-30T00:00:00.000Z"),
      deadlineAt: null,
      openedAt: null,
      baseAmount: "1234567890.50",
      plannedAmount: null,
      currency: "KRW",
      provenance: {
        sourceSystem: "eat",
        externalBidId: "external-opaque-id",
        observationId: 9_007_199_254_740_997n,
        normalizedRecordId: 9_007_199_254_740_999n,
        contentSha256: "a".repeat(64),
      },
    });
  });
});
