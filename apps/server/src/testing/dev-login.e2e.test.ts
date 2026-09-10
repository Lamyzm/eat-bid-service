import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { resolve } from "node:path";
import request from "supertest";
import { auctionV1Operations, meV1Operations, sessionV1Operations } from "@eatbid/contracts";
import { createApp } from "../bootstrap/create-app";
import { DEV_LOGIN_ACCOUNT, runDevLoginSeed } from "../platform/auth/dev-login-seed";
import { parseEnvironment, type Environment } from "../platform/config/environment";
import { withAccountDatabase } from "../../fixtures/account.fixture";
import { testAuthSecret } from "../../fixtures/auth-session.fixture";

const origin = "http://localhost:3000";
const sessionPath = sessionV1Operations.getCurrentSession.buildPath({ path: undefined });
const businessesPath = meV1Operations.listMyBusinesses.buildPath({ path: undefined });
const openAuctionsPath = auctionV1Operations.listOpen.buildPath({ path: {}, query: undefined });
// provider 원문 경로다. canonical operation이 아니라 Better Auth 라이브러리 계약 그대로다(ADR 0032 §1).
const emailSignInPath = "/api/auth/sign-in/email";
const emailSignUpPath = "/api/auth/sign-up/email";

/** Google 자격 없이 개발 로그인만 켠 로컬과, 플래그 없이 Google만 켠 배포 두 가지를 같은 DB 위에 만든다. */
function environmentFor(databaseUrl: string, mode: "dev-login" | "google-only"): Environment {
  return parseEnvironment({
    NODE_ENV: "test",
    PORT: "0",
    CORS_ORIGINS: origin,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: testAuthSecret,
    BETTER_AUTH_URL: origin,
    ...(mode === "dev-login"
      ? { EATBID_DEV_LOGIN: "true" }
      : { GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret" }),
  });
}

async function withServer<A>(environment: Environment, work: (server: Server) => Promise<A>): Promise<A> {
  const runtime = await createApp({
    environment,
    logWriter: () => undefined,
    databaseReadiness: { isReady: () => Promise.resolve(true) },
  });
  const server = await runtime.listen(0, "127.0.0.1");
  try {
    return await work(server);
  } finally {
    await runtime.shutdown();
  }
}

/** 브라우저가 저장할 쿠키만 골라 다음 요청의 Cookie 헤더로 만든다. 이름과 서명은 provider 응답 그대로다. */
function cookieHeaderOf(response: request.Response): string {
  return (response.get("Set-Cookie") ?? []).map((cookie) => cookie.split(";")[0]!).join("; ");
}

const credentials = { email: DEV_LOGIN_ACCOUNT.email, password: DEV_LOGIN_ACCOUNT.password };

const serverRoot = resolve(import.meta.dir, "../..");

/** 패키지 명령 `seed:dev-login`이 부르는 진입점을 그대로 child로 띄운다. 환경은 인자가 아니라 env로만 건넨다. */
async function runSeedCli(env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["bun", "src/platform/auth/dev-login-seed.ts"], {
    cwd: serverRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** 결과는 마지막 줄 하나다. 앞줄에는 provider 경고 같은 구조화 로그가 올 수 있다. */
function lastJsonLine(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
  return JSON.parse(line) as Record<string, unknown>;
}

describe("개발 로그인 provider와 시드 계정", () => {
  test("패키지 명령의 CLI 진입점도 같은 시드를 돌리고 결과를 JSON 한 줄로 낸다", async () => {
    await withAccountDatabase(async ({ apiUrl }) => {
      const env = {
        NODE_ENV: "test",
        DATABASE_URL: apiUrl,
        CORS_ORIGINS: origin,
        BETTER_AUTH_SECRET: testAuthSecret,
        BETTER_AUTH_URL: origin,
        EATBID_DEV_LOGIN: "true",
      };

      const first = await runSeedCli(env);
      expect([first.exitCode, first.stderr]).toEqual([0, ""]);
      expect(lastJsonLine(first.stdout)).toMatchObject({
        email: DEV_LOGIN_ACCOUNT.email,
        user: "created",
        business: "registered",
      });
      expect(first.stdout).not.toContain(DEV_LOGIN_ACCOUNT.password);

      const second = await runSeedCli(env);
      expect(second.exitCode).toBe(0);
      expect(lastJsonLine(second.stdout)).toMatchObject({ user: "existing", business: "existing" });

      // 플래그가 없으면 DB에 닿기 전에 거부하고, 실패 출력에 연결 URL을 싣지 않는다.
      const refused = await runSeedCli({
        ...env,
        EATBID_DEV_LOGIN: "false",
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      });
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("개발 로그인 시드 실패");
      expect(refused.stderr).not.toContain(apiUrl);
    });
  }, 300_000);

  test("시드는 멱등하고, 시드 계정의 이메일 로그인 세션이 게이트 뒤 read에 200으로 닿는다", async () => {
    await withAccountDatabase(async ({ apiUrl, owner }) => {
      const environment = environmentFor(apiUrl, "dev-login");

      const first = await runDevLoginSeed(environment, () => undefined);
      expect(first).toMatchObject({ email: DEV_LOGIN_ACCOUNT.email, user: "created", business: "registered" });
      const second = await runDevLoginSeed(environment, () => undefined);
      expect(second).toEqual({ ...first, user: "existing", business: "existing" });
      // 시드가 남기는 provider 행은 사용자 하나와 credential 계정 하나뿐이다. 아무도 들고 있지 않은 세션은 없다.
      const [rows] = await owner.unsafe(`
        select (select count(*)::int from app.auth_user) as users,
               (select count(*)::int from app.auth_account where "providerId" = 'credential') as credentials,
               (select count(*)::int from app.auth_session) as sessions
      `);
      expect(rows).toEqual({ users: 1, credentials: 1, sessions: 0 });

      await withServer(environment, async (server) => {
        const signedIn = await request(server).post(emailSignInPath).set("origin", origin).send(credentials);
        expect(signedIn.status).toBe(200);
        const cookie = cookieHeaderOf(signedIn);
        expect(cookie).toContain("better-auth.session_token=");

        // 세션 계약은 시드가 만든 principal·워크스페이스를 그대로 돌려준다. 초기화가 끝난 계정이다.
        const session = await request(server).get(sessionPath).set("cookie", cookie);
        expect(session.status).toBe(200);
        expect(session.body).toMatchObject({
          state: "active",
          principalId: first.principalId,
          workspace: { workspaceId: first.workspaceId, role: "owner" },
        });

        const businesses = await request(server).get(businessesPath).set("cookie", cookie);
        expect(businesses.status).toBe(200);
        expect(businesses.body.businesses.map((business: { businessNumber: string }) => business.businessNumber))
          .toEqual([DEV_LOGIN_ACCOUNT.businessNumber]);

        // 공유 read 게이트는 개발 로그인 모드에서도 그대로다. 세션 없는 요청은 401이고 세션이 있어야 지난다.
        const anonymous = await request(server).get(openAuctionsPath);
        expect(anonymous.status).toBe(401);
        const gated = await request(server).get(openAuctionsPath).set("cookie", cookie);
        expect(gated.status).not.toBe(401);

        const wrongPassword = await request(server).post(emailSignInPath).set("origin", origin)
          .send({ ...credentials, password: "not-the-dev-password" });
        expect(wrongPassword.status).toBe(401);
        expect(wrongPassword.get("Set-Cookie") ?? []).toEqual([]);
      });
    });
  }, 300_000);

  test("플래그 없이 부팅한 앱은 이메일 로그인·가입을 거부하고 시드도 돌지 않는다", async () => {
    await withAccountDatabase(async ({ apiUrl }) => {
      const environment = environmentFor(apiUrl, "google-only");
      await expect(runDevLoginSeed(environment, () => undefined)).rejects.toThrow("EATBID_DEV_LOGIN");

      await withServer(environment, async (server) => {
        // provider는 경로를 항상 등록하고 handler가 비활성을 거부한다. 404가 아니라 400과 provider 오류 코드다.
        const signIn = await request(server).post(emailSignInPath).set("origin", origin).send(credentials);
        expect(signIn.status).toBe(400);
        expect(signIn.body.code).toBe("EMAIL_PASSWORD_DISABLED");
        expect(signIn.get("Set-Cookie") ?? []).toEqual([]);

        const signUp = await request(server).post(emailSignUpPath).set("origin", origin)
          .send({ name: "누군가", email: "someone@example.com", password: "long-enough-password" });
        expect(signUp.status).toBe(400);
        expect(signUp.body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
      });
    });
  }, 300_000);
});
