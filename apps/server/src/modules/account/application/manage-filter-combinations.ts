/**
 * @module 책임: 내 워크스페이스가 저장한 조건 조합의 조회·저장·삭제를 워크스페이스 경계와 함께 수행한다.
 *
 * 셋을 한 모듈에 두는 이유는 같은 이유로 바뀌기 때문이다. "누구의 조합인가"라는 소유 판정이 바뀌면 세
 * 경로가 함께 바뀐다. 모두 내부 record를 돌려주고 공개 응답 직렬화는 presenter가 한다(ADR 0045 결정 1).
 *
 * 건수는 여기 없다. 조합이 몇 건인지는 열린 공고를 세는 일이라 procurement가 소유한다.
 */
import { Effect } from "effect";

import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import {
  FilterCombinationDependencyUnavailable,
  FilterCombinationLimitReached,
  FilterCombinationNameTaken,
  FilterCombinationNotFound,
  type FilterCombinationFilterRecord,
  type FilterCombinationRecord,
  type FilterCombinationRepository,
} from "./filter-combination-repository";

export class ListMyFilterCombinations {
  constructor(private readonly repository: FilterCombinationRepository) {}

  execute(principal: ResolvedPrincipal): Effect.Effect<
    readonly FilterCombinationRecord[],
    FilterCombinationDependencyUnavailable
  > {
    return Effect.tryPromise({
      try: () => this.repository.listCombinations(principal.workspace.workspaceId),
      catch: (cause) => new FilterCombinationDependencyUnavailable(cause),
    });
  }
}

export class SaveMyFilterCombination {
  constructor(private readonly repository: FilterCombinationRepository) {}

  /**
   * 조회는 `member`도 하지만 저장·삭제는 워크스페이스가 함께 보는 목록을 바꾸는 일이다. 그래도 `owner`로
   * 좁히지 않는다 — 관심 지역과 달리 조합은 **보는 방식**이지 워크스페이스의 사실이 아니고, 구성원이
   * 자기 판을 못 저장하면 조합이 탐색 도구가 아니라 관리 기능이 된다(ADR 0032 §3).
   *
   * 상한과 이름 중복은 값으로 받아 실패로 바꾼다. 둘 다 잘못된 요청이 아니라 지금 저장 상태와의 충돌이다.
   */
  execute(input: {
    readonly principal: ResolvedPrincipal;
    readonly name: string;
    readonly filter: FilterCombinationFilterRecord;
  }): Effect.Effect<
    FilterCombinationRecord,
    FilterCombinationDependencyUnavailable | FilterCombinationLimitReached | FilterCombinationNameTaken
  > {
    return Effect.tryPromise({
      try: () => this.repository.saveCombination({
        workspaceId: input.principal.workspace.workspaceId,
        principalId: input.principal.principalId,
        name: input.name,
        filter: input.filter,
      }),
      catch: (cause) => new FilterCombinationDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((result) => {
        if (result.kind === "saved") return Effect.succeed(result.combination);
        if (result.kind === "limit-reached") return Effect.fail(new FilterCombinationLimitReached());
        return Effect.fail(new FilterCombinationNameTaken());
      }),
    );
  }
}

export class DeleteMyFilterCombination {
  constructor(private readonly repository: FilterCombinationRepository) {}

  /**
   * 남의 워크스페이스 조합은 "없다"로 답한다. 403으로 답하면 그 id가 존재한다는 사실이 새어 나가고,
   * 이 자원은 사용자가 이름을 붙인 것이라 존재 자체가 알려 줄 것이 있다.
   */
  execute(input: {
    readonly principal: ResolvedPrincipal;
    readonly filterCombinationId: bigint;
  }): Effect.Effect<void, FilterCombinationDependencyUnavailable | FilterCombinationNotFound> {
    return Effect.tryPromise({
      try: () => this.repository.deleteCombination({
        workspaceId: input.principal.workspace.workspaceId,
        filterCombinationId: input.filterCombinationId,
      }),
      catch: (cause) => new FilterCombinationDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((result) => result.kind === "deleted"
        ? Effect.void
        : Effect.fail(new FilterCombinationNotFound())),
    );
  }
}
