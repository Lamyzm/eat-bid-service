import { describe, expect, test } from "bun:test";

import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { OperatorGrantReader } from "../../../platform/auth/operator-grant-reader";
import type { PrincipalReader, ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import type { SessionAuthenticator } from "../../../platform/auth/session-authenticator";
import { GetCurrentSession } from "./get-current-session";

const subject = { subject: "provider-subject", email: "chulsoo@example.com", name: "김철수" };
const principal = {
  principalId: 11n,
  workspace: { workspaceId: 7n, name: "내 워크스페이스", role: "owner" },
} as unknown as ResolvedPrincipal;

function session(options: { readonly signedIn?: boolean; readonly grants: OperatorGrantReader }) {
  const authenticator = { authenticate: async () => (options.signedIn === false ? null : subject) } as unknown as SessionAuthenticator;
  const reader = { findBySubject: async () => principal } as unknown as PrincipalReader;
  return new GetCurrentSession(authenticator, reader, options.grants);
}

const run = (subjectUseCase: GetCurrentSession) => new EffectRunner().run(subjectUseCase.execute(new Headers()));

describe("현재 세션 판정", () => {
  test("운영자 권한이 있는 활성 세션은 운영자라고 싣는다", async () => {
    const asked: bigint[] = [];
    const result = await run(session({ grants: { hasActiveGrant: async (principalId) => { asked.push(principalId); return true; } } }));
    expect(result).toMatchObject({ state: "active", operator: true });
    expect(asked).toEqual([11n]);
  });

  test("권한이 없거나 권한 조회가 실패해도 세션은 살아 있고 운영자가 아니라고 싣는다", async () => {
    expect(await run(session({ grants: { hasActiveGrant: async () => false } }))).toMatchObject({ state: "active", operator: false });
    const broken = await run(session({ grants: { hasActiveGrant: async () => { throw new Error("private grant failure"); } } }));
    expect(broken).toMatchObject({ state: "active", operator: false });
  });

  test("로그인하지 않았으면 권한을 묻지 않는다", async () => {
    let asked = 0;
    const result = await run(session({ signedIn: false, grants: { hasActiveGrant: async () => { asked++; return true; } } }));
    expect(result).toEqual({ state: "unauthenticated" });
    expect(asked).toBe(0);
  });
});
