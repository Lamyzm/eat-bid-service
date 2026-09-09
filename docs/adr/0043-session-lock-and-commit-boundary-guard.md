# 0043 — agent workflow 가드: 세션 잠금과 commit 경계 검사

- Status: Accepted
- Date: 2026-09-10
- Supersedes: [2026-08-30 Linear agent workflow 설계](../superpowers/specs/2026-08-30-linear-agent-workflow-design.md)
  §4.1의 "명령 단위 mutation gate·read-only allowlist·lease writer 결박"과 §6의 "유일한 active worktree
  lease" 조항, [ADR 0026](0026-provider-neutral-ai-review-and-canonical-skills.md) 결정 3의 "lease 없이
  허용하는 도구 목록" 운영 방식. Linear를 소유권의 원천으로 두는 결정과 outbox·lock·state 격리 규칙은 그대로다.
- 관련 작업: EAT-123

## Context

2026-08-30부터 저장소 hook은 모든 도구 호출을 가로채 "검증된 Linear lease가 있는가"를 물었다. lease는
12시간 만료, 첫 mutation 세션에 대한 writer 결박, prompt에서 읽은 요청 issue, branch 식별자 대조를 함께
들고 있었고, shell 명령은 376줄의 정규식 분류기(`workflow.mjs`)와 인라인 interpreter 분류기
(`shell-read-only.mjs`), 저장소 경로 판정기(`repository-paths.mjs`)로 읽기·쓰기를 가렸다. 2026-09-09
하루 동안 이 구조가 만든 장애는 다음과 같다.

- **차단의 대부분이 소유권 충돌이 아니었다.** `2>&1`·`&&`·heredoc·변수 loop, `node -e` 안의 "git" 낱말,
  경로 토큰 `source`("runs a string through source"), `gh run view`, `Monitor`, Linear MCP 댓글이 모두
  "lease를 먼저 만들라"로 막혔다. 분류기는 명령의 뜻이 아니라 모양을 보므로 새 도구·새 명령마다
  fail-closed였고, 허용 목록은 문서 한 절을 다 채울 만큼 자랐다(`uniq`의 인자 수, `find`의 `-f` 술어까지).
- **교착이 구조적이었다.** `claim --branch`가 lease 확인보다 브랜치 전환을 먼저 해 브랜치는 새 issue,
  lease는 옛 issue가 되면 release 명령까지 막혔다. 만료·writer 충돌·prompt 오염(EAT-41)도 같은 문을
  잠갔다. 복구는 늘 "정확한 한 줄을 접두사 없이 실행"이었고, 그 한 줄을 사용자가 대신 쳐 주는 일이 생겼다.
- **비용이 도구 호출마다 들었다.** PreToolUse와 PostToolUse가 각각 node를 띄우고 mutation 판정마다
  `git rev-parse`·`git worktree list`를 세 번 실행한 뒤 lock directory를 만들고 지웠다.
- **커밋 메시지 검사가 줄 단위였다.** `(EAT-122, ADR 0014).`나 경로 나열 줄이 한글이 없다는 이유로
  거부돼 식별자를 억지로 문장에 넣어야 했다.

lease가 실제로 지키려던 것은 둘이다. 한 worktree를 두 세션이 동시에 쓰지 않는 것, 그리고 issue branch의
커밋이 그 issue를 claim한 작업에서만 나오는 것. 둘 다 명령 텍스트를 해석해야 지켜지는 규칙이 아니다.

## Decision

### 1. worktree는 세션 잠금(holder)으로 지킨다

- state의 worktree 항목에 `holder`(`provider`·`sessionId`·`pid`·`startedAt`·`lastSeenAt`·`endedAt`)를 둔다.
  SessionStart와 holder가 아닌 세션의 첫 쓰기 도구에서 잡고, 도구 호출마다 heartbeat를 60초 간격으로
  갱신한다.
