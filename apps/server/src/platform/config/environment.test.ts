import { describe, expect, test } from "bun:test";

const production = {
  NODE_ENV: "production",
  PORT: "4400",
  CORS_ORIGINS: "https://app.eatbid.dev,https://admin.eatbid.dev",
  TRUST_PROXY_HOPS: "2",
  HTTP_PAYLOAD_LIMIT_BYTES: "1048576",
  SHUTDOWN_GRACE_MS: "15000",
  SWAGGER_ENABLED: "false",
  BUILD_SHA: "a".repeat(40),
} as const;

describe("operational environment", () => {
  test("uses bounded non-production fallbacks", async () => {
    const module = await import("./environment").catch(() => undefined);
    expect(module, "environment boundary must exist").toBeDefined();
    expect(module!.parseEnvironment({ NODE_ENV: "test" })).toEqual({
      runtimeMode: "test",
      port: 4400,
      corsOrigins: ["http://localhost:3000"],
      proxyHops: 0,
      payloadLimitBytes: 1_048_576,
      shutdownGraceMs: 10_000,
      swaggerEnabled: false,
      buildSha: "unknown",
    });
  });

  test("parses the exact production origin set and operational values", async () => {
    const { parseEnvironment } = await import("./environment");
    expect(parseEnvironment(production)).toEqual({
      runtimeMode: "production",
      port: 4400,
      corsOrigins: ["https://app.eatbid.dev", "https://admin.eatbid.dev"],
      proxyHops: 2,
      payloadLimitBytes: 1_048_576,
      shutdownGraceMs: 15_000,
      swaggerEnabled: false,
      buildSha: "a".repeat(40),
    });
  });

  test("rejects missing mode, malformed values, wildcard origins, and production fallbacks", async () => {
    const { parseEnvironment } = await import("./environment");
    const invalid = [
      {},
      { ...production, NODE_ENV: "staging" },
      { ...production, PORT: "0" },
      { ...production, CORS_ORIGINS: "*" },
      { ...production, CORS_ORIGINS: "https://app.eatbid.dev/path" },
      { ...production, TRUST_PROXY_HOPS: "-1" },
      { ...production, HTTP_PAYLOAD_LIMIT_BYTES: "0" },
      { ...production, SHUTDOWN_GRACE_MS: "not-a-number" },
      { ...production, SWAGGER_ENABLED: "true" },
      { ...production, BUILD_SHA: "unknown" },
      { ...production, CORS_ORIGINS: undefined },
      { ...production, BUILD_SHA: undefined },
    ];
    for (const source of invalid) expect(() => parseEnvironment(source)).toThrow();
  });
});
