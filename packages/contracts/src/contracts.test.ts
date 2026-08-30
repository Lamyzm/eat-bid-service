import { describe, expect, test } from "bun:test";

describe("공개 운영 계약", () => {
  test("health와 Problem Details 계약의 범위를 제한한다", async () => {
    const module = await import("./index").catch(() => undefined);
    expect(module, "contracts package must publish operational schemas").toBeDefined();
    expect(module!.liveHealthSchema.safeParse({ status: "live" }).success).toBe(true);
    expect(module!.liveHealthSchema.safeParse({ status: "live", secret: true }).success).toBe(false);
    expect(module!.problemDetailsSchema.safeParse({
      type: "https://eatbid.dev/problems/internal-error",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      requestId: "req-1",
      secret: true,
    }).success).toBe(false);
    expect(module!.healthOperations.live).toMatchObject({
      controllerPath: "health",
      handlerPath: "live",
      path: "/health/live",
    });
    expect(module!.healthOperations.ready).toMatchObject({
      controllerPath: "health",
      handlerPath: "ready",
      path: "/health/ready",
    });
    expect(module!.auctionOperations.find).toMatchObject({
      handlerPath: ":auctionId",
      path: "/api/v1/auctions/{auctionId}",
      operationId: "findAuction",
    });
  });
});
