/**
 * Better Auth — 셀프호스팅 인증. 사용자가 우리 Postgres에 살기 때문에
 * user ↔ user_biz ↔ firm_bids 조인이 한 쿼리로 끝난다(외부 의존 0, 비용 0).
 *
 * 게스트 모드: 로그인은 선택이다. 세션이 없으면 웹이 localStorage로 폴백하며
 * 전 기능이 그대로 동작한다 — 아버지 검증(G1) 전에 로그인 강제 금지.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { user, session, account, verification } from "@eatbid/shared";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  secret: process.env.BETTER_AUTH_SECRET || "dev-insecure-auth-secret",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:8081",
  basePath: "/api/auth",
  emailAndPassword: { enabled: true },
  socialProviders: process.env.GOOGLE_CLIENT_ID
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        },
      }
    : undefined,
});

/** 요청 헤더에서 세션 조회 — 없으면 null(게스트) */
export async function getSessionUser(headers: Record<string, any>) {
  try {
    const h = new Headers();
    for (const [k, v] of Object.entries(headers ?? {})) {
      if (typeof v === "string") h.set(k, v);
    }
    const s = await auth.api.getSession({ headers: h });
    return s?.user?.id ? { userId: s.user.id, email: s.user.email, name: s.user.name } : null;
  } catch {
    return null;
  }
}
