import { BadRequestException } from "@nestjs/common";
import { describe, expect, test } from "bun:test";

describe("검증 범위를 정의한다 — Standard Schema request and response boundaries", () => {
  test("동작을 검증한다 — request validation rejects an invalid value", async () => {
    const module = await import("./standard-schema.pipe").catch(() => undefined);
    expect(module, "Standard Schema pipe must exist").toBeDefined();
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) => typeof value === "string"
          ? { value }
          : { issues: [{ message: "expected string" }] },
      },
    };
    const pipe = new module!.StandardSchemaPipe(schema);
    await expect(pipe.transform(42)).rejects.toBeInstanceOf(BadRequestException);
  });

  test("동작을 검증한다 — response validation fails closed instead of leaking an extra field", async () => {
    const module = await import("./response-schema.interceptor").catch(() => undefined);
    expect(module, "response schema interceptor must exist").toBeDefined();
    const result = await module!.validateResponse({ ok: true, secret: "must-not-leak" }, {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) => {
          const record = value as Record<string, unknown>;
          return Object.keys(record).length === 1 && record.ok === true
            ? { value }
            : { issues: [{ message: "unexpected response field" }] };
        },
      },
    }).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });
});
