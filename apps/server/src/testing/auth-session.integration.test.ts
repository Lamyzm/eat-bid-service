import { describe, expect, test } from "bun:test";
import { createBetterAuthSessionAuthenticator } from "../platform/auth/better-auth-session-authenticator";
import { withAccountDatabase } from "../../fixtures/account.fixture";
import { createTestAuth, signInThroughAdapter, sqlLiteral } from "../../fixtures/auth-session.fixture";

type Owner = { unsafe: (query: string) => Promise<Array<Record<string, unknown>>> };

function cookieHeader(value: string): Headers {
  const headers = new Headers();
  headers.set("cookie", value);
  return headers;
}

/** 서명은 쿠키 값 끝에 붙는다. 마지막 한 자리만 바꿔 토큰과 이름은 그대로 두고 서명만 무효로 만든다. */
function withBrokenSignature(cookie: string): string {
  const last = cookie.at(-1);
  return `${cookie.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

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

  test("살아 있는 세션도 서명이 유효한 쿠키만 통과하고 로그아웃하면 그 쿠키가 거부된다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const { auth } = createTestAuth(api);
      const session = await signInThroughAdapter(auth, { email: "signout@example.com" });
      const authenticator = createBetterAuthSessionAuthenticator(auth);
      // 이름을 테스트가 다시 적으면 provider 기본값으로 되돌아가도 검사가 통과한다. 실제로 읽는 이름을 쓴다.
      const cookieName = (await auth.$context).authCookies.sessionToken.name;
      const signed = session.headers.get("cookie")!;

      expect(signed.startsWith(`${cookieName}=`)).toBe(true);
      expect(await authenticator.authenticate(session.headers)).not.toBeNull();

      // 아래 둘은 DB에 살아 있는 바로 그 세션이다. 서명 검증이 사라지면 저장소 조회가 성공해 통과한다.
      expect(await authenticator.authenticate(cookieHeader(`${cookieName}=${session.token}`))).toBeNull();
      expect(await authenticator.authenticate(cookieHeader(withBrokenSignature(signed)))).toBeNull();
      expect(await authenticator.authenticate(new Headers())).toBeNull();

      await auth.api.signOut({ headers: session.headers });

      // 서명이 여전히 유효한 원래 쿠키다. 로그아웃은 그 서명이 아니라 저장된 세션을 없앤다.
      expect(await authenticator.authenticate(session.headers)).toBeNull();
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
