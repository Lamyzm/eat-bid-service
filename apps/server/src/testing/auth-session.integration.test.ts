import { describe, expect, test } from "bun:test";
import { createBetterAuthSessionAuthenticator } from "../platform/auth/better-auth-session-authenticator";
import { withAccountDatabase } from "../../fixtures/account.fixture";
import { createTestAuth, signInThroughAdapter, sqlLiteral } from "../../fixtures/auth-session.fixture";

type Owner = { unsafe: (query: string) => Promise<Array<Record<string, unknown>>> };

async function sessionRow(owner: Owner, token: string) {
  const [row] = await owner.unsafe(`
    select "expiresAt"::text as expires_at, "updatedAt"::text as updated_at
    from app.auth_session where token = '${sqlLiteral(token)}'
  `);
  return row;
}

describe("실제 Better Auth adapter와 세션 수명", () => {
  test("adapter가 커밋된 표에 사용자·계정·세션을 남기고 canonical authenticator가 그 주체를 읽는다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "live@example.com" });

      const [storedUser] = await owner.unsafe(
        `select id, "emailVerified" from app.auth_user where id = '${sqlLiteral(session.userId)}'`,
      );
      const [storedAccount] = await owner.unsafe(
        `select "accountId", issuer from app.auth_account where "userId" = '${sqlLiteral(session.userId)}'`,
      );
      expect(storedUser?.emailVerified).toBe(true);
      // provider가 준 외부 subject는 account 행에만 남는다. auth user id는 provider 값이 아니다.
      expect(storedAccount?.accountId).toBe(`google-${session.userId}`);
      expect(storedAccount?.issuer).toBe("https://accounts.google.com");

      const subject = await createBetterAuthSessionAuthenticator(auth).authenticate(session.headers);
      expect(subject?.subject).toBe(session.userId);
      expect(subject?.email).toBe("live@example.com");
    });
  }, 300_000);

  test("provider rate limit 표가 밀리초 시각을 손실 없이 저장한다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const context = await createTestAuth(api).auth.$context;
      const lastRequest = Date.now();

      await context.adapter.create({
        model: "rateLimit",
        data: { key: "ip:127.0.0.1", count: 1, lastRequest },
      });

      const [stored] = await owner.unsafe(`select "lastRequest"::text as last_request from app.auth_rate_limit`);
      expect(String(stored?.last_request)).toBe(String(lastRequest));
    });
  }, 300_000);

  test("canonical 세션 검증은 갱신 창을 넘긴 세션도 연장하지 않는다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "aged@example.com" });
      const context = await auth.$context;
      // 갱신 임계를 이미 넘긴 상태로 만든다. 갱신을 끄지 않으면 이 조회 하나가 DB 만료를 연장하면서
      // Set-Cookie를 만드는데, RSC와 서버 간 조회는 그 헤더를 브라우저까지 전달하지 못한다.
      const aged = context.sessionConfig.updateAge + 60;
      await owner.unsafe(`
        update app.auth_session
        set "expiresAt" = "expiresAt" - interval '${aged} seconds',
            "updatedAt" = "updatedAt" - interval '${aged} seconds'
        where token = '${sqlLiteral(session.token)}'
      `);
      const before = await sessionRow(owner, session.token);

      const subject = await createBetterAuthSessionAuthenticator(auth).authenticate(session.headers);

      expect(subject?.subject).toBe(session.userId);
      expect(await sessionRow(owner, session.token)).toEqual(before);
    });
  }, 300_000);

  test("브라우저가 부르는 provider 갱신은 Set-Cookie와 DB 수명을 함께 늘린다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "refresh@example.com" });
      const context = await auth.$context;
      const aged = context.sessionConfig.updateAge + 60;
      await owner.unsafe(`
        update app.auth_session set "expiresAt" = "expiresAt" - interval '${aged} seconds'
        where token = '${sqlLiteral(session.token)}'
      `);
      const before = await sessionRow(owner, session.token);

      // 갱신은 브라우저가 POST로 요청해 Set-Cookie를 직접 받는 경로다. 서버 조회가 대신하지 않는다.
      const response = await auth.api.getSession({
        headers: session.headers,
        method: "POST",
        asResponse: true,
      });

      expect(response.headers.get("set-cookie")).toBeTruthy();
      expect(await sessionRow(owner, session.token)).not.toEqual(before);
    });
  }, 300_000);

  test("만료 세션은 미로그인이고 조회가 세션 행을 지우지 않는다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, {
        email: "expired@example.com",
        expiresInSeconds: -60,
      });

      const subject = await createBetterAuthSessionAuthenticator(auth).authenticate(session.headers);

      expect(subject).toBeNull();
      // 읽기 한 번이 로그아웃을 확정하지 않는다. 만료 세션 정리는 브라우저가 부르는 POST 갱신이 맡는다.
      const [remaining] = await owner.unsafe(
        `select count(*)::int as total from app.auth_session where token = '${sqlLiteral(session.token)}'`,
      );
      expect(remaining?.total).toBe(1);
    });
  }, 300_000);

  test("로그아웃한 세션과 서명 없는 쿠키는 미로그인이다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "signout@example.com" });
      const authenticator = createBetterAuthSessionAuthenticator(auth);
      expect(await authenticator.authenticate(session.headers)).not.toBeNull();

      await auth.api.signOut({ headers: session.headers });

      expect(await authenticator.authenticate(session.headers)).toBeNull();
      expect(await authenticator.authenticate(new Headers())).toBeNull();
      const forged = new Headers();
      // 서명 없는 값은 세션이 아니다. 토큰 문자열을 아는 것만으로는 통과하지 못한다.
      forged.set("cookie", `eatbid.session_token=${session.token}`);
      expect(await authenticator.authenticate(forged)).toBeNull();
    });
  }, 300_000);

  test("provider 오류 로그에 세션 토큰이나 원문 driver 메시지가 남지 않는다", async () => {
    await withAccountDatabase(async ({ api, owner, ownerUrl }) => {
      const { auth, lines } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "logs@example.com" });
      const stderr: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      // provider 기본 logger는 console.error로 driver 예외를 통째로 쏟는다. 두 출구를 모두 확인한다.
      process.stderr.write = ((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        // 세션 조회가 driver 오류를 만나게 한다. 그 오류의 params에는 세션 토큰이 그대로 들어 있다.
        await owner.unsafe(`alter table app.auth_session rename to auth_session_moved`);
        await createBetterAuthSessionAuthenticator(auth)
          .authenticate(session.headers)
          .catch(() => undefined);
      } finally {
        process.stderr.write = originalWrite;
        await owner.unsafe(`alter table app.auth_session_moved rename to auth_session`);
      }

      const emitted = [...lines, ...stderr].join("\n");
      expect(emitted).not.toContain(session.token);
      expect(emitted).not.toContain(ownerUrl);
      expect(emitted).not.toContain("auth_session");
      expect(lines.some((line) => line.includes("auth_provider"))).toBe(true);
    });
  }, 300_000);
});
