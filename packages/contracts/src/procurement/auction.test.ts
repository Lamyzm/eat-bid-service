import { describe, expect, test } from "bun:test";

describe("canonical auction contract", () => {
  test("accepts only canonical positive decimal path IDs", async () => {
    const contract = await import("./auction").catch(() => undefined);
    expect(contract, "procurement contract must exist").toBeDefined();
    expect(contract!.auctionIdPathSchema.parse("9007199254740993")).toBe("9007199254740993");
    for (const invalid of ["", "0", "+1", "-1", " 1", "1 ", "01", "1.0", "1e3", "auction-1"]) {
      expect(contract!.auctionIdPathSchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  test("bounds the public response and preserves bigint provenance without Number", async () => {
    const contract = await import("./auction").catch(() => undefined);
    expect(contract, "procurement contract must exist").toBeDefined();
    const response = {
      auctionId: "9007199254740993",
      revisionId: "9007199254740995",
      title: "Fresh produce supply",
      status: "OPEN",
      displayBidNumber: null,
      announcedAt: "2026-08-30T00:00:00.000Z",
      deadlineAt: null,
      openedAt: null,
      baseAmount: "1234567890.50",
      plannedAmount: null,
      currency: "KRW",
      provenance: {
        sourceSystem: "eat",
        externalBidId: "external-opaque-id",
        observationId: "9007199254740997",
        normalizedRecordId: "9007199254740999",
        contentSha256: "a".repeat(64),
      },
    };
    expect(contract!.auctionResponseSchema.parse(response)).toEqual(response);
    expect(contract!.auctionResponseSchema.safeParse({ ...response, sourcePayload: { secret: true } }).success)
      .toBe(false);
    expect(contract!.auctionOperations.find.path).toBe("/api/v1/auctions/{auctionId}");
    expect(contract!.auctionOperations.find.pathExample).toBe("9007199254740993");
  });
});
