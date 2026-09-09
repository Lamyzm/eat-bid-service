---
status: active
last_reviewed: 2026-09-10
review_trigger: linear-workflow-or-agent-hook-change
---

# Linear 기반 Agent Workflow 운영

## 1. 최초 한 번 구성

Linear workspace에 eatbid team 하나를 만들고 team key를 `EAT`로 정한다. 다른 key를 이미 쓰고
있다면 `tools/agent-workflow/config.json`의 `teamKey`를 같은 변경에서 명시적으로 바꾼다.

Workflow status는 다음 이름을 사용한다.

```text
Backlog → Ready → In Progress → In Review → Done
                         ↘ Blocked
```

최소 label은 다음과 같다.

- 규모: `S`, `M`, `L`
- 유형: `Discovery`, `Delivery`, `Debt`, `Ops`
- roadmap: `R0`~`R5`
- 영향: `architecture`, `data-model`, `runtime`, `product`, `research`

Issue template에는 `문제 | outcome | scope | non-goals | acceptance | evidence/unknown | 검증 계획 |
관련 링크`를 둔다. owner, priority, status, blocker는 Markdown 문서나 GitHub Issue에 복사하지 않는다.

## 2. Claude Code 연결

저장소의 `.mcp.json`이 공식 Linear MCP endpoint를 공유한다. 이 파일에는 token이 없다.

1. 저장소 루트에서 Claude Code를 시작한다.
2. project MCP 승인을 확인한다.
3. `/mcp`에서 `linear`를 선택하고 OAuth를 완료한다.
4. `claude mcp get linear`가 `Connected`인지 확인한다.

`.claude/settings.json`의 project hooks는 별도 설치 없이 공통 Node runner
`tools/agent-workflow/hook.mjs`를 SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·Stop·SessionEnd에
연결한다. 실행 중 settings를 추가한 경우 새 session을 시작해 `/hooks`에서 project hook을 확인한다.

## 3. Codex 연결

Codex의 MCP 설정은 사용자 config이므로 저장소에 token이나 사용자 경로를 커밋하지 않는다.

```powershell
codex mcp add linear --url https://mcp.linear.app/mcp
codex mcp login linear
codex mcp list
```

이미 `linear`가 등록돼 있으면 첫 명령은 생략한다. `Auth`가 `Authenticated`가 될 때까지 OAuth를
완료한다.

현재 검증한 Codex CLI `0.138.0`은 저장소의 `.codex/hooks.json`을 project hook으로 읽지 않고
`$CODEX_HOME/hooks.json`만 읽는다. 저장소의 `.codex/hooks.example.json`은 참고 계약이며 자동 강제를
주장하지 않는다. 사용자 전역 hook에 병합하기 전에는 Codex가 변경 직전 `workflow:doctor`와
`workflow:claim`을 명시적으로 실행해야 한다. 전역 파일은 다른 저장소 hook도 포함하므로 자동으로
덮어쓰지 않는다. Claude Code project hook은 저장소 설정으로 강제된다. Codex는 세션 pid를 hook에 주지
않으므로 세션 잠금의 생존 판정이 heartbeat(30분)로 내려간다(4.2절).

## 4. claim, 세션 잠금, commit 검사

가드는 셋으로 나뉜다(ADR 0043). 무엇이 어디서 검사되는지 먼저 적는다.

| 지키는 것 | 시점 | 판정 근거 | 실패 시 |
| --- | --- | --- | --- |
| 한 worktree를 한 세션만 쓴다 | 도구 호출(PreToolUse) | worktree의 세션 잠금(holder) | 다른 살아 있는 세션이면 쓰기 도구 차단 |
| issue branch의 커밋은 claim한 작업에서만 나온다 | `git commit` | branch의 `EAT-N` ↔ worktree claim | 커밋 거부 |
| push되는 branch의 소유권이 Linear와 맞다 | `git push` | 같은 검사 + key가 있으면 Linear 재검증 | 어긋나면 push 거부, key 없으면 알림만 |

hook은 명령 본문을 해석하지 않는다. `git commit`, `rm`, `kubectl`, 테스트 실행, Linear MCP 쓰기 도구는
holder 세션에서 자유롭고, 그 결과가 저장소에 남는지는 commit·push 검사와 CI가 판정한다.

