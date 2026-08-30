import { describe, expect, test } from "bun:test";

describe("검증 범위를 정의한다 — AuctionId", () => {
  test("상태를 검증한다 — is an opaque positive bigint and serializes without Number", async () => {
    const domain = await import("./auction-id").catch(() => undefined);
    expect(domain, "AuctionId domain value must exist").toBeDefined();
    const value = domain!.auctionId(9_007_199_254_740_993n);
    expect(value).toBe(9_007_199_254_740_993n);
    expect(domain!.auctionIdToString(value)).toBe("9007199254740993");
    expect(domain!.auctionId(9_223_372_036_854_775_807n)).toBe(9_223_372_036_854_775_807n);
    expect(() => domain!.auctionId(0n)).toThrow("positive");
    expect(() => domain!.auctionId(-1n)).toThrow("positive");
    expect(() => domain!.auctionId(9_223_372_036_854_775_808n)).toThrow("signed bigint");
  });
});
