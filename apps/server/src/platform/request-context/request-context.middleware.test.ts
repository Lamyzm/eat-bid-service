import { describe, expect, test } from "bun:test";

describe("request context middleware", () => {
  test("accepts a safe request id and generates one for an unsafe value", async () => {
    const module = await import("./request-context.middleware").catch(() => undefined);
    expect(module, "request-context middleware must exist").toBeDefined();
    expect(module!.selectRequestId("client.request-123")).toBe("client.request-123");
    expect(module!.selectRequestId("unsafe value\nheader")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