### 4.1 claim

MCP는 agent가 issue를 읽고 수정하는 대화형 경로다. commit 검사는 issue처럼 보이는 문자열을 신뢰하지
않는다. Infisical이 `dev:/tooling/linear`의 API key를 대상 child process에만 주입하고 claim command로
issue 존재, `EAT` team, assignee와 claim 가능한 state를 검증한다.

```powershell
pnpm workflow:claim -- EAT-123
pnpm workflow:claim -- EAT-123 --branch codex/eat-123-slug
pnpm workflow:doctor:infisical
```

claim은 다음 순서로 진행한다.

1. `--branch` 이름이나 현재 branch의 `EAT-N`이 요청 issue와 다르면 아무것도 하지 않고 실패한다.
2. 같은 issue를 다른 worktree의 **살아 있는** 세션이 잡고 있으면 Linear를 부르기 전에 실패한다.
   그 세션이 죽었거나 끝났으면 그쪽 claim은 이 worktree로 옮겨진다.
3. Linear에서 issue가 비어 있으면 현재 사용자를 assignee로 지정하고 config
   `claimableStates`(`Backlog | Ready | Todo | In Review | In Progress`) 어디서든 `In Progress`로 옮긴다.
   `terminalStates`(`Done | Canceled | Duplicate`)와 목록에 없는 상태, 다른 assignee, 다른 team은 추측으로
   바꾸지 않고 실패한다. 여기서 실패하면 branch도 local 기록도 그대로다.
4. `--branch <name>`이 있으면 브랜치가 없을 때 현재 HEAD에서 만들고 있으면 checkout한다. 미커밋 변경이
   있으면 다른 작업 결과를 삼키지 않도록 ref를 만들기 전에 실패한다. Linear는 이미 `In Progress`이므로
   정리한 뒤 같은 명령을 다시 실행하면 그대로 이어진다.
5. worktree의 claim(`issueIdentifier`·`issueId`·`assigneeId`·`branch`·`claimedAt`·`verifiedAt`)을
   기록한다. **만료는 없다.** 같은 worktree에 다른 issue의 claim이 있으면 release 없이 대체하고 stderr에
   알린다. 대체된 issue의 Linear 상태는 사람이 정리한다.

키를 `.env`, Claude/Codex settings, shell script, 사용자 전역 환경변수에 넣지 않는다. 저장소의
Infisical wrapper는 parent process의 `LINEAR_API_KEY`를 이름만 확인해 child environment에서 제거한
뒤 Infisical을 실행하므로, 누락된 Infisical 값이 우연히 상속된 key로 대체되지 않는다.
`--secret-overriding=false`는 inherited environment 제어가 아니라 같은 이름의 personal secret보다
project shared secret을 우선하도록 고정하는 옵션이다.

API key가 없거나 Linear가 중단되면 새 claim은 실패한다. 이미 기록된 claim으로는 계속 커밋할 수 있고
worklog event는 linked worktree들이 공유하는 Git common dir의 `eatbid-agent-workflow/state.json` outbox에
남는다. network 복구 후 `pnpm workflow:sync`를 실행한다.

### 4.2 세션 잠금

세션 하나가 worktree 하나를 잡는다. hook은 세션 cwd로 worktree root를 계산하고(git을 실행하지 않고
`.git` 파일과 `commondir`만 읽는다) SessionStart와 첫 쓰기 도구에서 잠금을 잡은 뒤 도구 호출마다 60초
간격으로 heartbeat를 남긴다.

- holder인 세션은 어떤 도구도 검사받지 않는다.
- 다른 세션이 잡은 worktree에서는 그 세션이 살아 있으면 읽기·탐색·대화 도구(Read·Glob·Grep·WebFetch·
  WebSearch·ToolSearch·EnterWorktree·ExitWorktree·SendMessage·ListAgents·AskUserQuestion·Linear
  `get_* | list_* | search_*`)와 chaining·redirect 없는 단일 `pnpm workflow:*` 명령만 열리고 나머지 도구는
  차단된다. 이 판정은 도구 **이름**만 본다.
