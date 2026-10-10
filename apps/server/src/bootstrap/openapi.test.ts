import { describe, expect, test } from "bun:test";
import {
  auctionV1Operations,
  publicHttpOperationRegistry,
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
      // 조건 사전 조회다. 비교 지역·품목·기관 여닫이 셋이 같은 조건을 세 번 묻지 않도록 한 응답을 나눠 쓴다.
      "/api/v1/analysis/condition-options",
      "/api/v1/analysis/distribution",
      "/api/v1/analysis/history",
      "/api/v1/analysis/time-series",
      "/api/v1/auctions",
      "/api/v1/auctions/summary",
      "/api/v1/auctions/{auctionId}",
      // 운영자만 보는 추천 투찰가다(ADR 0062). 공고 응답과 권한 수준이 달라 path를 나눴다.
      "/api/v1/auctions/{auctionId}/bid-position",
      "/api/v1/auctions/{auctionId}/roster",
      // listCodes는 EAT-57이 계약을 소유하고 Nest handler는 아직 없다. registry가 OpenAPI의 단일
      // 출처이므로 계약이 열린 사실이 여기 그대로 드러나야 하고, 구현이 붙는 변경에서 handler와
      // e2e가 같이 온다.
      "/api/v1/code-schemes/{scheme}/codes",
      // 참가제한지역 선택 목록과 저장 전 미리보기다. `listCodes`가 활성 release 없는 체계를 404로 답하고
      // 라벨을 필수로 요구해 이 축을 실을 수 없어서 별도 resource로 열렸다(ADR 0048 결정 8).
      "/api/v1/eligibility-areas",
      "/api/v1/eligibility-areas/coverage",
      // 한 path에 조회와 등록 두 method가 함께 있다. path item을 덮어쓰면 하나가 문서에서 사라진다.
      // 운영자만 보는 오늘 투찰 한 장이다(PDR-0008). 관심 지역과 등록 사업자 시장으로 정해지는 개인 응답이라 `me` 아래다.
      "/api/v1/me/bid-board",
      "/api/v1/me/businesses",
      "/api/v1/me/businesses/{businessId}/bid-observations",
      "/api/v1/me/businesses/{businessId}/location",
      "/api/v1/me/filter-combinations",
      "/api/v1/me/filter-combinations/counts",
      "/api/v1/me/filter-combinations/{filterCombinationId}",
      "/api/v1/me/initialization",
      // 조회와 통째 교체 두 method가 한 path에 있다. 부분 갱신 command는 만들지 않는다.
      "/api/v1/me/region-preference",
      "/api/v1/session",
      "/health/live",
      "/health/ready",
    ]);
    const operations = Object.values(document.paths).flatMap((path: any) => Object.values(path)) as any[];
    const operationIds = operations.map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.sort())
      .toEqual([
        "clearMyBusinessLocation",
        "countMyFilterCombinations",
        "deleteMyFilterCombination",
        "findAnalysisConditionOptions",
        "findAnalysisDistribution",
        "findAnalysisHistory",
        "findAnalysisTimeSeries",
        "findAuction",
        "findMyBidObservations",
        "getAuctionBidPosition",
        "getAuctionRoster",
        "getCurrentSession",
        "getMyBidBoard",
        "getMyRegionPreference",
        "healthLive",
        "healthReady",
        "initializeCurrentAccount",
        "listCodes",
        "listEligibilityAreas",
        "listMyBusinesses",
        "listMyFilterCombinations",
        "listOpenAuctions",
        "previewRegionCoverage",
        "putMyRegionPreference",
        "registerMyBusiness",
        "saveMyFilterCombination",
        "setMyBusinessLocation",
        "summarizeOpenAuctions",
      ]);
    // 성공 status를 200으로 고정하지 않는다. 생성 command는 201이며, 그 사실을 registry에서 읽는다.
    const successStatusById = new Map(publicHttpOperationRegistry
      .map((operation) => [operation.operationId, operation.successStatuses]));
    for (const operation of operations) {
      const statuses = successStatusById.get(operation.operationId) ?? [];
      expect(statuses.length).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(operation.responses[String(status)].content["application/json"].schema).toBeDefined();
      }
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
