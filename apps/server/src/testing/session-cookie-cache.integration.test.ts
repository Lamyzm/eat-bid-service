import { describe, expect, test } from "bun:test";
import { createBetterAuthSessionAuthenticator } from "../platform/auth/better-auth-session-authenticator";
import type { AuthInstance } from "../platform/auth/auth-instance";
import { withAccountDatabase } from "../../fixtures/account.fixture";
import type { DisposableDatabase } from "../../fixtures/disposable-database.fixture";
import { createTestAuth, signInThroughAdapter } from "../../fixtures/auth-session.fixture";

type ApiClient = DisposableDatabase["api"];

/**
 * drizzle의 postgres-js driver는 모든 질의를 `client.unsafe(sql, params)` 하나로 보낸다. 그 호출을 세면
 * "이 세션 확인이 PostgreSQL을 읽었는가"가 추론이 아니라 관측이 된다. adapter나 use case가 아니라 driver
 * 경계에서 세는 이유는, 중간 층이 조회를 감춰도 실제 왕복은 여기를 반드시 지나기 때문이다.
 */
function countingClient(client: ApiClient): {
  readonly client: ApiClient;
  readonly statements: readonly string[];
  reset(): void;
} {
  let statements: string[] = [];
  const proxy = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property !== "unsafe" || typeof value !== "function") return value;
      return (...args: readonly unknown[]) => {
        statements.push(String(args[0]));
        return (value as (...input: readonly unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return {
    client: proxy,
    get statements() {
      return statements;
    },
    reset() {
      statements = [];
    },
  };
}

/**
 * 브라우저가 실제로 받는 서명된 세션 사본을 그대로 얻는다. 사본을 손으로 만들면 서명·필드·수명이
 * 배포와 갈라져 통과가 아무것도 증명하지 못한다.
 *
 * `disableRefresh`를 붙이지 않는 이유가 여기서 중요하다. 그 query가 있으면 provider는 세션을 읽자마자
 * 되돌아가 사본을 만들지 않는다. 즉 사본을 채우는 것은 서버 간 검증이 아니라 브라우저가 직접 부르는
 * provider 세션 hook이고, 그 응답의 `Set-Cookie`만 브라우저에 도달한다(ADR 0032 §1·§12).
 */
async function withCookieCache(auth: AuthInstance, headers: Headers): Promise<Headers> {
  const { headers: responseHeaders } = await auth.api.getSession({ headers, returnHeaders: true });
  const cached = responseHeaders.getSetCookie().map((cookie) => cookie.split(";")[0]!);
  expect(cached.some((cookie) => cookie.includes("session_data"))).toBe(true);
  const next = new Headers();
  next.set("cookie", [headers.get("cookie") ?? "", ...cached].filter(Boolean).join("; "));
  return next;
}

describe("세션 쿠키 캐시와 저장소 조회", () => {
  test("사본이 유효한 동안 세션 확인이 PostgreSQL을 한 번도 읽지 않는다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const counter = countingClient(api);
      const { auth } = createTestAuth(counter.client);
      const session = await signInThroughAdapter(auth, { email: "cookie-cache@example.com" });
      const authenticator = createBetterAuthSessionAuthenticator(auth);

      // 사본이 없는 첫 확인은 저장소를 읽는다. 이 대조가 없으면 아래 0이 "캐시가 먹었다"가 아니라
      // "애초에 아무 일도 안 했다"일 수 있다.
      counter.reset();
      const cold = await authenticator.authenticate(session.headers);
      expect(cold?.subject).toBe(session.userId);
      expect(counter.statements.length).toBeGreaterThan(0);

      const cachedHeaders = await withCookieCache(auth, session.headers);

      counter.reset();
      const warm = await authenticator.authenticate(cachedHeaders);
      expect(warm).toEqual(cold);
      expect(counter.statements).toEqual([]);

      // 게이트는 요청마다 이 확인을 한다. 두 번째·세 번째도 저장소를 읽지 않아야 요청당 조회가 0이다.
      await authenticator.authenticate(cachedHeaders);
      await authenticator.authenticate(cachedHeaders);
      expect(counter.statements).toEqual([]);
    });
  }, 300_000);

  test("사본이 실려 있어도 세션 쿠키가 없으면 주체를 만들어 내지 않는다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const counter = countingClient(api);
      const { auth } = createTestAuth(counter.client);
      const session = await signInThroughAdapter(auth, { email: "cookie-only@example.com" });
      const authenticator = createBetterAuthSessionAuthenticator(auth);
      const cachedHeaders = await withCookieCache(auth, session.headers);

      // 세션 토큰 쿠키만 지운 사본 단독 요청이다. 사본이 인증 근거가 되면 만료·회수된 토큰을 버린
      // 브라우저가 캐시만으로 계속 통과한다.
      const dataOnly = new Headers();
      dataOnly.set(
        "cookie",
        cachedHeaders
          .get("cookie")!
          .split("; ")
          .filter((cookie) => cookie.includes("session_data"))
          .join("; "),
      );

      counter.reset();
      expect(await authenticator.authenticate(dataOnly)).toBeNull();
      expect(counter.statements).toEqual([]);
    });
  }, 300_000);
});
