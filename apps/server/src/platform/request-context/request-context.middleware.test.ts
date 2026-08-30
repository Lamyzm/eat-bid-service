import { describe, expect, test } from "bun:test";

describe("request context middleware 경계", () => {
  test("안전한 request ID는 수용하고 안전하지 않은 값에는 새 ID를 생성한다", async () => {
    const module = await import("./request-context.middleware").catch(() => undefined);
    expect(module, "request-context middleware must exist").toBeDefined();
    expect(module!.selectRequestId("client.request-123")).toBe("client.request-123");
    expect(module!.selectRequestId("unsafe value\nheader")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
