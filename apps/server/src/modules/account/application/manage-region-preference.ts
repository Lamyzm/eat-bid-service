/**
 * @module 책임: 내 워크스페이스 관심 지역의 조회와 통째 교체를 워크스페이스 경계·역할 판정과 함께 수행한다.
 *
 * 둘을 한 모듈에 두는 이유는 같은 이유로 바뀌기 때문이다. "누구의 지역인가"라는 소유 판정이 바뀌면
 * 조회 범위와 교체 권한이 함께 바뀐다. 두 use case 모두 내부 record를 돌려주고 공개 응답 직렬화는
 * presentation의 presenter가 한다(ADR 0045 결정 1).
 */
import { Effect } from "effect";

import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import { WorkspaceRoleForbidden } from "./account-repository";
import {
  RegionPreferenceAreaUnknown,
  RegionPreferenceDependencyUnavailable,
  type RegionPreferenceRecord,
  type RegionPreferenceRepository,
} from "./region-preference-repository";

/**
 * 조회는 `member`도 하지만 교체는 워크스페이스 자체를 바꾸는 일이라 `owner`만 한다(ADR 0032 §3·§5).
 * 등록 사업자 command와 같은 판정이라 그 실패 타입을 그대로 쓴다 — 화면이 둘을 다르게 안내할 이유가 없다.
 */
function requireWorkspaceOwner(principal: ResolvedPrincipal): Effect.Effect<void, WorkspaceRoleForbidden> {
  return principal.workspace.role === "owner" ? Effect.void : Effect.fail(new WorkspaceRoleForbidden());
}

export class GetMyRegionPreference {
  constructor(private readonly repository: RegionPreferenceRepository) {}

  execute(principal: ResolvedPrincipal): Effect.Effect<
    RegionPreferenceRecord,
    RegionPreferenceDependencyUnavailable
  > {
    return Effect.tryPromise({
      try: () => this.repository.readPreference(principal.workspace.workspaceId),
      catch: (cause) => new RegionPreferenceDependencyUnavailable(cause),
    });
  }
}

export class ReplaceMyRegionPreference {
  constructor(private readonly repository: RegionPreferenceRepository) {}

  /**
   * 목록을 통째로 바꾸고 확인 도장을 같은 트랜잭션에서 찍는다. 부분 갱신을 만들지 않는 이유는 중간
   * 실패가 "사용자가 확인한 목록"을 반쪽 상태로 남기기 때문이다.
   *
   * 중복 코드는 거절하지 않고 접는다. 사용자가 같은 지역을 두 번 누른 것은 잘못된 요청이 아니라 같은
   * 선택이며, 저장 grain이 (워크스페이스, 코드)라 결과도 같다.
   */
  execute(input: {
    readonly principal: ResolvedPrincipal;
    readonly codeValueIds: readonly bigint[];
  }): Effect.Effect<
    RegionPreferenceRecord,
    RegionPreferenceAreaUnknown | RegionPreferenceDependencyUnavailable | WorkspaceRoleForbidden
  > {
    const codeValueIds = [...new Set(input.codeValueIds)];
    return requireWorkspaceOwner(input.principal).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.repository.replacePreference({
          workspaceId: input.principal.workspace.workspaceId,
          principalId: input.principal.principalId,
          codeValueIds,
        }),
        catch: (cause) => new RegionPreferenceDependencyUnavailable(cause),
      })),
      Effect.flatMap((result) => result.kind === "replaced"
        ? Effect.succeed(result.preference)
        : Effect.fail(new RegionPreferenceAreaUnknown())),
    );
  }
}