- 생존 판정은 pid가 우선이다. Claude Code는 hook과 child 환경에 자기 pid(`CLAUDE_PID`)를 주므로 프로세스가
  있으면 살아 있다. 사용자 입력을 몇 시간 기다리는 세션을 heartbeat로 죽었다고 읽지 않기 위해서다.
  pid를 모르는 provider만 `sessionStaleMinutes`(30분) heartbeat로 판정한다. `SessionEnd`는 자기 잠금을
  끝내고, `pnpm workflow:session take`는 사람이 종료를 아는 세션의 잠금을 끝내 다음 세션이 잡게 한다.
- holder인 세션은 어떤 도구도 검사받지 않는다. 다른 살아 있는 세션이 잡은 worktree에서는 이름이 알려진
  읽기·탐색·대화 도구(Read·Glob·Grep·WebFetch·ToolSearch·EnterWorktree·SendMessage·Linear 조회 MCP 등)와
  단일 `pnpm workflow:*` 명령만 열리고 나머지는 차단된다. 이것이 유일한 도구 단위 판정이며 **도구
  이름**만 본다. 명령 본문·경로·MCP 인자는 해석하지 않는다.
- 사용자가 `!`로 직접 친 명령(`initiated_by: user`)은 잠금을 보지 않는다.

### 2. issue 연결은 commit·push 경계에서 검사한다

- `pnpm workflow:claim -- EAT-N [--branch <name>]`은 Linear에서 team·assignee·state를 검증해 `In Progress`로
  옮긴 뒤 브랜치를 만들거나 옮기고 worktree의 `claim`(`issueIdentifier`·`issueId`·`assigneeId`·`branch`·
  `claimedAt`·`verifiedAt`)을 기록한다. 만료는 없다. Linear가 거부하면 브랜치도 기록도 그대로다.
- `.githooks/pre-commit`은 `commit-guard.mjs pre-commit`으로 branch의 `EAT-N`과 worktree claim이 같은지
  network 없이 확인한 뒤 변경 범위 검사를 실행한다. 식별자가 없는 통합 branch(`main` 등)는 묻지 않는다.
  통합 merge commit은 pre-commit을 거치지 않고, 사람이 만드는 hotfix까지 claim을 요구하면 gate가 사람을
  막기 때문이다.
- pre-push는 push되는 issue branch마다 같은 검사를 하고, `LINEAR_API_KEY`가 있을 때만 Linear에 team·
  assignee·terminal 상태를 상태 변경 없이 재검증한다. key가 없으면 로컬 기록만 확인했다고 알린다. push마다
  secret 주입을 요구하면 모든 push가 wrapper 안에서만 가능해진다.
- `--no-verify`는 사람의 명시적 우회이며 CI와 리뷰가 같은 판정을 한다.

### 3. 명령 단위 가로채기와 그 분류기를 삭제한다

`workflow.mjs`의 shell·git·kubectl·curl·PowerShell·find·uniq 정규식, `shell-read-only.mjs`,
`repository-paths.mjs`, prompt의 요청 issue 추출과 `requestedIssue`·`activeIssue` 세션 기록, lease 만료와
writer 결박, pending claim을 모두 없앤다. Linear MCP 쓰기 도구, `Monitor`, `gh`, 테스트 실행은 holder
세션에서 자유롭다. 남는 hook 입력 계약은 event 이름, session id, 도구 이름, 편집 도구의 파일 경로,
`initiated_by`뿐이다.

### 4. claim은 대체하고 죽은 claim은 옮긴다

- 같은 worktree에 다른 issue의 claim이 있으면 release 없이 새 claim으로 대체하고 stderr에 알린다.
  이전 issue의 Linear 상태 정리는 사람이 한다. "release 뒤 claim" 순서 요구가 교착의 절반이었다.
- 같은 issue를 다른 worktree의 **살아 있는** 세션이 잡고 있으면 Linear를 부르기 전에 거부한다(한 work
  item에 한 writer, AGENTS 20). 그 세션이 죽었으면 그쪽 claim을 지우고 이 worktree로 옮긴다. release는
  claim만 지우고 세션 잠금은 남긴다. release한 세션은 여전히 그 worktree에 앉아 있다.

