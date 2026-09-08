/**
 * @module 책임: 내 워크스페이스의 등록 사업자 조회·등록과 위치 저장·해제를 하나의 소유 규칙 아래 수행한다.
 *
 * 세 동작을 한 모듈에 두는 이유는 셋이 같은 이유로 바뀌기 때문이다. 등록의 소유 판정(이 워크스페이스의
 * 등록인가)이 바뀌면 조회 범위와 위치 쓰기 권한이 함께 바뀐다.
 */
import type { MyBusinessesV1Response, MyBusinessV1Response } from "@eatbid/contracts";
import { Effect } from "effect";
import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import {
  AccountDependencyUnavailable,
  RegisteredBusinessConflict,
  RegisteredBusinessForbidden,
  RegisteredBusinessNotFound,
  WorkspaceRoleForbidden,
  type AccountRepository,
} from "./account-repository";
import { toRegisteredBusiness } from "./account-presentation";

/**
 * 워크스페이스를 바꾸는 command의 역할 판정이다. 조회는 `member`도 하지만 등록과 위치 변경은 워크스페이스
 * 자체를 바꾸는 일이라 `owner`만 한다(ADR 0032 §3·§5).
 */
function requireWorkspaceOwner(principal: ResolvedPrincipal): Effect.Effect<void, WorkspaceRoleForbidden> {
  return principal.workspace.role === "owner"
    ? Effect.void
    : Effect.fail(new WorkspaceRoleForbidden());
}

export class ListMyBusinesses {
  constructor(private readonly repository: AccountRepository) {}

  execute(principal: ResolvedPrincipal): Effect.Effect<MyBusinessesV1Response, AccountDependencyUnavailable> {
    return Effect.tryPromise({
      try: () => this.repository.listBusinesses(principal.workspace.workspaceId),
      catch: (cause) => new AccountDependencyUnavailable(cause),
    }).pipe(Effect.map((records) => ({ businesses: records.map(toRegisteredBusiness) })));
  }
}

export class RegisterMyBusiness {
  constructor(private readonly repository: AccountRepository) {}

  execute(input: {
    readonly principal: ResolvedPrincipal;
    readonly businessNumber: string;
  }): Effect.Effect<
    MyBusinessV1Response,
    AccountDependencyUnavailable | RegisteredBusinessConflict | WorkspaceRoleForbidden
  > {
    return requireWorkspaceOwner(input.principal).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.repository.registerBusiness({
          workspaceId: input.principal.workspace.workspaceId,
          principalId: input.principal.principalId,
          businessNumber: input.businessNumber,
        }),
        catch: (cause) => new AccountDependencyUnavailable(cause),
      })),
      // 다른 워크스페이스가 같은 번호를 등록한 것은 충돌이 아니다. 여기서 걸리는 것은 내 워크스페이스의
      // 중복과 상한 도달뿐이며, 그 판정은 부분 unique index와 같은 트랜잭션의 상한 검사가 한다(ADR 0032 §7).
      Effect.flatMap((result) => result.kind === "registered"
        ? Effect.succeed({ business: toRegisteredBusiness(result.business) })
        : Effect.fail(new RegisteredBusinessConflict())),
    );
  }
}

export class ChangeMyBusinessLocation {
  constructor(private readonly repository: AccountRepository) {}

  /** `addressText`가 `null`이면 위치를 미설정으로 되돌린다. 빈 문자열을 저장하는 경로는 없다. */
  execute(input: {
    readonly principal: ResolvedPrincipal;
    readonly registeredBusinessId: bigint;
    readonly addressText: string | null;
  }): Effect.Effect<
    MyBusinessV1Response,
    AccountDependencyUnavailable
    | RegisteredBusinessForbidden
    | RegisteredBusinessNotFound
    | WorkspaceRoleForbidden
  > {
    return requireWorkspaceOwner(input.principal).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.repository.changeLocation({
          workspaceId: input.principal.workspace.workspaceId,
          principalId: input.principal.principalId,
          registeredBusinessId: input.registeredBusinessId,
          addressText: input.addressText,
        }),
        catch: (cause) => new AccountDependencyUnavailable(cause),
      })),
      Effect.flatMap((result): Effect.Effect<
        MyBusinessV1Response,
        RegisteredBusinessForbidden | RegisteredBusinessNotFound
      > => {
        if (result.kind === "not-found") return Effect.fail(new RegisteredBusinessNotFound());
        if (result.kind === "forbidden") return Effect.fail(new RegisteredBusinessForbidden());
        return Effect.succeed({ business: toRegisteredBusiness(result.business) });
      }),
    );
  }
}
