import { describe, expect, test } from "bun:test";
import { auctionV1Operations, healthOperations } from "@eatbid/contracts";

describe("canonical OpenAPI 산출물", () => {
  test("고유하고 안정적인 operation과 전체 route를 가진 결정적 OpenAPI 3.0.3을 만든다", async () => {
    const module = await import("./openapi").catch(() => undefined);
    expect(module, "OpenAPI boundary must exist").toBeDefined();
    const first = module!.serializeOpenApi(module!.createOpenApiDocument());
    const second = module!.serializeOpenApi(module!.createOpenApiDocument());
    expect(first).toBe(second);
    const document = JSON.parse(first) as any;
    expect(document.openapi).toBe("3.0.3");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/api/v1/auctions/{auctionId}",
      "/health/live",
      "/health/ready",
    ]);
    const operations = Object.values(document.paths).flatMap((path: any) => Object.values(path)) as any[];
    const operationIds = operations.map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.sort()).toEqual(["findAuction", "healthLive", "healthReady"]);
    for (const operation of operations) {
      expect(operation.responses["200"].content["application/json"].schema).toBeDefined();
      expect(Object.values(operation.responses).some((response: any) =>
        response.content?.["application/problem+json"]?.schema)).toBe(true);
    }
    expect(() => module!.assertOperationPath({
      ...healthOperations.live,
      path: "/health/drift",
    })).toThrow("Operation path drift");
    const auction = document.paths[auctionV1Operations.find.path].get;
    expect(auction.parameters[0]).toMatchObject({
      name: "auctionId",
      in: "path",
      required: true,
      schema: { $ref: "#/components/schemas/AuctionId" },
    });
    expect(document.components.schemas.AuctionId).toMatchObject({
      type: "string",
      maxLength: 19,
      example: "9223372036854775807",
    });
    expect(document.components.schemas.AuctionId.description)
      .toContain("maximum 9223372036854775807");
    expect(document.components.schemas.AuctionId.description)
      .toContain("9223372036854775808 is rejected");
    expect(document.components.schemas.PositiveBigintText).toMatchObject({
      type: "string",
      maxLength: 19,
      example: "9223372036854775807",
    });
    expect(document.components.schemas.PositiveBigintText.description)
      .toContain("maximum 9223372036854775807");
    expect(document.components.schemas.PositiveBigintText.description)
      .toContain("9223372036854775808 is rejected");
    expect(auction.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/EatbidApiV1Auction",
    });
    expect(document.components.schemas.EatbidApiV1Auction.properties).toMatchObject({
      identity: { $ref: "#/components/schemas/PublicAuctionIdentity" },
      schedule: { $ref: "#/components/schemas/AuctionSchedule" },
      pricing: { $ref: "#/components/schemas/AuctionPricing" },
      provenance: { $ref: "#/components/schemas/AuctionProvenance" },
    });
    expect(document.components.schemas.PublicAuctionIdentity.properties).toMatchObject({
      auctionId: { $ref: "#/components/schemas/PositiveBigintText" },
      revisionId: { $ref: "#/components/schemas/PositiveBigintText" },
    });
    expect(document.components.schemas.AuctionProvenance.properties).toMatchObject({
      observationId: { $ref: "#/components/schemas/PositiveBigintText" },
      normalizedRecordId: { $ref: "#/components/schemas/PositiveBigintText" },
    });
    expect(document.components.schemas.InstantText.example).toBe("2026-08-30T00:00:00Z");
    expect(document.components.schemas.AuctionPricing.example).toEqual({
      baseAmount: { amount: "123456789.00", currency: "KRW" },
      plannedAmount: null,
    });
    expect(auction.responses["404"].content["application/problem+json"].schema).toBeDefined();
    expect(auction.responses["503"].content["application/problem+json"].schema).toBeDefined();
  });
});
