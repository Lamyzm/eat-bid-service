import { describe, expect, test } from "bun:test";
import {
  auctionV1Operations,
  organizationV1Operations,
  publicHttpOperationRegistry,
  winRateDistributionV1Operations,
} from "@eatbid/contracts";

function openApiStringSchemaAccepts(
  schema: { type?: string; minLength?: number; maxLength?: number; pattern?: string },
  value: string,
): boolean {
  return schema.type === "string"
    && (schema.minLength === undefined || value.length >= schema.minLength)
    && (schema.maxLength === undefined || value.length <= schema.maxLength)
    && (schema.pattern === undefined || new RegExp(schema.pattern, "u").test(value));
}

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
      "/api/v1/auctions",
      "/api/v1/auctions/{auctionId}",
      "/api/v1/auctions/{auctionId}/roster",
      // listCodes는 EAT-57이 계약을 소유하고 Nest handler는 아직 없다. registry가 OpenAPI의 단일
      // 출처이므로 계약이 열린 사실이 여기 그대로 드러나야 하고, 구현이 붙는 변경에서 handler와
      // e2e가 같이 온다.
      "/api/v1/code-schemes/{scheme}/codes",
      "/api/v1/organizations/{organizationId}/auction-attempts",
      "/api/v1/win-rate-distribution",
      "/health/live",
      "/health/ready",
    ]);
    const operations = Object.values(document.paths).flatMap((path: any) => Object.values(path)) as any[];
    const operationIds = operations.map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.sort())
      .toEqual([
        "findAuction",
        "findWinRateDistribution",
        "getAuctionRoster",
        "healthLive",
        "healthReady",
        "listCodes",
        "listOpenAuctions",
        "listOrganizationAuctionAttempts",
      ]);
    for (const operation of operations) {
      expect(operation.responses["200"].content["application/json"].schema).toBeDefined();
      expect(Object.values(operation.responses).some((response: any) =>
        response.content?.["application/problem+json"]?.schema)).toBe(true);
    }
    for (const operation of publicHttpOperationRegistry) {
      expect(document.paths[operation.openApiPath][operation.method].operationId)
        .toBe(operation.operationId);
    }
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
      organization: { allOf: [{ $ref: "#/components/schemas/AuctionOrganization" }], nullable: true },
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

  test("낙찰률 분포 operation의 코호트 query parameter와 사정률 축 schema를 계약에서 파생한다", async () => {
    const module = await import("./openapi");
    const document = module.createOpenApiDocument() as any;
    const distribution = document.paths[winRateDistributionV1Operations.find.path].get;
    expect(distribution.operationId).toBe("findWinRateDistribution");
    // `.check()`를 붙여도 query가 ZodObject로 남아야 parameter가 생긴다. union이면 조용히 0개가 된다.
    expect(distribution.parameters.map((parameter: any) => [parameter.name, parameter.required ?? false]))
      .toEqual([
        ["scope", true],
        ["regionCodeValueId", false],
        ["organizationId", false],
        ["floorRate", true],
        ["awardMethod", true],
        ["from", false],
        ["to", false],
        ["binWidth", false],
        ["granularity", false],
      ]);
    expect(distribution.parameters[7].schema).toMatchObject({ default: "0.010" });
    expect(distribution.parameters[8].schema).toMatchObject({ enum: ["total", "month"], default: "total" });
    expect(distribution.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/EatbidApiV1WinRateDistribution",
    });
    // 칸 경계는 100을 넘는 관측을 담는 축이고 하한율·칸 폭은 0~100으로 닫힌 축이다(AGENTS 15).
    expect(document.components.schemas.WinRateDistributionBin.properties.from)
      .toEqual({ $ref: "#/components/schemas/ObservedBidRate" });
    expect(document.components.schemas.WinRateDistributionMeta.properties.floorRate)
      .toEqual({ $ref: "#/components/schemas/BidRate" });
    expect(document.components.schemas.WinRateDistributionModeRange.properties.share)
      .toEqual({ $ref: "#/components/schemas/Ratio" });
    expect(document.components.schemas.KstMonthText).toMatchObject({ type: "string", maxLength: 7 });
  });

  test("기관 회차 이력 operation의 path·query parameter와 응답 schema를 계약에서 파생한다", async () => {
    const module = await import("./openapi");
    const document = module.createOpenApiDocument() as any;
    const attempts = document.paths[organizationV1Operations.listAuctionAttempts.path].get;
    expect(attempts.operationId).toBe("listOrganizationAuctionAttempts");
    expect(attempts.parameters.map((parameter: any) => [parameter.in, parameter.name, parameter.required ?? false]))
      .toEqual([
        ["path", "organizationId", true],
        ["query", "item", false],
        ["query", "cursor", false],
        ["query", "limit", false],
        ["query", "opened", false],
      ]);
    expect(attempts.parameters[3].schema).toMatchObject({ type: "integer", minimum: 1, maximum: 200, default: 12 });
    // 개찰 필터의 기본값이 문서에 드러나야 소비자가 "생략하면 개찰된 회차만"을 계약에서 읽는다.
    expect(attempts.parameters[4].schema).toMatchObject({ type: "string", enum: ["only", "any"], default: "only" });
    expect(attempts.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/EatbidApiV1OrganizationAuctionAttempts",
    });
    expect(attempts.responses["404"].content["application/problem+json"].schema).toBeDefined();
    expect(document.components.schemas.EatbidApiV1OrganizationAuctionAttempts.properties).toMatchObject({
      organizationId: { $ref: "#/components/schemas/PositiveBigintText" },
      meta: { $ref: "#/components/schemas/OrganizationAuctionAttemptsMeta" },
    });
    expect(document.components.schemas.OrganizationAuctionAttempt.properties.winRate)
      .toMatchObject({ allOf: [{ $ref: "#/components/schemas/ObservedBidRate" }], nullable: true });
    expect(document.components.schemas.OrganizationAuctionAttempt.properties.secondRate)
      .toMatchObject({ allOf: [{ $ref: "#/components/schemas/ObservedBidRate" }], nullable: true });
    expect(document.components.schemas.OrganizationAuctionAttempt.properties.floorRate)
      .toMatchObject({ allOf: [{ $ref: "#/components/schemas/BidRate" }], nullable: true });
    expect(document.components.schemas.ObservedBidRateText).toMatchObject({ type: "string", maxLength: 16 });
    expect(document.components.schemas.BidRateText).toMatchObject({ type: "string", maxLength: 7 });
  });

  test("생성 OpenAPI의 식별자 schema가 signed bigint 경계를 기계적으로 강제한다", async () => {
    const module = await import("./openapi");
    const document = module.createOpenApiDocument() as any;
    const accepted = ["1", "9223372036854775807"];
    const rejected = [
      "0",
      "01",
      "9223372036854775808",
      "9999999999999999999",
      "10000000000000000000",
    ];

    for (const schemaName of ["AuctionId", "PositiveBigintText"]) {
      const schema = document.components.schemas[schemaName];
      for (const value of accepted) expect(openApiStringSchemaAccepts(schema, value)).toBe(true);
      for (const value of rejected) expect(openApiStringSchemaAccepts(schema, value)).toBe(false);
    }
  });
});
