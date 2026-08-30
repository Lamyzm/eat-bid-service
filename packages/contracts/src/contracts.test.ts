import { describe, expect, test } from "bun:test";

describe("public operational contracts", () => {
  test("health and Problem Details contracts are bounded", async () => {
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
  });
});
