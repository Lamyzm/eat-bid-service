/**
 * @module 책임: provider 세션 하나를 app의 principal·identity·개인 워크스페이스로 멱등하게 만든다.
 *
 * 이 use case가 존재하는 이유는 provider hook이 원자 경계를 주지 못하기 때문이다. pinned Better Auth
 * 1.7.2의 `queueAfterTransactionHook`은 provider transaction이 commit된 뒤 hook을 실행한다. hook에서
 * principal을 만들면 hook 실패가 "계정은 있는데 app 관계가 없는" 상태로 굳고, 그 사용자는 이미 존재하는
 * user라 재로그인해도 hook이 다시 돌지 않아 스스로 복구할 수 없다. 명시적 command는 몇 번을 불러도
 * 같은 결과이고 그 자체가 복구 경로다(ADR 0032 §2).
 */
import type { AccountInitializationV1Response } from "@eatbid/contracts";
import { Effect } from "effect";
import { AccountDependencyUnavailable, type AccountRepository } from "./account-repository";
import { toWorkspaceSummary } from "./account-presentation";

/**
 * 혼자 쓰는 사용자에게 조직 이름을 먼저 묻지 않는다. 그 화면은 아무 정보도 얻지 못하면서 가입을 한 단계
 * 늘린다. 이름 변경은 owner의 나중 선택이지 가입 조건이 아니다(ADR 0032 §8).
 */
export const DEFAULT_WORKSPACE_NAME = "내 워크스페이스";

export class InitializeCurrentAccount {
  constructor(private readonly repository: AccountRepository) {}

  execute(subject: string): Effect.Effect<AccountInitializationV1Response, AccountDependencyUnavailable> {
    return Effect.tryPromise({
      try: () => this.repository.initializeAccount({ subject, workspaceName: DEFAULT_WORKSPACE_NAME }),
      catch: (cause) => new AccountDependencyUnavailable(cause),
    }).pipe(Effect.map((principal) => ({
      principalId: principal.principalId.toString(10),
      workspace: toWorkspaceSummary(principal.workspace),
    })));
  }
}
