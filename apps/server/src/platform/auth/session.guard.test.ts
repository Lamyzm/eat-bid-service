import { describe, expect, test } from "bun:test";
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import {
  anonymousSessionAuthenticator,
  signedInSessionAuthenticator,
  testSubject,
} from "../../../fixtures/session-authenticator.fixture";
import type { PrincipalReader, ResolvedPrincipal } from "./principal-reader";
import { AuthDependencyUnavailable, unavailableSessionAuthenticator } from "./session-authenticator";
import {
  PrincipalGuard,
  ProviderSessionGuard,
  readAuthenticatedSubject,
  readResolvedPrincipal,
} from "./session.guard";

const principal: ResolvedPrincipal = {
  principalId: 7n,
  workspace: { workspaceId: 11n, name: "내 워크스페이스", role: "owner" },
};

function contextOf(request: object): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function readerOf(findBySubject: PrincipalReader["findBySubject"]): PrincipalReader {
  return { findBySubject };
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(() => undefined, (error: unknown) => error);
}

describe("세션 guard의 상태 구분", () => {
  test("미로그인은 401, 초기화 미완료는 403이며 해소된 주체와 principal은 요청에 실린다", async () => {
    const anonymous = new PrincipalGuard(anonymousSessionAuthenticator, readerOf(() => Promise.resolve(principal)));
    await expect(anonymous.canActivate(contextOf({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);

    const uninitialized = new PrincipalGuard(signedInSessionAuthenticator, readerOf(() => Promise.resolve(null)));
    await expect(uninitialized.canActivate(contextOf({ headers: {} }))).rejects.toBeInstanceOf(ForbiddenException);

    const request = { headers: {} };
    const resolved = new PrincipalGuard(signedInSessionAuthenticator, readerOf(() => Promise.resolve(principal)));
    await expect(resolved.canActivate(contextOf(request))).resolves.toBe(true);
    expect(readAuthenticatedSubject(request)).toEqual(testSubject);
    expect(readResolvedPrincipal(request)).toBe(principal);
    // 다른 요청 객체에서는 아무것도 꺼낼 수 없다. guard 결과는 요청 전역 store가 아니라 그 요청에만 실린다.
    expect(() => readResolvedPrincipal({})).toThrow(UnauthorizedException);
  });

  test("provider 의존성 장애는 원인을 실은 503이고 알 수 없는 오류는 그대로 던진다", async () => {
    const providerCause = new Error("provider socket closed");
    const unavailable = new ProviderSessionGuard({
      authenticate: () => Promise.reject(new AuthDependencyUnavailable(providerCause)),
    });
    const failure = await failureOf(unavailable.canActivate(contextOf({ headers: {} })));
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    const cause = (failure as ServiceUnavailableException).cause;
    expect(cause).toBeInstanceOf(AuthDependencyUnavailable);
    expect((cause as AuthDependencyUnavailable).cause).toBe(providerCause);

    // 인증을 켜지 않은 배포도 같은 경로로 503이며 원인에 그 사실이 남는다.
    const disabled = new ProviderSessionGuard(unavailableSessionAuthenticator);
    const disabledFailure = await failureOf(disabled.canActivate(contextOf({ headers: {} })));
    expect(disabledFailure).toBeInstanceOf(ServiceUnavailableException);
    expect((disabledFailure as ServiceUnavailableException).cause).toBeInstanceOf(AuthDependencyUnavailable);

    // 의존성 장애로 분류되지 않은 오류를 503으로 바꾸면 결함이 장애로 위장된다.
    const defect = new TypeError("authenticator bug");
    const broken = new ProviderSessionGuard({ authenticate: () => Promise.reject(defect) });
    await expect(broken.canActivate(contextOf({ headers: {} }))).rejects.toBe(defect);
  });

  test("principal 조회 실패는 원인을 그대로 실은 503으로 닫는다", async () => {
    const databaseCause = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    const guard = new PrincipalGuard(signedInSessionAuthenticator, readerOf(() => Promise.reject(databaseCause)));
    const failure = await failureOf(guard.canActivate(contextOf({ headers: {} })));
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).cause).toBe(databaseCause);
  });
});
