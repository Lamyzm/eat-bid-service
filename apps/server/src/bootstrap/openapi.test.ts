import { describe, expect, test } from "bun:test";
import { auctionOperations, healthOperations } from "@eatbid/contracts";

describe("검증 범위를 정의한다 — canonical OpenAPI artifact", () => {
  test("상태를 검증한다 — is deterministic OpenAPI 3.0.3 with unique stable operations and complete routes", async () => {
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
    const auction = document.paths[auctionOperations.find.path].get;
    expect(auction.parameters[0]).toMatchObject({
      name: "auctionId",
      in: "path",
      required: true,
      example: "9007199254740993",
    });
    expect(auction.responses["200"].content["application/json"].schema).toBeDefined();
    expect(auction.responses["404"].content["application/problem+json"].schema).toBeDefined();
    expect(auction.responses["503"].content["application/problem+json"].schema).toBeDefined();
  });
});
