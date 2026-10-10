import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { currentSessionV1ResponseSchema } from "./get-current-session.response";
import { sessionV1Operations } from "./operations";

const getCurrentSession = sessionV1Operations.getCurrentSession;
const maxSignedBigint = "9223372036854775807";

describe("getCurrentSession operation 계약", () => {
  test("공개 registry가 이 operation을 server 소유로 한 번만 갖는다", () => {
    const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === "getCurrentSession");

    expect(found.length).toBe(1);
    expect(found[0]?.implementationOwner).toBe("server");
  });

  test("semantic route에서 versioned 경로가 파생된다", () => {
    expect(getCurrentSession.method).toBe("get");
    expect(getCurrentSession.openApiPath).toBe("/api/v1/session");
    expect(getCurrentSession.buildPath({ path: undefined })).toBe("/api/v1/session");
  });

  test("미로그인은 오류가 아니라 200 상태값이다", () => {
    expect(getCurrentSession.successStatuses).toEqual([200]);
    expect(getCurrentSession.problemStatuses).not.toContain(401);
    expect(currentSessionV1ResponseSchema.parse({ state: "unauthenticated" }))
      .toEqual({ state: "unauthenticated" });
  });

  test("인증 의존성이 준비되지 않은 배포는 200 미로그인이 아니라 503으로 구분된다", () => {
    expect(getCurrentSession.problemStatuses).toEqual([400, 500, 503]);
  });

  test("초기화 미완료와 활성 상태를 서로 다른 값으로 구분한다", () => {
    const uninitialized = currentSessionV1ResponseSchema.parse({
      state: "uninitialized",
      account: { displayName: "김이름", maskedEmail: "k***@example.com" },
    });
    const active = currentSessionV1ResponseSchema.parse({
      state: "active",
      account: { displayName: null, maskedEmail: null },
      principalId: maxSignedBigint,
      workspace: { workspaceId: maxSignedBigint, name: "내 워크스페이스", role: "owner" },
      operator: false,
    });

    expect(uninitialized.state).toBe("uninitialized");
    expect(active.state === "active" && active.principalId).toBe(maxSignedBigint);
  });

  test("운영자 여부는 요청한 활성 세션에만 실리고 다른 두 상태에는 실을 자리가 없다", () => {
    // 배포 중에는 옛 server와 새 web, 새 server와 옛 web이 잠깐 섞인다. 새 key를 요청할 때만 실어야 옛 web의 엄격한 schema가
    // 응답을 통째로 거부하지 않고, 새 web은 key가 없는 옛 server 응답을 운영자 아님으로 읽는다.
    const active = {
      state: "active",
      account: { displayName: null, maskedEmail: null },
      principalId: "7",
      workspace: { workspaceId: "1", name: "내 워크스페이스", role: "owner" },
    };
    expect(currentSessionV1ResponseSchema.safeParse(active).success).toBe(true);
    expect(currentSessionV1ResponseSchema.safeParse({ ...active, operator: true }).success).toBe(true);
    expect(currentSessionV1ResponseSchema.safeParse({ state: "unauthenticated", operator: false }).success).toBe(false);
  });

  test("운영자 여부는 include=operator로만 요청하고 다른 query는 받지 않는다", () => {
    expect(getCurrentSession.querySchema.parse(undefined)).toEqual({});
    expect(getCurrentSession.querySchema.parse({ include: "operator" })).toEqual({ include: "operator" });
    expect(getCurrentSession.querySchema.safeParse({ include: "everything" }).success).toBe(false);
    expect(getCurrentSession.querySchema.safeParse({ operator: "true" }).success).toBe(false);
  });

  test("MAX_SAFE_INTEGER를 넘는 principal ID를 손실 없이 문자열로 싣는다", () => {
    const parsed = currentSessionV1ResponseSchema.parse({
      state: "active",
      account: { displayName: null, maskedEmail: null },
      principalId: maxSignedBigint,
      workspace: { workspaceId: maxSignedBigint, name: "내 워크스페이스", role: "member" },
      operator: true,
    });

    expect(parsed.state === "active" && BigInt(parsed.principalId)).toBe(9223372036854775807n);
    expect(currentSessionV1ResponseSchema.safeParse({
      state: "active",
      account: { displayName: null, maskedEmail: null },
      principalId: "9223372036854775808",
      workspace: { workspaceId: "1", name: "내 워크스페이스", role: "owner" },
      operator: false,
    }).success).toBe(false);
  });

  test("응답에 원본 이메일이나 세션 토큰을 실을 자리가 없다", () => {
    expect(currentSessionV1ResponseSchema.safeParse({
      state: "uninitialized",
      account: { displayName: null, maskedEmail: null, email: "user@example.com" },
    }).success).toBe(false);
    expect(currentSessionV1ResponseSchema.safeParse({
      state: "unauthenticated",
      sessionToken: "abc",
    }).success).toBe(false);
  });
});