- 살아 있음의 근거는 pid가 우선이다. Claude Code는 hook과 child 환경에 자기 pid(`CLAUDE_PID`)를 주므로
  프로세스가 있으면 살아 있다. 사용자 입력을 몇 시간 기다리는 세션도 살아 있는 세션이다. pid를 모르는
  provider(Codex)만 마지막 heartbeat가 `sessionStaleMinutes`(30분) 안일 때 살아 있다고 본다.
- 죽었거나 끝난 세션의 잠금은 다음 쓰기 도구가 자동으로 넘겨받고 `systemMessage`로 알린다. Claude의
  `SessionEnd`가 잠금을 끝내며, Codex처럼 그 event가 없으면 heartbeat 만료가 대신한다.
- 사용자가 `!`로 직접 친 명령(`initiated_by: user`)은 잠금을 보지 않는다.

차단 메시지는 누가 언제부터 잡고 있는지와 두 가지 복구를 말한다. EnterWorktree로 새 worktree에서
시작하거나, 그 세션이 끝난 것이 확실하면 다음을 실행한다.

```powershell
pnpm workflow:session take
pnpm workflow:session take -- --worktree .worktrees/eat-36-decision-shell
```

`take`는 현재 holder를 끝난 것으로 표시할 뿐이며 다음에 쓰는 세션이 잠금을 잡는다. 살아 있는 세션의
잠금을 빼앗으면 그 세션의 다음 쓰기가 같은 메시지로 막히므로, 두 세션이 한 worktree를 번갈아 잡는 상태는
사람이 한쪽을 닫아 끝낸다.

### 4.3 commit·push 검사

`.githooks/pre-commit`은 변경 범위 검사보다 먼저 `tools/agent-workflow/commit-guard.mjs pre-commit`을
실행한다. branch 이름의 `EAT-N`과 이 worktree의 claim이 같아야 커밋이 만들어지고, network는 쓰지 않는다.
식별자가 없는 branch(`main` 같은 통합 branch)는 검사하지 않는다. 통합 merge commit은 pre-commit을 거치지
않으며, 사람이 직접 만드는 hotfix까지 claim을 요구하면 gate가 사람을 막기 때문이다.

```text
eatbid pre-commit: branch codex/eat-124-next는 EAT-124 작업인데 이 worktree에 claim이 없습니다. `pnpm workflow:claim -- EAT-124`를 실행한 뒤 다시 커밋하세요.
eatbid pre-commit: branch는 EAT-124, 이 worktree의 claim은 EAT-123입니다. `pnpm workflow:claim -- EAT-124`로 claim을 바꾸거나 EAT-123 branch로 옮기세요.
```

pre-push(`tools/review/pre-push.mjs`)는 테스트보다 먼저 push되는 issue branch마다 같은 검사를 한다.
`LINEAR_API_KEY`가 환경에 있으면 team·assignee·terminal 상태를 상태 변경 없이 Linear에 재검증하고, 없으면
로컬 기록(`verifiedAt`)만 확인했다고 알린다. 보통의 push는 wrapper 밖에서 실행되므로 후자가 기본이다.
`--no-verify`는 사람의 명시적 우회이며 CI와 리뷰가 같은 판정을 한다.

### 4.4 worktree 단위 claim과 `--worktree`

claim과 세션 잠금은 worktree root 단위다. 세션 하나는 worktree 하나만 소유하고, 다른 worktree의 파일을
절대 경로로 고치지 않는다. 기본 디렉터리는 통합(main fast-forward)과 release에만 쓰고 구현은
`.worktrees/<issue-slug>`에서 한다. worktree 이동은 EnterWorktree/ExitWorktree 도구나 새 세션으로 한다.

lifecycle 명령은 `--worktree <path>`로 세션 cwd와 다른 worktree를 대상으로 삼는다. 경로는 cwd 기준
상대 경로나 절대 경로이며, 존재하지 않거나 git worktree가 아니면 claim을 건드리지 않고 실패한다.
경로에 들어 있는 `eat-9` 같은 문자열은 issue로 해석하지 않는다.

```powershell
pnpm workflow:claim -- EAT-27 --worktree .worktrees/eat-27-agent-worktree-lease
pnpm workflow:doctor -- --worktree ../..
pnpm workflow:release -- --worktree F:\Project\eat-bid-service
```

