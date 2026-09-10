import { describe, expect, test } from "bun:test";
import { payloadByteLimit, seconds } from "@eatbid/domain";

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
      payloadLimit: payloadByteLimit(1_048_576),
      shutdownGrace: seconds(10),
      swaggerEnabled: false,
      buildSha: "unknown",
      databaseUrl: "postgres://eatbid_api:test-only@127.0.0.1:5432/eatbid_test",
      // 인증 값이 하나도 없는 배포는 인증을 켜지 않은 배포다. 공개 read는 그대로 동작한다.
      auth: null,
    });
  });

  test("정확한 production origin 집합과 운영 값을 해석한다", async () => {
    const { parseEnvironment } = await import("./environment");
    expect(parseEnvironment(production)).toEqual({
      runtimeMode: "production",
      port: 4400,
      corsOrigins: ["https://app.eatbid.dev", "https://admin.eatbid.dev"],
      proxyHops: 2,
      payloadLimit: payloadByteLimit(1_048_576),
      shutdownGrace: seconds(15),
      swaggerEnabled: false,
      buildSha: "a".repeat(40),
      databaseUrl: "postgres://eatbid_api:secret@postgres:5432/eatbid",
      auth: null,
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

const authSecret = "s".repeat(48);
const authSource = {
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: "https://app.eatbid.dev",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
} as const;

describe("인증 environment", () => {
  test("네 값이 모두 있을 때만 인증 설정이 존재한다", async () => {
    const { parseEnvironment } = await import("./environment");

    expect(parseEnvironment({ ...production, ...authSource }).auth).toEqual({
      secret: authSecret,
      baseUrl: "https://app.eatbid.dev",
      google: { clientId: "client-id", clientSecret: "client-secret" },
      devLoginEnabled: false,
      useSecureCookies: true,
    });
    expect(parseEnvironment(production).auth).toBeNull();
  });

  test("일부만 설정한 배포는 기동 시점에 실패한다", async () => {
    const { parseEnvironment } = await import("./environment");

    for (const key of Object.keys(authSource)) {
      const partial: Record<string, string | undefined> = { ...production, ...authSource };
      partial[key] = undefined;
      expect(() => parseEnvironment(partial), key).toThrow();
    }
  });

  test("production은 https를 강제하고 공인 host의 http를 거부한다", async () => {
    const { parseEnvironment } = await import("./environment");

    // 공인 host의 http는 세션 쿠키에 Secure를 붙이지 못하는 배포다. 조용히 통과시키면 로그인은 되는데
    // 쿠키가 평문으로 오간다.
    expect(() => parseEnvironment({
      ...production,
      ...authSource,
      BETTER_AUTH_URL: "http://app.eatbid.dev",
    })).toThrow();
    expect(() => parseEnvironment({
      ...production,
      ...authSource,
      BETTER_AUTH_URL: "http://localhost:3000",
    })).toThrow();
  });

  test("비운영에서는 loopback host의 http만 허용하고 Secure 쿠키를 끈다", async () => {
    const { parseEnvironment } = await import("./environment");
    const development = { ...production, ...authSource, NODE_ENV: "development" } as const;

    expect(parseEnvironment({ ...development, BETTER_AUTH_URL: "http://localhost:3000" }).auth)
      .toMatchObject({ baseUrl: "http://localhost:3000", useSecureCookies: false });
    expect(parseEnvironment({ ...development, BETTER_AUTH_URL: "http://127.0.0.1:3000" }).auth)
      .toMatchObject({ useSecureCookies: false });
    expect(parseEnvironment({ ...development, BETTER_AUTH_URL: "https://app.eatbid.dev" }).auth)
      .toMatchObject({ useSecureCookies: true });
    expect(() => parseEnvironment({ ...development, BETTER_AUTH_URL: "http://app.eatbid.dev" }))
      .toThrow();
  });

  test("scheme·authority 밖의 값을 담은 base URL을 거부한다", async () => {
    const { parseEnvironment } = await import("./environment");

    for (const url of [
      "app.eatbid.dev",
      "ftp://app.eatbid.dev",
      "https://app.eatbid.dev?next=/x",
      "https://app.eatbid.dev#x",
      "https://user:pass@app.eatbid.dev",
    ]) {
      expect(() => parseEnvironment({ ...production, ...authSource, BETTER_AUTH_URL: url }), url)
        .toThrow();
    }
  });
});

const devLoginSource = {
  NODE_ENV: "development",
  DATABASE_URL: "postgres://eatbid_api:dev-only@127.0.0.1:5432/eatbid_dev",
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: "http://localhost:3000",
  EATBID_DEV_LOGIN: "true",
} as const;

describe("개발 로그인 environment", () => {
  test("EATBID_DEV_LOGIN=true면 Google 자격 없이도 인증 설정이 존재하고 provider 조립이 개발 로그인을 켠다", async () => {
    const { parseEnvironment } = await import("./environment");

    expect(parseEnvironment(devLoginSource).auth).toEqual({
      secret: authSecret,
      baseUrl: "http://localhost:3000",
      google: null,
      devLoginEnabled: true,
      useSecureCookies: false,
    });
    // Google 자격이 함께 있으면 둘 다 켜진다. 팀원이 OAuth client를 만든 뒤에도 시드 계정은 그대로 쓸 수 있다.
    expect(parseEnvironment({ ...devLoginSource, ...authSource, BETTER_AUTH_URL: "http://localhost:3000" }).auth)
      .toMatchObject({ google: { clientId: "client-id", clientSecret: "client-secret" }, devLoginEnabled: true });
  });

  test("production에서는 EATBID_DEV_LOGIN=true를 다른 값이 전부 정상이어도 거부한다", async () => {
    const { parseEnvironment } = await import("./environment");

    expect(() => parseEnvironment({ ...production, ...authSource, EATBID_DEV_LOGIN: "true" }))
      .toThrow("Dev login cannot be enabled in production");
    expect(() => parseEnvironment({ ...production, EATBID_DEV_LOGIN: "true" }))
      .toThrow("Dev login cannot be enabled in production");
    // 명시적으로 끈 값은 없는 것과 같다. 운영 배포가 값을 적어 두어도 기동을 막지 않는다.
    expect(parseEnvironment({ ...production, ...authSource, EATBID_DEV_LOGIN: "false" }).auth)
      .toMatchObject({ devLoginEnabled: false });
  });

  test("개발 로그인 없이 Google 쌍이 빠지면 지금처럼 거부하고, 쌍의 절반만 있으면 개발 로그인이 켜져도 거부한다", async () => {
    const { parseEnvironment } = await import("./environment");
    const secretAndUrl = {
      NODE_ENV: "development",
      DATABASE_URL: devLoginSource.DATABASE_URL,
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: "http://localhost:3000",
    } as const;

    // secret과 URL만 있는 배포는 로그인 화면이 열리는데 어떤 방법으로도 로그인할 수 없는 배포다.
    expect(() => parseEnvironment(secretAndUrl)).toThrow("no sign-in method");
    expect(() => parseEnvironment({ ...secretAndUrl, EATBID_DEV_LOGIN: "false" })).toThrow("no sign-in method");
    expect(() => parseEnvironment({ ...devLoginSource, GOOGLE_CLIENT_ID: "client-id" }))
      .toThrow("missing GOOGLE_CLIENT_SECRET");
    expect(() => parseEnvironment({ ...devLoginSource, GOOGLE_CLIENT_SECRET: "client-secret" }))
      .toThrow("missing GOOGLE_CLIENT_ID");
  });

  test("개발 로그인 모드에서도 secret과 base URL은 고정 개발값으로 대신하지 않는다", async () => {
    const { parseEnvironment } = await import("./environment");

    expect(() => parseEnvironment({ ...devLoginSource, BETTER_AUTH_SECRET: undefined }))
      .toThrow("missing BETTER_AUTH_SECRET");
    expect(() => parseEnvironment({ ...devLoginSource, BETTER_AUTH_URL: undefined }))
      .toThrow("missing BETTER_AUTH_URL");
    // 플래그 하나만 있는 배포도 "인증 없음"이 아니라 설정 누락이다. 조용히 null로 두면 화면은 503만 본다.
    expect(() => parseEnvironment({
      NODE_ENV: "development",
      DATABASE_URL: devLoginSource.DATABASE_URL,
      EATBID_DEV_LOGIN: "true",
    })).toThrow("missing BETTER_AUTH_SECRET, BETTER_AUTH_URL");
  });
});
