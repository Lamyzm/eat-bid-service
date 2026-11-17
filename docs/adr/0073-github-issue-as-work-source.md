# 0073 — 일의 원천은 GitHub issue 하나다: Linear·claim·세션 잠금 폐지

- Status: Accepted
- Date: 2026-11-17
- Supersedes: 0043
- 함께 대체하는 조항: [ADR 0026](0026-provider-neutral-ai-review-and-canonical-skills.md) 결정 6의 "세션이
  `workflow:claim`을 직접 실행한다", [2026-08-30 Linear agent workflow 설계](../superpowers/specs/2026-08-30-linear-agent-workflow-design.md)의
  "Linear가 소유권의 원천" 결정. ADR 0050(main 보호·CI 단일 병합 판정)과 0042(변경 범위 pre-commit)는 그대로다.
- 관련 작업: [#216](https://github.com/Lamyzm/eat-bid-service/issues/216)
- 승인: 사용자(제품 소유자) 결정, 2026-11-17 "GitHub 이슈를 그냥 쓰고 Linear는 빼자, worktree마다 하는 것은 전부 제거"

## Context

2026-08-30부터 일의 소유권은 Linear issue와 worktree별 claim이 들고 있었고, ADR 0043 뒤로는 세션 잠금
(holder)이 worktree마다 쓰는 세션 하나를 지켰다. 두 달 반 동안 이 장치가 지킨 사고보다 막은 작업이 많았다.

- **claim이 비밀 하나에 묶였다.** claim은 Linear API로 issue를 검증하고, 그 key는 Infisical wrapper 안에만
  있었다. Infisical 로그인이 풀린 날(2026-11-17)에는 issue 생성·claim·커밋·PR이 모두 멈췄고, 코드 수정과
  서버 시험 425건이 끝난 변경이 커밋되지 못한 채 세션이 끝났다.
- **Linear와 GitHub이 서로 모른다.** Linear의 GitHub 연동이 붙지 않아(webhook 0개) 병합해도 issue가 열린
  채 남았고, 이를 메우려고 `close-issue.yml`이 `pull_request_target`으로 Linear API를 불렀다. 무료 한도에
  닿아 완료 issue를 GraphQL로 보관하는 일도 생겼다.
- **세션 잠금이 인계를 막았다.** 사용자가 세션을 나눠 일을 넘기면, 넘긴 세션이 살아 있다는 이유로 받은
  세션의 모든 도구가 막혔다. hook 코드는 메인 체크아웃의 것이 돌기 때문에, 메인 체크아웃이 오래된 커밋에
  머물러 있으면 고친 규칙도 적용되지 않았다.
- **같은 저장소 주인의 다른 프로젝트(온누리)는 GitHub issue 하나로 같은 일을 한다.** 가지 이름에 issue
  번호를 넣고 커밋과 PR이 그 번호를 가리키면 추적성이 생기고, 잠금 없이도 한 일에 한 writer 규칙을 지켜 왔다.

잠금과 claim이 지키려던 것은 "한 worktree를 두 세션이 동시에 쓰지 않는다"와 "커밋이 어느 일인지 안다"였다.
앞의 것은 세션을 여는 사람이 정하는 운영 규칙이고, 뒤의 것은 가지 이름과 커밋 글로 충분히 남는다.

## Decision

### 1. 일의 원천은 이 저장소의 GitHub issue 하나다

- 굵은 일은 시작할 때 GitHub issue 하나를 만든다(없으면 만든다). 범위·인수 기준·결정은 issue 본문과
  댓글이 소유한다. 대화 기록·로컬 메모리는 원천이 아니다.
- Linear는 읽기 전용 기록으로 남는다. 열린 Linear issue는 옮기지 않는다(사용자 결정 2026-11-17).
  필요한 일이 생기면 그때 GitHub issue로 새로 만들고 본문에 옛 `EAT-N`을 적는다.

### 2. issue 연결은 가지 이름·커밋·PR이 한다

- 가지 이름은 `<type>/<N>-<slug>`(예: `chore/216-remove-linear`)다. N은 GitHub issue 번호다.
- 커밋 제목 끝이나 본문에 `#N`을 남긴다. 검사로 강제하지 않는다. 가지 이름이 이미 번호를 들고 있다.
- `pnpm workflow:pr`은 가지 이름에서 N을 읽어 PR 본문에 `Closes #N`을 넣는다. 병합되면 GitHub이 issue를
  닫으므로 따로 닫는 workflow를 두지 않는다. Linear 시절 `eat-N-…` 가지는 병합될 때까지 열 수 있고,
  본문에는 닫기 없이 `Linear 기록: EAT-N`만 남는다.
- 병합 판정은 그대로 pull request의 CI 하나다(ADR 0050).

### 3. 한 일에 한 writer는 잠금이 아니라 규칙으로 지킨다

- 한 issue·한 가지·한 worktree를 한 세션이 쓴다. 병렬 작업은 issue와 worktree를 나누고 owned path가
  겹치지 않게 issue 본문에 적는다. 다른 세션이 쓰는 worktree는 읽기·리뷰만 한다.
- 이 규칙을 hook으로 강제하지 않는다. 세션 잠금·claim·state 파일·outbox·`workflow:session`·
  `workflow:claim`·`workflow:release`·`workflow:sync`·`workflow:doctor`·`workflow:worktree`·`recover-lock`과
  Claude·Codex의 session hook을 삭제한다.

### 4. 남기는 장치

- `.githooks/pre-commit`: 변경 범위 architecture 검사만(ADR 0042). branch↔claim 검사는 없다.
- `.githooks/pre-push`: main 직접 push 거절과 선택적 AI advisory만(ADR 0050).
- `workflow:pr`·`workflow:tag`·`workflow:argo-smoke`.
- Web의 `@boundary-waiver` owner는 `#N`을 받는다. 옛 waiver의 `EAT-N`은 그 waiver를 지울 때까지 읽는다.

## Consequences

- Infisical·Linear key 없이 issue·커밋·PR이 된다. `gh` 로그인 하나면 된다.
- 같은 worktree를 두 세션이 동시에 쓰는 사고를 도구가 막지 않는다. 세션을 나누는 사람과 인계 절차
  ([`agent-resume.md`](../operations/agent-resume.md))가 막는다. 사고가 실제로 반복되면 그때 측정한 근거로
  다시 장치를 둔다.
- 메인 체크아웃은 이 변경이 병합된 커밋으로 fast-forward해야 로컬 session hook이 사라진다. hook 명령은
  `CLAUDE_PROJECT_DIR`(메인 체크아웃)의 `.claude/settings.json`을 따르기 때문이다.
- 지난 계획·spec·handoff·제품 결정 문서의 Linear 식별자는 기록이므로 고치지 않는다.
- GitHub Projects 보드의 자동 갱신(온누리의 push 이벤트 방식)은 이 결정에 넣지 않았다. 보드가 필요해지면
  따로 정한다.

## Rejected alternatives

- Linear를 남기고 GitHub 연동만 고치기: 연동이 붙어도 claim의 비밀 의존과 무료 한도, 두 곳의 상태가 어긋나는
  문제는 남는다. 이미 `close-issue.yml`로 메운 적이 있고 그것도 key가 없으면 조용히 통과했다.
- 세션 잠금만 남기기: 인계를 막은 것이 바로 잠금이었다. 잠금이 막는 사고(같은 worktree 동시 쓰기)는 세션을
  나눌 때 worktree를 나누는 규칙으로 더 싸게 막힌다.
- 커밋마다 `#N`을 pre-commit에서 강제하기: 가지 이름이 번호를 들고 있어 추적성은 이미 있다. 강제 검사는
  hotfix와 통합 커밋에 예외를 다시 만들게 된다.