release는 claim만 지우고 세션 잠금은 남긴다. release한 세션은 여전히 그 worktree에 앉아 있기 때문이다.
issue 식별자로도 할 수 있으며, worktree 디렉터리를 먼저 지워 claim만 남은 유령 claim은 그 경로로 푼다.
식별자와 `--worktree`를 같이 주면 모호해서 거부한다.

```powershell
pnpm workflow:release -- EAT-36
```

worktree를 없앨 때는 claim 해제와 `git worktree remove`를 한 명령으로 묶은 `workflow:worktree`를 쓴다.
`remove`는 git이 dirty worktree를 거부하면 claim도 건드리지 않고, 디렉터리가 이미 없으면
`git worktree prune`으로 대신한다. `prune`은 디렉터리가 사라진 모든 worktree의 git 등록과 state 항목을
함께 정리한다. 두 명령 모두 Stop되지 않은 session의 변경 경로를 worklog로 먼저 확정한다.

```powershell
pnpm workflow:worktree remove .worktrees/eat-36-decision-shell
pnpm workflow:worktree prune
```

새 worktree에서 시작하는 순서는 다음과 같다.

1. EnterWorktree 도구로 진입하거나 `git worktree add .worktrees/<slug> -b <slug> main`을 만든 뒤 새
   세션을 그 안에서 시작한다. 세션이 그 worktree의 잠금을 잡는다.
2. 그 worktree 안에서 `pnpm workflow:claim -- EAT-123`을 실행한다.
3. 작업 뒤 같은 worktree에서 `workflow:sync`와 `workflow:release`를 실행한다.

`release`는 기본적으로 Linear 상태를 바꾸지 않는다. 자동으로 `In Review`로 보내면 같은 worktree를
다시 claim할 때마다 상태를 되돌려야 하고, 그 전환이 막히면 이슈 전환 자체가 교착하기 때문이다.
리뷰를 요청할 때만 `--review`를 명시하며, 이때는 claim을 지우기 전에 Linear를 먼저 옮겨 실패해도 같은
명령을 그대로 다시 실행할 수 있다. `--review`만 Linear API key가 필요하므로 그 경로만
`workflow:release:review`로 Infisical wrapper를 거친다. Infisical wrapper는 `release --review`가 아닌
release는 계속 거부해 오프라인 release가 secret 주입 경로를 열지 않게 한다.

```powershell
pnpm workflow:release
pnpm workflow:release:review
pnpm workflow:release:review -- EAT-36
```

## 5. issue는 agent가 발행하고 읽는다

새 작업을 시작할 때 사람이 Linear에 issue를 대신 만들어 주기를 기다리지 않는다. `workflow:issue`가
`dev:/tooling/linear`의 API key를 주입해 `EAT` team에 issue를 만들고 식별자와 URL만 출력한다.
MCP 연결이 없는 세션도 `workflow:issues`로 백로그를 읽고 고를 수 있다.

```powershell
pnpm workflow:issues
pnpm workflow:issues -- --state Backlog
pnpm workflow:issues -- --limit 10
```

목록은 식별자·상태·우선순위·제목·최종 수정 시각을 JSON으로 낸다. 한 번에 40건까지 읽으며 이 상한은
Linear GraphQL 요청 복잡도 제한에서 온다. 기본 목록은 `Done`·`Canceled`·`Duplicate`를 빼서 지금 고를 수
있는 것만 담고, 끝난 issue는 `--state Done`처럼 상태를 명시해서 본다.

```powershell
pnpm workflow:issue create -- --title "eaT 명단을 정규화 모델로 읽는다"
pnpm workflow:issue create -- --title "제목" --priority 2 --state Backlog
pnpm workflow:issue create -- --title "제목" --description-file .superpowers/eat-53-body.md
pnpm workflow:issue create -- --title "제목" --project "다른 project"
```

- `--title`만 필수다. `--state`는 기본 `Ready`, `--project`는 기본 `R1 — 유료 투찰 Decision Loop`이며
  두 기본값은 `tools/agent-workflow/config.json`의 `issueDefaultState`와 `defaultProject`가 소유한다.
