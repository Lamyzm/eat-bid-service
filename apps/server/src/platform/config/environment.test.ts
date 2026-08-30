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
  DATABASE_URL: "postgres://eatbid_api:secret@postgres:5432/eatbid",
} as const;

describe("운영 environment", () => {
  test("비운영 fallback을 제한된 범위로 사용한다", async () => {
    const module = await import("./environment").catch(() => undefined);
    expect(module, "environment boundary must exist").toBeDefined();
    expect(module!.parseEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:5432/eatbid_test",
    })).toEqual({
      runtimeMode: "test",
      port: 4400,
      corsOrigins: ["http://localhost:3000"],
      proxyHops: 0,
      payloadLimitBytes: 1_048_576,
      shutdownGraceMs: 10_000,
      swaggerEnabled: false,
      buildSha: "unknown",
      databaseUrl: "postgres://eatbid_api:test-only@127.0.0.1:5432/eatbid_test",
    });
  });

  test("정확한 production origin 집합과 운영 값을 해석한다", async () => {
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
      databaseUrl: "postgres://eatbid_api:secret@postgres:5432/eatbid",
    });
  });

  test("누락 mode·잘못된 값·wildcard origin·production fallback을 거부한다", async () => {
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
      { ...production, DATABASE_URL: undefined },
      { ...production, DATABASE_URL: "not-a-postgresql-url" },
      { ...production, DATABASE_URL: "mysql://user:secret@db/eatbid" },
    ];
    for (const source of invalid) expect(() => parseEnvironment(source)).toThrow();
  });
});