### 5. 커밋 설명 검사는 문단 단위다

요약은 계속 한국어여야 한다. 설명은 trailer·URL·코드 블록을 뺀 문장이 하나라도 있을 때 그중 한 줄에
한글이 있으면 통과한다. 식별자·경로 줄은 한국어 문장 옆에 놓인다.

### 6. hook은 읽기 우선이다

PreToolUse는 읽기 도구와 사용자 명령을 stdin 파싱 직후 끝내고, 나머지는 git을 실행하지 않고 `.git`
파일·`commondir`만 읽어 worktree root와 state 경로를 찾는다. 판정은 lock 없이 읽은 state로 먼저 하고
쓸 것이 있을 때만 transaction 안에서 다시 판정한다. Claude의 PostToolUse는 편집 도구 이름에만 걸리고
Codex 참고 계약은 그대로 `*`다. Claude만 `SessionEnd`를 추가로 연결한다.

## Consequences

- 세션이 막히는 경우는 하나다. 다른 살아 있는 세션이 같은 worktree를 잡고 있을 때. 메시지는 누가 언제부터
  잡았는지와 세션이 스스로 할 수 있는 복구(다른 worktree에서 시작, `workflow:session take`)를 말한다.
- issue 없는 커밋은 pre-commit이 막고, 잘못된 branch의 commit은 만들어지지 않는다. 대신 claim 없이 파일을
  편집하는 것 자체는 막지 않는다. 편집은 되돌릴 수 있고 커밋만 issue에 묶이면 추적성은 유지된다.
- `tools/agent-workflow`는 376줄 분류기와 두 보조 모듈, 그 테스트 1,100여 줄이 사라지고 `session.mjs`
  (110줄)·`commit-guard.mjs`(120줄)가 들어온다. state는 v2이며 v1의 `lease`는 읽을 때 `claim`으로
  옮겨지고 writer·pendingClaim·prompt 기록은 버려진다.
- 옛 hook을 가진 worktree(main을 합치기 전의 checkout)는 v2 state의 `claim`을 lease로 읽지 못해 쓰기가
  막힌다. main을 합치거나 새 세션으로 시작하면 풀린다.
- Codex처럼 pid를 주지 않는 provider는 crash 뒤 30분 동안 잠금이 남는다. `workflow:session take`가 그
  경우의 복구다.
- 이 결정은 저장소 파일을 지키는 gate를 좁힌 것이지 운영 장비를 지키는 gate가 아니다. `kubectl apply`·
  `infisical secrets set` 같은 운영 변경은 애초에 hook의 영역이 아니었고 AGENTS와 runbook의 승인 절차가
  계속 소유한다.

## Rejected alternatives

- 분류기를 고치고 허용 목록을 더 넓히기: 새 도구·새 명령마다 같은 실패가 반복되고, 잘못 막을 때마다 정규식
  하나가 늘어난다. 2026-09-09의 실패 일곱 건 중 여섯이 이미 허용 목록 조정 뒤에 난 것이다.
- 잠금을 두지 않고 commit 검사만 두기: 같은 worktree의 두 세션이 서로의 편집을 덮어쓰는 사고를 커밋
  시점에야 알게 된다. 잠금은 그 한 사고만 막는 가장 싼 장치다.
- heartbeat만으로 생존 판정: 사용자 입력을 기다리는 세션은 hook을 보내지 않아 30분 뒤 죽은 것이 된다.
  pid를 아는 provider에서는 pid가 정답이다.
- pid만으로 생존 판정: Codex는 pid를 주지 않는다. heartbeat는 그 fallback이다.
- 커밋마다 Linear 재검증: 커밋은 분 단위로 일어나고 key는 Infisical wrapper 안에만 있다. push가 원격에
  닿는 첫 시점이며 재검증은 거기서 선택적으로 한다.
- 커밋 설명의 줄 단위 한국어 유지: 식별자와 경로를 문장으로 늘리는 것은 규칙 21이 금지하는 "설명 본문
  영문화"의 반대 방향 장식일 뿐이다.