- `--priority`는 Linear 값 그대로 `1`(Urgent)부터 `4`(Low)까지만 받는다. "없음"은 triage를 다시
  사람에게 미루는 값이라 받지 않는다.
- 본문은 여러 줄 한국어가 대부분이므로 `--description-file <path>`를 기본 경로로 쓴다. 한 줄짜리에만
  `--description`을 쓴다. 이 명령은 읽은 내용을 그대로 Linear로 보내므로 본문 파일은 현재 worktree·
  workflow state 디렉터리·임시 디렉터리 안에 있을 때만 읽는다. 그 밖의 경로는 읽지 않고 거부한다.
  제한이 없으면 `--description-file`이 로컬 비밀 파일을 외부 서비스로 올리는 한 줄이 된다.
- state나 project 이름을 해소하지 못하면 그 자리를 비운 채 발행하지 않고 후보 목록과 함께 실패한다.
  triage에도 roadmap에도 걸리지 않는 issue가 조용히 생기는 쪽이 더 나쁘기 때문이다.
- 발행 뒤 `pnpm workflow:claim -- EAT-N`으로 소유권을 확정한다.
- 다음 절 0번의 중복 확인은 그대로 유효하다. 발행이 쉬워졌다고 기존 issue를 훑지 않고 새로 만들면
  추적이 갈라진다.

Linear MCP가 연결돼 있으면 issue 생성·댓글·상태 전환 도구도 holder 세션에서 그대로 쓴다. 상태 전환의
기본 경로는 여전히 `claim`(`In Progress`)과 `release --review`(`In Review`)이며, MCP로 옮긴 상태는 다음
claim이 그대로 읽는다.

사람 몫으로 남는 것은 Linear workspace 계정과 team 구성, 그리고 `LINEAR_API_KEY` 발급·회전뿐이다.

## 6. 일상 사용

0. **새 issue를 만들기 전에 기존 issue를 먼저 훑는다.** `list_issues`로 team 전체를 확인하고, 하려는 일이
   이미 issue와 계획 문서를 갖고 있는지 본다. Backlog에 상위 설계 issue가 있고 그 아래 실행 issue가
   달려 있는 경우가 많다. 조사 결과가 아무리 새로워도 중복 issue를 만들면 추적이 갈라지고 이미 정해진
   결정을 다시 정하게 된다.
1. Linear issue에서 scope와 acceptance를 확정하고 `workflow:claim`으로 owner와 state를 검증한다.
   issue에 계획 문서가 연결돼 있으면 임의로 다른 순서를 만들지 말고 그 문서를 따른다.
2. branch 이름에 claim한 issue identifier를 넣는다. 예: `codex/eat-123-auction-workspace`. 커밋은 이
   식별자와 worktree claim이 같을 때만 만들어진다. prompt의 issue 번호는 어떤 판정에도 쓰지 않는다.
3. 편집·테스트·조사는 holder 세션에서 자유롭다. 다른 세션이 잡은 worktree는 읽기만 한다.
4. 작업 turn 뒤 `workflow:sync`로 worklog를 전송한다.
5. PR 제목이나 본문에 Linear identifier를 넣고 acceptance별 evidence를 PR에 남긴다.
6. GitHub/Linear integration을 설치·검증한 경우에만 PR 생성 시 `In Review`, 병합 시 `Done`을
   자동화한다. 설치 전에는 사람이 같은 전환을 수행한다.
7. 작업을 끝내면 issue 상태를 직접 옮긴다. `claim`은 `In Progress`까지만 옮기고 `release`는 기본적으로
   상태를 바꾸지 않으므로, 방치하면 끝난 작업이 계속 `In Progress`로 쌓인다. 중복으로 만든 issue는 `Canceled`로
   닫고 원래 issue에 `duplicateOf`로 연결한 뒤, 얻은 사실과 이미 적용된 변경을 그쪽 worklog에 옮긴다.

AI가 답변에서 완료를 주장했다는 이유만으로 hook이 `Done`으로 이동시키지 않는다.

`workflow:release`는 아직 Stop되지 않은 session 경로를 원래 issue의 local worklog로 먼저 확정한
뒤 claim을 해제한다. 따라서 release 뒤 `workflow:sync`를 실행해 남은 worklog를 전송한다. worklog는
편집 도구(Edit·Write·MultiEdit·NotebookEdit·apply_patch)가 바꾼 저장소 안 경로만 담는다. shell로 바꾼
파일은 PR diff에서 읽는다.

