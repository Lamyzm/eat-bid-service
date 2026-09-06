import { describe, expect, test } from "bun:test";
import { z } from "zod";

describe("공개 공고 V1 응답 계약", () => {
  test("중첩 resource를 허용하고 내부 source payload는 거부한다", async () => {
    const contract = await import("./get-auction.response").catch(() => undefined);
    expect(contract, "중첩 공개 응답 계약이 존재해야 한다").toBeDefined();

    const response = {
      identity: {
        auctionId: "9007199254740993",
        revisionId: "9007199254740995",
        externalBidId: "opaque",
        displayBidNumber: null,
        title: "급식 식재료",
        status: "OPEN",
      },
      organization: { organizationId: "3101", name: "창원 남산초등학교", type: "school" },
      schedule: {
        announcedAt: "2026-08-30T00:00:00Z",
        deadlineAt: null,
        openedAt: null,
      },
      pricing: {
        baseAmount: { amount: "1234567890.50", currency: "KRW" },
        plannedAmount: null,
      },
      provenance: {
        sourceSystem: "eat",
        observationId: "9007199254740997",
        normalizedRecordId: "9007199254740999",
        contentSha256: "a".repeat(64),
      },
      terms: null,
      location: null,
      classification: null,
    };

    expect(contract!.auctionV1ResponseSchema.parse(response)).toEqual(response);
    expect(contract!.auctionV1ResponseSchema.safeParse({ ...response, sourcePayload: {} }).success).toBe(false);
    expect(contract!.auctionV1ResponseSchema.safeParse({
      auctionId: "9007199254740993",
      revisionId: "9007199254740995",
    }).success).toBe(false);
  });

  test("하한율·낙찰방식·소재지·품목 라벨을 코드 참조로 싣고 관측되지 않은 블록은 null로 남긴다", async () => {
    const { auctionV1ResponseSchema } = await import("./get-auction.response");

    const base = {
      identity: {
        auctionId: "9007199254740993",
        revisionId: "9007199254740995",
        externalBidId: "opaque",
        displayBidNumber: null,
        title: "급식 식재료",
        status: "OPEN",
      },
      organization: { organizationId: "3101", name: "창원 남산초등학교", type: "school" },
      schedule: { announcedAt: "2026-08-30T00:00:00Z", deadlineAt: null, openedAt: null },
      pricing: { baseAmount: { amount: "1234567890.50", currency: "KRW" }, plannedAmount: null },
      provenance: {
        sourceSystem: "eat",
        observationId: "9007199254740997",
        normalizedRecordId: "9007199254740999",
        contentSha256: "a".repeat(64),
      },
    };

    const observed = {
      ...base,
      terms: {
        floorRate: { value: "90.000", unit: "percentage-points" },
        awardMethod: { codeValueId: "31", code: "003", scheme: "eat:award-method", label: "최저가" },
      },
      location: {
        sido: { codeValueId: "41", code: "48", scheme: "eat:auction-location-sido", label: null },
        sigungu: { codeValueId: "43", code: "48120", scheme: "eat:auction-location-sigungu", label: null },
      },
      classification: { itemLabel: "축산" },
    };
    expect(auctionV1ResponseSchema.parse(observed)).toEqual(observed);

    // 코드 참조의 정체성은 숫자 id다. 문자열 코드만 실어 오는 형태는 계약이 받지 않는다(AGENTS 2).
    expect(auctionV1ResponseSchema.safeParse({
      ...observed,
      terms: { floorRate: null, awardMethod: { code: "003", scheme: "eat:award-method", label: null } },
    }).success).toBe(false);
    // 하한율은 0~100으로 닫힌 사정률 축 상수다. 관측 상한 없는 축을 여기에 실으면 축이 섞인다.
    expect(auctionV1ResponseSchema.safeParse({
      ...observed,
      terms: { ...observed.terms, floorRate: { value: "100.001", unit: "percentage-points" } },
    }).success).toBe(false);
    expect(auctionV1ResponseSchema.safeParse({
      ...observed,
      classification: { itemLabel: "축산", itemCodeValueId: "7" },
    }).success).toBe(false);
    expect(auctionV1ResponseSchema.safeParse({
      ...observed,
      location: { sido: observed.location.sido },
    }).success).toBe(false);
  });

  test("UTC instant와 rate 및 좌표의 canonical 경계를 엄격히 지킨다", async () => {
    const [{ instantTextSchema }, { percentagePointsWireSchema, ratioWireSchema }, { coordinateWireSchema }] =
      await Promise.all([
        import("../../../atoms/instant"),
        import("../../../values/rate"),
        import("../../../values/coordinate"),
      ]);

    expect(instantTextSchema.parse("2026-08-30T00:00:00.000000001Z"))
      .toBe("2026-08-30T00:00:00.000000001Z");
    for (const invalid of [
      "2026-08-30T00:00:00+09:00",
      "2026-08-30T00:00:00.000Z",
      "2026-08-30T00:00:00.0000000001Z",
    ]) {
      expect(instantTextSchema.safeParse(invalid).success, invalid).toBe(false);
    }

    expect(percentagePointsWireSchema.parse({ value: "100.000000", unit: "percentage-points" }))
      .toEqual({ value: "100.000000", unit: "percentage-points" });
    expect(percentagePointsWireSchema.safeParse({ value: "100.000001", unit: "percentage-points" }).success)
      .toBe(false);
    expect(ratioWireSchema.safeParse({ value: "1.000001", unit: "ratio" }).success).toBe(false);

    const coordinate = { latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326" } as const;
    expect(coordinateWireSchema.parse(coordinate)).toEqual(coordinate);
    for (const invalid of [
      { ...coordinate, latitude: Number.NaN },
      { ...coordinate, latitude: 90.000001 },
      { ...coordinate, longitude: 180.000001 },
      { ...coordinate, inferredOrganizationId: "1" },
    ]) {
      expect(coordinateWireSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("codec은 domain factory를 거쳐 exact money와 Temporal Instant를 왕복한다", async () => {
    const [{ moneyCodec }, { instantCodec }] = await Promise.all([
      import("../../../codecs/money"),
      import("../../../codecs/temporal"),
    ]);

    const moneyWire = { amount: "1234567890.50", currency: "KRW" } as const;
    const money = z.decode(moneyCodec, moneyWire);
    expect(money).toEqual(moneyWire);
    expect(z.encode(moneyCodec, money)).toEqual(moneyWire);

    const instant = z.decode(instantCodec, "2026-08-30T00:00:00.000000001Z");
    expect(instant.toString()).toBe("2026-08-30T00:00:00.000000001Z");
    expect(z.encode(instantCodec, instant)).toBe("2026-08-30T00:00:00.000000001Z");
  });

  test("codec encode는 domain 및 wire 불변식 밖의 값을 통제된 Zod 오류로 거부한다", async () => {
    const [{ moneyCodec }, { instantCodec }, { Temporal }] = await Promise.all([
      import("../../../codecs/money"),
      import("../../../codecs/temporal"),
      import("@eatbid/domain"),
    ]);

    for (const invalid of [
      null,
      { amount: "1.0", currency: "KRW" },
      { amount: "1.00", currency: "USD" },
    ]) {
      expect(() => z.encode(moneyCodec, invalid as never)).toThrow(z.ZodError);
    }

    const extendedYear = Temporal.Instant.from("+010000-01-01T00:00:00Z");
    expect(instantCodec.out.safeParse(extendedYear).success).toBe(false);
    expect(() => z.encode(instantCodec, extendedYear)).toThrow(z.ZodError);

    const ordinary = Temporal.Instant.from("2026-08-30T00:00:00Z");
    expect(instantCodec.out.safeParse(ordinary).success).toBe(true);
    expect(z.encode(instantCodec, ordinary)).toBe("2026-08-30T00:00:00Z");
  });

  test("V1 조회 operation은 중첩 응답 schema를 공개한다", async () => {
    const [{ auctionV1Operations }, { auctionV1ResponseSchema }] = await Promise.all([
      import("./operations"),
      import("./get-auction.response"),
    ]);

    expect(auctionV1Operations.find).toMatchObject({
      method: "get",
      path: "/api/v1/auctions/{auctionId}",
      operationId: "findAuction",
    });
    expect(auctionV1Operations.find.successResponses[200]?.schema).toBe(auctionV1ResponseSchema);
  });

  test("공개 pricing metadata는 OpenAPI 소비자가 exact Money 예시를 볼 수 있게 한다", async () => {
    const { auctionPricingSchema } = await import("../../../resources/procurement/pricing");

    expect(auctionPricingSchema.meta()).toMatchObject({
      id: "AuctionPricing",
      example: {
        baseAmount: { amount: "123456789.00", currency: "KRW" },
        plannedAmount: null,
      },
    });
  });
});
