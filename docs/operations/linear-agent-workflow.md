---
status: active
last_reviewed: 2026-09-05
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

`.claude/settings.json`의 project hooks는 별도 설치 없이 공통 Node runner를 호출한다. 실행 중
settings를 추가한 경우 새 session을 시작해 `/hooks`에서 project hook을 확인한다.

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
덮어쓰지 않는다. Claude Code project hook은 저장소 설정으로 강제된다.

## 4. 검증 claim과 deterministic hook

MCP는 agent가 issue를 읽고 수정하는 대화형 경로다. mutation gate는 issue처럼 보이는 문자열을
신뢰하지 않는다. Infisical이 `dev:/tooling/linear`의 API key를 대상 child process에만 주입하고
claim command로 issue 존재, `EAT` team, assignee와 claim 가능한 state를 검증한다.

```powershell
pnpm workflow:claim -- EAT-123
pnpm workflow:claim -- EAT-123 --branch eat-123-slug
pnpm workflow:doctor:infisical
```

`--branch <name>`은 claim 대상 worktree를 그 브랜치로 먼저 옮긴 뒤 claim한다. 브랜치가 없으면 현재
HEAD에서 만들고, 이미 있으면 checkout만 한다. 미커밋 변경이 있으면 다른 작업 결과를 삼키지 않도록
ref를 만들기 전에 실패하므로 먼저 commit하거나 정리한다.

키를 `.env`, Claude/Codex settings, shell script, 사용자 전역 환경변수에 넣지 않는다. 저장소의
Infisical wrapper는 parent process의 `LINEAR_API_KEY`를 이름만 확인해 child environment에서 제거한
뒤 Infisical을 실행하므로, 누락된 Infisical 값이 우연히 상속된 key로 대체되지 않는다.
`--secret-overriding=false`는 inherited environment 제어가 아니라 같은 이름의 personal secret보다
project shared secret을 우선하도록 고정하는 옵션이다.

claim은 local pending reservation을 먼저 기록한 뒤 issue가 비어 있으면 현재 사용자를 assignee로
지정하고 config `claimableStates`(`Backlog | Ready | Todo | In Review | In Progress`) 어디서든
`In Progress`로 옮기며, 검증 성공 후 12시간 lease로 확정한다. 상태 전환은 사람이 미리 맞춰 둘 일이
아니라 이 명령의 책임이다. `terminalStates`(`Done | Canceled | Duplicate`)와 목록에 없는 상태는
완료를 되돌리거나 추측하지 않도록 실패한다. 중단돼
pending claim이 남으면 같은 identifier로 claim을 다시 실행해 멱등하게 확정한다. 같은 local Git
common dir에서 같은 issue의 다른 worktree lease나
현재 worktree의 다른 issue lease가 살아 있으면 먼저 release하도록 실패한다. 첫 mutation의
Codex/Claude session이 writer로
결박되고 다른 session은 명시적인 release와 재claim 전까지 쓰지 못한다. 다른 assignee와 다른 team은
추측으로 바꾸지 않고 실패한다. 재claim은 만료를 갱신하고 writer 결박을 새 세션으로 옮기므로
만료·branch 불일치·writer 충돌의 공통 복구 명령이다.

API key가 없거나 Linear가 중단되면 새 claim은 실패한다. 이미 검증한 미만료 lease에서는 작업을
계속할 수 있고 event는 linked worktree들이 공유하는 Git common dir의
`eatbid-agent-workflow/state.json` outbox에 남는다.
network 복구 후 전용 terminal에서 다음을 실행한다.

```powershell
pnpm workflow:sync
pnpm workflow:release
```

### worktree 단위 lease와 `--worktree`

lease는 worktree root 단위이고 hook은 세션 cwd로 root를 계산한다. 따라서 세션 하나는 worktree 하나만
소유하고, 다른 worktree의 파일을 절대 경로로 고치지 않는다. 기본 디렉터리는 통합(main fast-forward)과
release에만 쓰고 구현은 `.worktrees/<issue-slug>`에서 한다. 세션 cwd를 `cd`로 다른 worktree로 옮기면
그 worktree의 lease가 없어 되돌아오는 명령까지 막히므로 worktree 이동은 EnterWorktree/ExitWorktree
도구나 새 세션으로 한다.