세션 잠금은 하나의 Git common dir을 공유하는 local worktree 범위다. 서로 다른 clone이나 host 사이의
원자적 global lock을 의미하지 않는다. cross-machine 작업은 Linear assignee와 명시적 handoff로 한 명만
쓰기 상태를 유지하며, 중앙 backend가 도입되기 전에는 동시에 claim하지 않는다.

## 7. Codex와 Claude 사이 작업 인계

모델 교대는 새 작업을 시작하는 행위가 아니라 같은 Linear issue의 writing owner를 순차적으로
이전하는 행위다. 대화 요약이나 도구별 memory를 완료 상태의 근거로 사용하지 않는다.

현재 작업의 재개 진입점과 비정상 종료·미커밋 변경·실행 중 자식 시험의 처리 순서는
[`agent-resume.md`](agent-resume.md)를 따른다. 아래 clean 인계는 정상 종료 절차이며,
갑작스러운 종료에서 clean을 만들려고 미커밋 변경을 버려서는 안 된다.

보내는 세션은 다음 순서를 지킨다.

1. 허용된 owned path만 포함한 검토 가능한 commit을 만들고 working tree를 clean하게 만든다.
2. issue acceptance와 직접 연결되는 검증 명령, 통과·실패 결과, 미완료 항목, 외부 mutation 여부를
   worklog에 남긴다. 단순히 "테스트 통과"라고 쓰지 말고 실행한 명령과 범위를 적는다.
3. 다음 세션이 시작할 commit과 worktree, 이어서 수행할 첫 단계, 금지된 외부 작업을 명시한다.
4. `pnpm workflow:sync`로 worklog를 Linear에 전송하고 `pnpm workflow:release`로 현재 claim을
   해제한 뒤 다시 `pnpm workflow:sync`한다. 세션을 끝내면 잠금도 함께 풀린다.

공유 outbox에 다른 작업의 오래된 이벤트가 섞였다고 확인된 경우에는 전체 sync를 실행하지 않는다.
해당 issue의 handoff만 연결된 Linear 도구로 기록하고 기존 `workflow:release`를 사용한다.
미전송 이벤트는 보존하며 state/outbox 파일을 직접 고치지 않는다.

받는 세션은 다음 순서를 지킨다.

1. `AGENTS.md`와 이 문서의 읽기 순서를 따른 뒤 Linear issue의 최신 scope·acceptance·worklog를 읽는다.
2. 지정된 commit, branch, worktree와 clean 상태를 확인한다. 일치하지 않으면 쓰지 않고 차이를 먼저
   보고한다.
3. 받는 세션이 그 worktree 안에서 직접 `pnpm workflow:claim -- EAT-123`을 실행해 claim을 자기 기록으로
   만든 뒤에만 커밋한다. 이전 세션이 살아 있으면 세션 잠금이 쓰기를 막으므로 먼저 그 세션을 닫는다.
4. 계획을 쓰기 전에 옮기거나 import를 바꿀 파일이 변경 범위 규칙의 대상인지 확인한다. 건드리지 않은
   legacy 파일은 검사하지 않지만, `apps/web/src/hooks`·`lib`의 기존 파일이나 canonical 층의 legacy import를
   수정하는 순간 옮겨야 하고 production 모듈을 수정하면 `@module 책임:` 설명을 넣어야 하므로(ADR 0042)
   그 비용을 계획에 넣는다.
5. 이전 세션이 완료했다고 적은 작업을 다시 구현하지 않는다. 다만 검증 결과를 신뢰로 대체하지 않고,
   변경할 경계의 관련 gate는 새 세션에서도 다시 실행한다.
6. 구현자와 최종 reviewer를 가능하면 다른 세션이나 모델로 분리한다. reviewer는 수정하지 않고
   정확한 파일·줄·재현 근거와 `APPROVE | NEEDS_FIXES` 판정만 남긴다.

