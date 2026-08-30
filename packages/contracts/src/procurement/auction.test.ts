import { describe, expect, test } from "bun:test";

describe("canonical auction contract", () => {
  test("accepts only canonical positive decimal path IDs", async () => {
    const contract = await import("./auction").catch(() => undefined);
    expect(contract, "procurement contract must exist").toBeDefined();
    expect(contract!.auctionIdPathSchema.parse("9007199254740993")).toBe("9007199254740993");
    expect(contract!.auctionIdPathSchema.parse("9223372036854775807")).toBe("9223372036854775807");
    for (const invalid of [
      "", "0", "+1", "-1", " 1", "1 ", "01", "1.0", "1e3", "auction-1",
      "9223372036854775808",
    ]) {
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

  test("accepts each public string maximum and rejects every one-over value", async () => {
    const contract = await import("./auction").catch(() => undefined);
    expect(contract, "procurement contract must exist").toBeDefined();
    const maximum = {
      auctionId: "9223372036854775807",
      revisionId: "9223372036854775807",
      title: "t".repeat(512),
      status: "s".repeat(64),
      displayBidNumber: "d".repeat(128),
      announcedAt: "2026-08-30T00:00:00.12345678901234Z",
      deadlineAt: null,
      openedAt: null,
      baseAmount: "9999999999999999.99",
      plannedAmount: "0.00",
      currency: "KRW",
      provenance: {
        sourceSystem: "s".repeat(64),
        externalBidId: "e".repeat(512),
        observationId: "9223372036854775807",
        normalizedRecordId: "9223372036854775807",
        contentSha256: "a".repeat(64),
      },
    };
    expect(contract!.auctionResponseSchema.parse(maximum)).toEqual(maximum);

    const oneOver = [
      { ...maximum, auctionId: "9223372036854775808" },
      { ...maximum, revisionId: "9223372036854775808" },
      { ...maximum, title: "t".repeat(513) },
      { ...maximum, status: "s".repeat(65) },
      { ...maximum, displayBidNumber: "d".repeat(129) },
      { ...maximum, announcedAt: "2026-08-30T00:00:00.123456789012345Z" },
      { ...maximum, baseAmount: "10000000000000000.00" },
      { ...maximum, plannedAmount: "1.000" },
      { ...maximum, provenance: { ...maximum.provenance, sourceSystem: "s".repeat(65) } },
      { ...maximum, provenance: { ...maximum.provenance, externalBidId: "e".repeat(513) } },
      { ...maximum, provenance: { ...maximum.provenance, observationId: "9223372036854775808" } },
      { ...maximum, provenance: { ...maximum.provenance, normalizedRecordId: "9223372036854775808" } },
    ];
    for (const candidate of oneOver) {
      expect(contract!.auctionResponseSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