lifecycle 명령은 `--worktree <path>`로 세션 cwd와 다른 worktree를 대상으로 삼는다. 경로는 cwd 기준
상대 경로나 절대 경로이며, 존재하지 않거나 git worktree가 아니면 lease를 건드리지 않고 실패한다.
경로에 들어 있는 `eat-9` 같은 문자열은 issue로 해석하지 않는다.

```powershell
pnpm workflow:claim -- EAT-27 --worktree .worktrees/eat-27-agent-worktree-lease
pnpm workflow:doctor -- --worktree ../..
pnpm workflow:release -- --worktree F:\Project\eat-bid-service
```

release는 issue 식별자로도 할 수 있다. `--worktree`는 경로가 실제 git worktree일 때만 동작하므로,
worktree 디렉터리를 먼저 지워 lease만 남은 유령 lease는 issue 식별자로 푼다. 같은 issue의 pending
claim도 함께 지우며, 식별자와 `--worktree`를 같이 주면 모호해서 거부한다.

```powershell
pnpm workflow:release -- EAT-36
```

worktree를 없앨 때는 lease 해제와 `git worktree remove`를 한 명령으로 묶은 `workflow:worktree`를 쓴다.
`remove`는 git이 dirty worktree를 거부하면 lease도 건드리지 않고, 디렉터리가 이미 없으면
`git worktree prune`으로 대신한다. `prune`은 디렉터리가 사라진 모든 worktree의 git 등록과 state 항목을
함께 정리한다. 두 명령 모두 Stop되지 않은 session의 변경 경로를 worklog로 먼저 확정한다.

```powershell
pnpm workflow:worktree remove .worktrees/eat-36-decision-shell
pnpm workflow:worktree prune
```

새 worktree에서 시작하는 순서는 다음과 같다.

1. EnterWorktree 도구로 진입하거나 `git worktree add .worktrees/<slug> -b <slug> main`을 만든 뒤 새
   세션을 그 안에서 시작한다. worktree 추가와 branch 생성은 lease 없이 허용한다.
2. 그 worktree 안에서 `pnpm workflow:claim -- EAT-123`을 실행한다. hook은 이 명령과
   EnterWorktree/ExitWorktree, `git worktree list|prune`, `git -C <path> status|diff|log|show|rev-parse`를
   lease 없이 허용하므로 사용자가 대신 실행할 필요가 없다.
3. 작업 뒤 같은 worktree에서 `workflow:sync`와 `workflow:release`를 실행한다. 기본 디렉터리에 lease가
   남아 있으면 `--worktree`나 issue 식별자로 푼다.

`release`는 lease와 함께 그 worktree의 session issue 기록(`requestedIssue`·`activeIssue`)을 지운다.
그래서 같은 세션이 사용자 prompt 없이 다음 issue를 claim해 이어서 작업할 수 있다.

`release`는 기본적으로 Linear 상태를 바꾸지 않는다. 자동으로 `In Review`로 보내면 같은 worktree를
다시 claim할 때마다 상태를 되돌려야 하고, 그 전환이 막히면 이슈 전환 자체가 교착하기 때문이다.
리뷰를 요청할 때만 `--review`를 명시하며, 이때는 lease를 지우기 전에 Linear를 먼저 옮겨 실패해도 같은
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
  `--description`을 쓴다. 이 명령은 lease 없이 실행되고 읽은 내용을 그대로 Linear로 보내므로 본문
  파일은 현재 worktree·저장소·임시 디렉터리 안에 있을 때만 읽는다. 그 밖의 경로는 읽지 않고 거부한다.
  제한이 없으면 `--description-file`이 로컬 비밀 파일을 외부 서비스로 올리는 한 줄이 된다.
- state나 project 이름을 해소하지 못하면 그 자리를 비운 채 발행하지 않고 후보 목록과 함께 실패한다.
  triage에도 roadmap에도 걸리지 않는 issue가 조용히 생기는 쪽이 더 나쁘기 때문이다.
- 발행 자체는 lease를 요구하지 않는다. 아직 claim할 issue가 없는 세션이 실행하는 명령이라 lease를
  요구하면 자기 자신을 막는다. 발행 뒤 `pnpm workflow:claim -- EAT-N`으로 소유권을 확정한다.
- 다음 절 0번의 중복 확인은 그대로 유효하다. 발행이 쉬워졌다고 기존 issue를 훑지 않고 새로 만들면
  추적이 갈라진다.

