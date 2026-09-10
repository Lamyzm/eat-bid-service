import { afterAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { systemClock } from "@eatbid/domain";
import { parseEnvironment } from "../config/environment";
import { createAuthDatabaseBinding } from "../database/auth-database-adapter";
import type { ManagedDatabase } from "../database/managed-database";
import { LoggingModule } from "../logging/logging.module";
import { createAuthInstance } from "./auth-instance";

// 어떤 질의도 보내지 않으므로 닿지 않는 포트면 충분하다. provider 조립은 저장소를 열지 않는다.
const unusedDatabaseUrl = "postgres://eatbid_api:unused@127.0.0.1:1/unused";
const clients: Array<ReturnType<typeof postgres>> = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end({ timeout: 1 }).catch(() => undefined)));
});

async function contextFor(source: Record<string, string>) {
  const environment = parseEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: unusedDatabaseUrl,
    BETTER_AUTH_SECRET: "t".repeat(48),
    BETTER_AUTH_URL: "http://localhost:3000",
    ...source,
  });
  const client = postgres(unusedDatabaseUrl, { max: 1 });
  clients.push(client);
  const auth = createAuthInstance({
    environment: environment.auth!,
    database: createAuthDatabaseBinding({ database: drizzle({ client }) } as unknown as ManagedDatabase),
    trustedOrigins: environment.corsOrigins,
    logger: LoggingModule.create(environment, systemClock, () => undefined),
  });
  return auth.$context;
}

const google = { GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-secret" };

describe("환경에 따른 provider 조립", () => {
  test("개발 로그인만 켠 환경은 Google을 등록하지 않고 이메일·비밀번호를 연다", async () => {
    const context = await contextFor({ EATBID_DEV_LOGIN: "true" });

    expect(context.options.emailAndPassword?.enabled).toBe(true);
    expect(context.socialProviders.map((provider) => provider.id)).toEqual([]);
  });

  test("Google만 켠 환경은 이메일·비밀번호를 닫은 채 Google을 등록한다", async () => {
    const context = await contextFor(google);

    expect(context.options.emailAndPassword?.enabled).toBe(false);
    expect(context.socialProviders.map((provider) => provider.id)).toEqual(["google"]);
  });

  test("둘 다 있는 환경은 두 방법을 함께 연다", async () => {
    const context = await contextFor({ ...google, EATBID_DEV_LOGIN: "true" });

    expect(context.options.emailAndPassword?.enabled).toBe(true);
    // 시드가 서버 API로 만든 계정에 아무도 들고 있지 않은 세션이 남지 않게 sign-up의 자동 로그인은 끈다.
    expect(context.options.emailAndPassword?.autoSignIn).toBe(false);
    expect(context.socialProviders.map((provider) => provider.id)).toEqual(["google"]);
  });
});
