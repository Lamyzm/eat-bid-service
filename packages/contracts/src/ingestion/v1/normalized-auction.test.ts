import { describe, expect, test } from "bun:test";

const fixtureUrl = new URL("../../../fixtures/ingestion-v1/normalized-auction.json", import.meta.url);

describe("eaT 정규화 공고 V1 수집 계약", () => {
  test("모든 중첩 필드를 검증하고 선행 0이 있는 source code를 그대로 보존한다", async () => {
    const contract = await import("./normalized-auction").catch(() => undefined);
    expect(contract, "V1 수집 계약이 존재해야 한다").toBeDefined();

    const fixture = await Bun.file(fixtureUrl).json();
    const parsed = contract!.normalizedAuctionV1Schema.parse(fixture);

    expect(parsed).toEqual(fixture);
    expect(parsed.buyer.organizationCode).toBe("00001234");
    expect(parsed.location.sidoCode).toBe("01");
    expect(parsed.location.sigunguCode).toBeNull();
    expect(parsed.location.eligibilityCodes).toEqual(["001", "01002"]);
    expect(parsed.identity.displayBidNumber).toBeNull();
    expect(parsed.schedule.openedAt).toBeNull();
    expect(parsed.pricing.plannedAmount).toBeNull();
  });

  test("root와 각 resource의 알려지지 않은 필드를 거부한다", async () => {
    const { normalizedAuctionV1Schema } = await import("./normalized-auction");
    const fixture = await Bun.file(fixtureUrl).json();

    const candidates = [
      { ...fixture, rawPayload: {} },
      { ...fixture, identity: { ...fixture.identity, auctionId: "1" } },
      { ...fixture, buyer: { ...fixture.buyer, internalOrganizationId: "1" } },
      { ...fixture, location: { ...fixture.location, inferredAddress: "서울" } },
      { ...fixture, schedule: { ...fixture.schedule, sourceTimezone: "Asia/Seoul" } },
      { ...fixture, pricing: { ...fixture.pricing, currency: "KRW" } },
      { ...fixture, classification: { ...fixture.classification, confidence: 1 } },
    ];

    for (const candidate of candidates) {
      expect(normalizedAuctionV1Schema.safeParse(candidate).success).toBe(false);
    }
  });

  test("nullable 시각과 금액은 허용하되 비정규 UTC 및 KRW 표현은 거부한다", async () => {
    const { normalizedAuctionV1Schema } = await import("./normalized-auction");
    const fixture = await Bun.file(fixtureUrl).json();

    const allNullable = {
      ...fixture,
      identity: { ...fixture.identity, displayBidNumber: null },
      location: { ...fixture.location, sidoCode: null, sigunguCode: null },
      schedule: { announcedAt: null, deadlineAt: null, openedAt: null },
      pricing: { baseAmount: null, plannedAmount: null },
      classification: { sourceCategoryLabel: null, categorySource: "unknown" },
    };
    expect(normalizedAuctionV1Schema.parse(allNullable)).toEqual(allNullable);

    const invalid = [
      { ...fixture, contractVersion: "eatbid.ingestion.auction.v2" },
      { ...fixture, schedule: { ...fixture.schedule, announcedAt: "2026-08-30T09:00:00+09:00" } },
      { ...fixture, pricing: { ...fixture.pricing, baseAmount: { amount: "1000.0", currency: "KRW" } } },
      { ...fixture, pricing: { ...fixture.pricing, baseAmount: { amount: "1000.00", currency: "USD" } } },
      { ...fixture, classification: { ...fixture.classification, categorySource: "guessed" } },
    ];
    for (const candidate of invalid) {
      expect(normalizedAuctionV1Schema.safeParse(candidate).success).toBe(false);
    }
  });
});