Linear MCP가 연결돼 있으면 `create_issue`도 lease 없이 쓸 수 있다. issue 생성은 저장소 파일을 바꾸지
않는 부트스트랩 동작이고, 이것을 막으면 "lease를 잡으려면 issue가 있어야 하는데 issue를 만들려면
lease가 필요한" 순환이 생긴다. 댓글 생성(`create_comment`)은 claim 이후 행위이며 worklog는 인계에서
완료 근거로 읽는 기록이라 lease 안에서만 쓴다. 상태 전환(`update_issue`)도 `claim`과 `release`가
소유하므로 계속 lease가 필요하다.

사람 몫으로 남는 것은 Linear workspace 계정과 team 구성, 그리고 `LINEAR_API_KEY` 발급·회전뿐이다.

## 6. 일상 사용

0. **새 issue를 만들기 전에 기존 issue를 먼저 훑는다.** `list_issues`로 team 전체를 확인하고, 하려는 일이
   이미 issue와 계획 문서를 갖고 있는지 본다. Backlog에 상위 설계 issue가 있고 그 아래 실행 issue가
   달려 있는 경우가 많다. 조사 결과가 아무리 새로워도 중복 issue를 만들면 추적이 갈라지고 이미 정해진
   결정을 다시 정하게 된다.
1. Linear issue에서 scope와 acceptance를 확정하고 `workflow:claim`으로 owner와 state를 검증한다.
   issue에 계획 문서가 연결돼 있으면 임의로 다른 순서를 만들지 말고 그 문서를 따른다.
2. branch 이름에 claim한 issue identifier를 넣는다. 예: `codex/EAT-123-auction-workspace`. prompt에
   identifier를 쓰는 것은 선택이며, hook은 사용자가 직접 쓴 대문자 `EAT-N` 단어만 요청 issue로 읽는다.
   경로·branch slug의 소문자 `eat-123`과 teammate 메시지·task 알림·system-reminder 같은 주입 블록의
   식별자는 무시한다.
3. agent는 명시적으로 허용된 읽기·조사를 자유롭게 수행한다. 첫 mutation session이 lease writer가 되므로 Codex와
   Claude가 같은 lease를 동시에 쓰지 않는다.
4. 작업 turn 뒤 `workflow:sync`로 worklog를 전송한다.
5. PR 제목이나 본문에 Linear identifier를 넣고 acceptance별 evidence를 PR에 남긴다.
6. GitHub/Linear integration을 설치·검증한 경우에만 PR 생성 시 `In Review`, 병합 시 `Done`을
   자동화한다. 설치 전에는 사람이 같은 전환을 수행한다.
7. 작업을 끝내면 issue 상태를 직접 옮긴다. `claim`은 `In Progress`까지만 옮기고 `release`는 기본적으로
   상태를 바꾸지 않으므로, 방치하면 끝난 작업이 계속 `In Progress`로 쌓인다. 중복으로 만든 issue는 `Canceled`로
   닫고 원래 issue에 `duplicateOf`로 연결한 뒤, 얻은 사실과 이미 적용된 변경을 그쪽 worklog에 옮긴다.

AI가 답변에서 완료를 주장했다는 이유만으로 hook이 `Done`으로 이동시키지 않는다.

