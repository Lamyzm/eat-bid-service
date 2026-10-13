/**
 * @module 책임: 내 워크스페이스의 등록 사업자 조회·등록과 위치 저장·해제를 하나의 소유 규칙 아래 수행한다.
 *
 * 세 동작을 한 모듈에 두는 이유는 셋이 같은 이유로 바뀌기 때문이다. 등록의 소유 판정(이 워크스페이스의
 * 등록인가)이 바뀌면 조회 범위와 위치 쓰기 권한이 함께 바뀐다. 세 use case 모두 내부 record를 돌려주고
 * 공개 응답으로의 직렬화는 presentation의 presenter가 한다(ADR 0045 결정 1).
 */
import { Effect } from "effect";
import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import {
  AccountDependencyUnavailable,
  RegisteredBusinessConflict,
  RegisteredBusinessForbidden,
  RegisteredBusinessNotFound,
  WorkspaceRoleForbidden,
  type AccountRepository,
  type RegisteredBusinessRecord,
} from "./account-repository";

/**
 * 워크스페이스를 바꾸는 command의 역할 판정이다. 조회는 `member`도 하지만 등록과 위치 변경은 워크스페이스
 * 자체를 바꾸는 일이라 `owner`만 한다(ADR 0032 §3·§5).
 */
function requireWorkspaceOwner(principal: ResolvedPrincipal): Effect.Effect<void, WorkspaceRoleForbidden> {
  return principal.workspace.role === "owner"
    ? Effect.void
    : Effect.fail(new WorkspaceRoleForbidden());
}

/** 목록과, 요청했으면 원본 업체명이다. 요청하지 않았으면 `labels`가 null이다 — 비어 있는 이름표와 구분한다. */
export interface ListedBusinesses {
  readonly businesses: readonly RegisteredBusinessRecord[];
  readonly labels: ReadonlyMap<bigint, string> | null;
}

export class ListMyBusinesses {
  constructor(private readonly repository: AccountRepository) {}

  /**
   * 업체명은 화면이 요청할 때만 읽는다. 같은 목록 port를 맞춤 금액 계산도 쓰므로 거기에 이름 조회를 얹으면 모든 추천 계산이
   * 투찰 표를 한 번 더 읽는다. 원본과 이어진 등록만 이름을 찾는다.
   */
  execute(
    principal: ResolvedPrincipal,
    options: { readonly includeSupplierLabel: boolean } = { includeSupplierLabel: false },
  ): Effect.Effect<ListedBusinesses, AccountDependencyUnavailable> {
    return Effect.tryPromise({
      try: async (): Promise<ListedBusinesses> => {
        const businesses = await this.repository.listBusinesses(principal.workspace.workspaceId);
        if (!options.includeSupplierLabel) return { businesses, labels: null };
        const parties = businesses.flatMap((business) =>
          business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
        return { businesses, labels: await this.repository.findSupplierLabels(parties) };
      },
      catch: (cause) => new AccountDependencyUnavailable(cause),
    });
  }
}

export class RegisterMyBusiness {
  constructor(private readonly repository: AccountRepository) {}

  execute(input: {
    readonly principal: ResolvedPrincipal;
    readonly businessNumber: string;
  }): Effect.Effect<
    RegisteredBusinessRecord,
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
        ? Effect.succeed(result.business)
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
    RegisteredBusinessRecord,
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
        RegisteredBusinessRecord,
        RegisteredBusinessForbidden | RegisteredBusinessNotFound
      > => {
        if (result.kind === "not-found") return Effect.fail(new RegisteredBusinessNotFound());
        if (result.kind === "forbidden") return Effect.fail(new RegisteredBusinessForbidden());
        return Effect.succeed(result.business);
      }),
    );
  }
}