복사 가능한 인계 본문은 아래 최소 필드를 사용한다. 이 본문은 Linear worklog에만 기록하며 별도
Markdown task board나 도구별 progress 파일을 현재 상태의 권위로 만들지 않는다.

```text
issue: EAT-123
branch/worktree: <branch> · <absolute worktree>
start commit: <검토가 끝난 commit>
완료: <acceptance와 연결된 결과>
검증: <명령> → <결과>
미완료/첫 단계: <다음 한 단계>
금지: <승인 없는 deploy·tag·live DB 등>
알려진 위험: <deferred finding 또는 없음>
```

## 8. 진단과 복구

```powershell
pnpm workflow:test
pnpm workflow:doctor
pnpm workflow:recover-lock
claude mcp get linear
codex mcp list
```

`doctor`는 branch, claim(issue·branch·claimedAt·verifiedAt), holder(provider·sessionId·pid·lastSeenAt·
live), 두 lock, outbox 수를 보고한다. writer session의 prompt 흔적은 담지 않는다.

차단은 사용자에게 명령을 대신 쳐 달라고 부탁해서 푸는 것이 아니라 세션이 스스로 푼다.

- **다른 세션이 worktree를 잡고 있다.** 메시지의 holder가 실제로 살아 있으면(사용자가 두 세션을 같은
  폴더에서 열었을 때가 대부분이다) 한쪽을 닫거나 EnterWorktree로 새 worktree에서 시작한다. 끝난 것이
  확실하면 `pnpm workflow:session take`를 실행하고 다시 시도한다. Codex 세션은 crash 뒤 30분까지 살아
  있는 것으로 보이므로 그동안은 `take`가 복구다.
- **커밋이 claim 검사에 막힌다.** 메시지의 `pnpm workflow:claim -- EAT-N`을 그대로 실행한다. claim은
  이전 claim을 대체하므로 release를 먼저 할 필요가 없다. 의도한 issue가 branch와 다르면 branch를 옮긴다.
- **claim이 "is being written in <worktree>"로 실패한다.** 그 worktree의 세션이 살아 있다. 그쪽에서
  계속하거나 그 세션을 닫은 뒤 다시 claim한다.
- worktree 디렉터리를 지웠는데 claim이 남아 있으면 `pnpm workflow:release -- EAT-N` 또는
  `pnpm workflow:worktree prune`으로 정리한다. worktree를 없앨 때는 처음부터
  `pnpm workflow:worktree remove <path>`를 써서 유령 claim을 만들지 않는다.
- `pnpm workflow:doctor`의 `worktreeRoot`가 세션 cwd의 worktree인지 확인한다. claim이 다른 worktree에
  있으면 `--worktree`나 issue 식별자로 다룬다. 세션 cwd를 `cd`로 옮겨 풀지 않는다.
- outbox가 쌓이면 API key와 network를 확인한다. state 파일을 수기로 편집해 event를 지우지 않는다.
- worklog comment에는 event marker가 포함되며 sync는 marker를 먼저 확인한다. comment 성공 뒤 local
  acknowledgement 전에 중단돼도 같은 event를 중복 게시하지 않는다.
- 비정상 종료 뒤 doctor가 stale state 또는 sync lock을 보고하면 먼저 owner PID가 종료됐는지
  확인하고 `workflow:recover-lock`을 실행한다. 명령은 두 lock을 각각 검사해 살아 있는 owner를
  거부하고 stale lock directory만 `.recovered-<timestamp>`로 격리한다. lock을 수기로 삭제하지 않는다.
- state JSON이 손상되면 runner가 같은 디렉터리에 `.corrupt-<timestamp>`로 격리하고 쓰기를
  fail-closed한다. 원본과 quarantine을 검토하기 전 빈 state를 만들지 않는다. v1 state(`lease`)는 읽을 때
  `claim`으로 옮겨지며 writer·pendingClaim·prompt 기록은 버려진다. ADR 0043 이전 hook을 가진 worktree는
  v2 state의 claim을 읽지 못해 쓰기가 막히므로 main을 합치거나 새 세션으로 시작한다.
- hook을 일시적으로 우회해 작업 상태를 다른 곳에 기록하지 않는다. 장애가 길어지면 Linear issue에
  복구 후 반영할 범위와 blocker를 사람이 결정한다.