lease 없이 허용하는 것은 `tools/agent-workflow/workflow.mjs` 분류기의 허용 목록뿐이며 원칙은 "저장소 파일을
바꾸지 않는 것"이다. 읽기 도구(Read, Glob, Grep, WebFetch, WebSearch, ToolSearch)와
EnterWorktree/ExitWorktree, agent 사이 메시지 도구 SendMessage/ListAgents(하위 세션을 실행하는
Agent/Task는 그 세션이 파일을 바꿀 수 있으므로 제외),
Linear MCP의 `get_* | list_* | search_*` 읽기 도구와 부트스트랩용
`create_issue`, chrome-devtools MCP의
`navigate_page | take_screenshot | take_snapshot | evaluate_script | list_pages | select_page | wait_for |
list_console_messages | get_console_message | list_network_requests | get_network_request`,
파일을 쓰는 수단이 없는 읽기 명령 `rg`·`grep`·`cat`·`head`·`tail`·`wc`·`cut`·`tr`·`nl`·`jq`·`ls`,
파일 인자가 하나 이하인 `uniq`(`uniq 입력 출력`은 두 번째 인자를 덮어쓴다),
`-exec`·`-ok`·`-delete`와 `-f`로 시작하는 출력 술어(`-fprint`, `-fprint0`, `-fprintf`, `-fls`)가 없는
`find`(읽기 전용인 `-follow`·`-fstype`만 예외), 제한된 PowerShell 조회·표시 cmdlet
(`Get-Content | Get-ChildItem | Test-Path | Select-String | Select-Object | Measure-Object | Sort-Object |
Format-List | Format-Table | Out-String | ConvertTo-Json`), `git [-C <path>] status | diff | log | show |
rev-parse | worktree list | worktree prune` 같은 명백한 로컬 조회, `kubectl get | describe | logs | top`,
본문·업로드·파일 출력 option이 없는
`curl` GET/HEAD, 따옴표 하나로 감싼 `python -c` / `node -e|-p` 읽기 코드(파일 쓰기·프로세스 실행·`>`·치환
토큰이 있으면 mutation), 새 ref만 만드는 `git branch <name> [<start>]`·`git checkout -b <name>`·`git
switch -c <name>`·`git worktree add ...`, 비밀값을 읽지도 쓰지도 않는
`infisical secrets folders create | list`, 그리고 `pnpm [--dir <path>] workflow:*` 단일 명령(issue 식별자,
`--worktree <path>`, `--branch <name>`, `--review`, `worktree remove <path> | prune`,
`issue create`의 `--title | --description | --description-file | --priority | --state | --project`,
`issue list`의 `--state | --limit` 인자만)이다. `sort`(`-o`), `tee`, `xargs`,
`Where-Object`·`ForEach-Object`는 파일을 쓰거나 다른 프로그램을 실행할 수 있어 읽기 목록에 넣지 않는다.
`--dir <path>`를 허용하는 이유는 세션 cwd가 아닌 worktree의 lease를 스스로 다루려면 그 형태가
기본이기 때문이다. 브랜치
생성을 lease 없이 허용하는 이유는 저장소 파일을 바꾸지 않는 동작인데도 막으면 claim 전에 올바른
브랜치로 옮길 방법이 없어 이슈 전환이 교착하기 때문이다. `checkout -b`·`switch -c`는 이름 하나만 받는
형태(현재 HEAD 기준)까지만 허용한다. start-point를 주면 그 commit의 tree로 작업 파일이 바뀌므로
`git checkout -b tmp origin/main`은 lease가 필요하다. 작업 트리를 갈아끼우는 `git checkout <branch>`와
`git branch -D | -m | --force`, `git worktree remove`, chrome-devtools의
click·fill·type·upload·dialog·new_page, `kubectl apply | delete | exec | edit`은 lease가 필요하다.
브라우저 도구는 저장소에 닿지 않지만 `evaluate_script`는 열린 페이지에서 외부 요청을 보낼 수 있으므로 live
서비스를 바꾸는 코드는 실행하지 않는다.
workflow 명령은 저장소 파일이 아니라 lease state·Linear·git worktree 목록만 바꾸므로 Claude·Codex 세션이 스스로
claim하고 푼다.
`release`도 lease 없이 실행되므로 같은 worktree의 다른 세션이 writer의 lease를 풀 수 있다. 이 보장은 중앙 lock이
아니라 "다른 writer가 claim한 작업은 read-only로만 다룬다"는 agent 규율과 Linear assignee에 의존한다.
command chaining, redirect(`>`와 `>>`), command substitution, snapshot update나 `--fix`가 있으면
mutation으로 취급한다. 이 검사는 pipe를 나누기 **전에** 명령 전체에서 먼저 하므로 뒤 단계에 숨긴
`| tail -3 >> out.log`도 걸린다.
pipe는 단계별로 본다. 따옴표를 인식해 `|`로 단계를 나눈 뒤 모든 단계가 읽기로 분류될 때만 통과시키고,
한 단계라도 쓰기면 그 단계의 이유로 차단한다. `pnpm workflow:release -- EAT-37 | tail`이나
`grep -rn TODO src | head -20 | wc -l`처럼 결과를 줄여 읽는 형태까지 막으면 lease를 푸는 명령 자체가
lease를 요구하기 때문이다. 닫히지 않은 따옴표는 어디까지가 한 단계인지 말할 수 없으므로 차단하고,
`||`는 빈 단계를 만들어 자동으로 걸린다. 테스트도 fixture나 snapshot을 쓸 수 있으므로
shell verification은 lease 안에서 수행한다.
편집 도구가 저장소 밖의 절대 경로를 가리키면 lease가 지키려는 대상이 아니므로 막지 않는다.
Claude memory 디렉터리나 scratchpad 기록까지 막으면 세션은 claim 없이 자기 기록조차 남기지 못한다.
여기서 "저장소"는 현재 worktree 하나가 아니라 `git rev-parse --git-common-dir`와 그 부모(main
checkout 루트), `git worktree list`의 모든 worktree 루트, 그리고 lease state 파일을 모두 합친 것이다.
state 경로는 환경변수로 옮길 수 있어 그 파일 하나만 넣는다. 부모 디렉터리를 넣으면 state를 임시
디렉터리로 옮긴 세션이 그 디렉터리 전체를 쓰지 못한다. 기준이 현재 worktree였다면 main checkout의 추적 파일, 형제 worktree,
`.git/hooks/*`, 그리고 lease state 파일 자신까지 lease 없이 쓸 수 있어 gate가 자기 자신을 연다.
경로는 심볼릭 링크를 해석하고(없는 파일은 존재하는 조상까지) Windows에서는 대소문자를 무시해
비교한다. `\\?\`·`\\.\` 표기는 벗겨 판정하고, UNC 경로·제어문자가 섞인 경로·상대 경로·루트를
알아내지 못한 경우는 "밖"이라고 말하지 않고 계속 lease를 요구한다. 판정 불가는 허용이 아니다.
분류되지 않은 새 도구와 Linear 쓰기 MCP 도구는 읽기로 추측하지 않고 lease가 필요한 변경 가능 도구로
fail-closed한다.

사용자가 Claude Code prompt에서 `!`로 직접 친 명령은 사용자의 행위이므로 lease 검사를 하지 않는다. hook은
Claude Code hooks 문서의 PreToolUse 입력 필드 `initiated_by`가 `user`일 때만 이렇게 판단하며 writer 결박이나
session issue 기록도 바꾸지 않는다. 이 필드는 문서 근거로 구현했고 `!` 명령이 실제로 그 값을 보내는지는
실측하지 않았다. 값이 없거나 `assistant`면 agent 호출과 같이 fail-closed한다.

차단 메시지에는 현재 worktree의 lease 상태와 함께 state에 있는 모든 lease의 issue·worktree root·만료
시각·writer, 그리고 그 lease를 푸는 `pnpm workflow:release -- EAT-N` 명령이 붙는다. 그래서 agent는 doctor를
따로 돌리지 않아도 누가 무엇을 잡고 있는지 알 수 있다. lease가 있는 차단은 마지막 줄이 항상
`지금 풀려면: pnpm workflow:claim -- <lease issue>`이며, 이 한 줄이 만료·branch 불일치·writer 충돌의
공통 복구 명령이다.

branch가 lease와 다르면 커밋이 남의 작업에 쌓이므로 계속 차단한다. 반대로 lease와 branch가 이미
일치하는데 prompt에서 읽은 요청 issue만 다르면 소유권 충돌이 아니라 잡음이므로 차단하지 않고
경고 한 줄을 남긴 뒤 세션 기록을 lease 쪽으로 맞춘다. 사용자가 채팅에 issue 번호를 다시 쳐야만
풀리는 상태를 만들지 않기 위해서다. 통과하는 호출의 stderr는 세션에 전달되지 않으므로 이 경고는
hook JSON의 `systemMessage`로 나간다.

writer 보장은 하나의 Git common dir을 공유하는 local worktree 범위다. 서로 다른 clone이나 host 사이의
원자적 global lock을 의미하지 않는다. cross-machine 작업은 Linear assignee와 명시적 handoff로 한 명만
쓰기 상태를 유지하며, 중앙 lease backend가 도입되기 전에는 동시에 claim하지 않는다.

`workflow:release`는 아직 Stop되지 않은 session 경로를 원래 issue의 local worklog로 먼저 확정한
뒤 lease를 해제한다. 따라서 release 뒤 `workflow:sync`를 실행해 남은 worklog를 전송한다.

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
4. `pnpm workflow:sync`로 worklog를 Linear에 전송하고 `pnpm workflow:release`로 현재 lease를
   해제한 뒤 다시 `pnpm workflow:sync`한다.

공유 outbox에 다른 작업의 오래된 이벤트가 섞였다고 확인된 경우에는 전체 sync를 실행하지 않는다.
해당 issue의 handoff만 연결된 Linear 도구로 기록하고 기존 `workflow:release`를 사용한다.
미전송 이벤트는 보존하며 state/outbox 파일을 직접 고치지 않는다.

받는 세션은 다음 순서를 지킨다.

1. `AGENTS.md`와 이 문서의 읽기 순서를 따른 뒤 Linear issue의 최신 scope·acceptance·worklog를 읽는다.
2. 지정된 commit, branch, worktree와 clean 상태를 확인한다. 일치하지 않으면 쓰지 않고 차이를 먼저
   보고한다.
3. 받는 세션이 그 worktree 안에서 직접 `pnpm workflow:claim -- EAT-123`을 실행해 새 lease를 얻은 뒤에만
   mutation을 시작한다. Claude Code project hook은 이 명령과 Linear 읽기 도구를 lease 없이 허용하므로
   사용자가 대신 claim할 필요가 없다.
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

차단은 사용자에게 명령을 대신 쳐 달라고 부탁해서 푸는 것이 아니라 세션이 스스로 푼다. 두 가지
전형적인 교착과 그 복구는 다음과 같다.

- **요청 issue 오염.** 이전 prompt나 예전 대화에서 읽은 다른 identifier가 세션 기록에 남아 차단이
  걸리는 경우다. lease와 branch가 일치하면 이제 차단 대신 경고가 나가고 기록이 lease로 맞춰지므로
  아무 것도 하지 않아도 된다. 그래도 막히면 차단 메시지 마지막 줄의
  `pnpm workflow:claim -- <lease issue>`를 그대로 실행한다.
- **이슈 전환 교착.** 다음 issue가 `Backlog`나 `In Review`에 있거나, 아직 그 issue의 branch가 없어서
  claim도 branch 생성도 못 하는 경우다. claim이 상태와 branch를 모두 맞추므로 한 명령으로 끝난다.
  이전 lease가 남아 있으면 먼저 release한다.

```powershell
pnpm workflow:release
pnpm workflow:claim -- EAT-124 --branch eat-124-slug
```

- 쓰기가 차단되면 branch에 유효한 Linear identifier가 있는지 확인한다.
- `pnpm workflow:doctor`의 `worktreeRoot`가 세션 cwd의 worktree인지 확인한다. lease가 다른 worktree에
  있으면 `--worktree`나 issue 식별자로 release한 뒤 현재 worktree에서 claim한다. 세션 cwd를 `cd`로 옮겨 풀지
  않는다.
- worktree 디렉터리를 지웠는데 lease가 남아 claim이 막히면 `pnpm workflow:release -- EAT-N` 또는
  `pnpm workflow:worktree prune`으로 정리한다. worktree를 없앨 때는 처음부터
  `pnpm workflow:worktree remove <path>`를 써서 유령 lease를 만들지 않는다.
- lease가 없거나 만료됐으면 network가 가능한 전용 terminal에서 다시 claim한다.
- doctor에 pending claim이 보이면 다른 issue를 claim하거나 state를 편집하지 말고 같은 identifier의
  Infisical-wrapped claim을 다시 실행해 원격 상태와 local lease를 확정한다.
- outbox가 쌓이면 API key와 network를 확인한다. state 파일을 수기로 편집해 event를 지우지 않는다.
- worklog comment에는 event marker가 포함되며 sync는 marker를 먼저 확인한다. comment 성공 뒤 local
  acknowledgement 전에 중단돼도 같은 event를 중복 게시하지 않는다.
- 비정상 종료 뒤 doctor가 stale state 또는 sync lock을 보고하면 먼저 owner PID가 종료됐는지
  확인하고 `workflow:recover-lock`을 실행한다. 명령은 두 lock을 각각 검사해 살아 있는 owner를
  거부하고 stale lock directory만 `.recovered-<timestamp>`로 격리한다. lock을 수기로 삭제하지 않는다.
- state JSON이 손상되면 runner가 같은 디렉터리에 `.corrupt-<timestamp>`로 격리하고 쓰기를
  fail-closed한다. 원본과 quarantine을 검토하기 전 빈 state를 만들지 않는다.
- hook을 일시적으로 우회해 작업 상태를 다른 곳에 기록하지 않는다. 장애가 길어지면 Linear issue에
  복구 후 반영할 범위와 blocker를 사람이 결정한다.
