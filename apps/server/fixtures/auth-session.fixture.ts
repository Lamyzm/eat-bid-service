/**
 * @module 책임: production 인증 조립 그대로의 provider 인스턴스와, 실제 서명된 세션 쿠키를 만드는
 * 테스트 보조를 빌려준다.
 *
 * Google 왕복은 네트워크 없이 재현할 수 없으므로 사용자·계정·세션 행만 실제 adapter로 만든다. 쿠키
 * 서명·세션 정책·저장 표·조회 경로는 전부 배포와 같은 코드를 지난다. provider 기본 test harness는
 * 옵션을 합치기 전에 `node:sqlite`를 열어 이 runtime에서 쓸 수 없다.
 */
import { serializeSignedCookie } from "better-call";
import { drizzle } from "drizzle-orm/postgres-js";
import { systemClock } from "@eatbid/domain";
import { createAuthInstance, type AuthInstance } from "../src/platform/auth/auth-instance";
import { parseEnvironment } from "../src/platform/config/environment";
import { createAuthDatabaseBinding } from "../src/platform/database/auth-database-adapter";
import type { ManagedDatabase } from "../src/platform/database/managed-database";
import { LoggingModule, type RedactingJsonLogger } from "../src/platform/logging/logging.module";
import type { DisposableDatabase } from "./disposable-database.fixture";

export const testAuthSecret = "t".repeat(48);

export interface TestAuth {
  readonly auth: AuthInstance;
  readonly logger: RedactingJsonLogger;
  readonly lines: readonly string[];
}

export function createTestAuth(client: DisposableDatabase["api"]): TestAuth {
  const lines: string[] = [];
  const logger = LoggingModule.create(
    parseEnvironment({ NODE_ENV: "test", DATABASE_URL: "postgres://user:secret@127.0.0.1:5432/unused" }),
    systemClock,
    (line) => lines.push(line),
  );
  const auth = createAuthInstance({
    environment: {
      secret: testAuthSecret,
      baseUrl: "http://localhost:3000",
      google: { clientId: "test-client-id", clientSecret: "test-client-secret" },
      devLoginEnabled: false,
      useSecureCookies: false,
    },
    database: createAuthDatabaseBinding({ database: drizzle({ client }) } as unknown as ManagedDatabase),
    trustedOrigins: ["http://localhost:3000"],
    logger,
  });
  return { auth, logger, lines };
}

export interface SignedInSession {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
  readonly headers: Headers;
}

/** provider adapter로 사용자·계정·세션을 만들고 provider와 같은 방식으로 서명한 쿠키를 돌려준다. */
export async function signInThroughAdapter(
  auth: AuthInstance,
  input: {
    readonly email: string;
    readonly expiresInSeconds?: number;
    /** provider가 소유한 원본 표시 이름이다. 길이 제한은 provider에도 저장 열에도 없다. */
    readonly name?: string;
  },
): Promise<SignedInSession> {
  const context = await auth.$context;
  const now = new Date();
  const user = await context.adapter.create<Record<string, unknown>, { id: string }>({
    model: "user",
    data: {
      name: input.name ?? "김이름",
      email: input.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  await context.adapter.create({
    model: "account",
    data: {
      issuer: "https://accounts.google.com",
      accountId: `google-${user.id}`,
      providerId: "google",
      userId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });
  const token = `token-${user.id}`;
  const expiresIn = input.expiresInSeconds ?? context.sessionConfig.expiresIn;
  await context.adapter.create({
    model: "session",
    data: {
      token,
      userId: user.id,
      expiresAt: new Date(now.getTime() + expiresIn * 1000),
      createdAt: now,
      updatedAt: now,
    },
  });
  const serialized = await serializeSignedCookie(
    context.authCookies.sessionToken.name,
    token,
    context.secret,
    {},
  );
  const headers = new Headers();
  headers.set("cookie", serialized.split(";")[0]!);
  return { userId: user.id, email: input.email, token, headers };
}

export function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
