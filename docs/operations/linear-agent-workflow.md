---
status: active
last_reviewed: 2026-09-02
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
claim command로 issue 존재, `EAT` team, assignee와 `Ready | In Progress` state를 검증한다.

```powershell
pnpm workflow:claim -- EAT-123
pnpm workflow:doctor:infisical
```

키를 `.env`, Claude/Codex settings, shell script, 사용자 전역 환경변수에 넣지 않는다. 저장소의
Infisical wrapper는 parent process의 `LINEAR_API_KEY`를 이름만 확인해 child environment에서 제거한
뒤 Infisical을 실행하므로, 누락된 Infisical 값이 우연히 상속된 key로 대체되지 않는다.
`--secret-overriding=false`는 inherited environment 제어가 아니라 같은 이름의 personal secret보다
project shared secret을 우선하도록 고정하는 옵션이다.

claim은 local pending reservation을 먼저 기록한 뒤 issue가 비어 있으면 현재 사용자를 assignee로
지정하고 `Ready`에서만 `In Progress`로 옮기며, 검증 성공 후 12시간 lease로 확정한다. 중단돼
pending claim이 남으면 같은 identifier로 claim을 다시 실행해 멱등하게 확정한다. 같은 local Git
common dir에서 같은 issue의 다른 worktree lease나
현재 worktree의 다른 issue lease가 살아 있으면 먼저 release하도록 실패한다. 첫 mutation의
Codex/Claude session이 writer로
결박되고 다른 session은 명시적인 release와 재claim 전까지 쓰지 못한다. 다른 assignee, 다른 team,
`Blocked | In Review | Done` 같은 state는 추측으로 바꾸지 않고 실패한다.

API key가 없거나 Linear가 중단되면 새 claim은 실패한다. 이미 검증한 미만료 lease에서는 작업을
계속할 수 있고 event는 linked worktree들이 공유하는 Git common dir의
`eatbid-agent-workflow/state.json` outbox에 남는다.
network 복구 후 전용 terminal에서 다음을 실행한다.

```powershell
pnpm workflow:sync
pnpm workflow:release
```

## 5. 일상 사용

1. Linear issue에서 scope와 acceptance를 확정하고 `workflow:claim`으로 owner와 state를 검증한다.
2. prompt 또는 branch에 claim한 issue identifier를 포함한다. 예: `EAT-123 구현` 또는
   `codex/EAT-123-auction-workspace`.
3. agent는 명시적으로 허용된 읽기·조사를 자유롭게 수행한다. 첫 mutation session이 lease writer가 되므로 Codex와
   Claude가 같은 lease를 동시에 쓰지 않는다.
4. 작업 turn 뒤 `workflow:sync`로 worklog를 전송한다.
5. PR 제목이나 본문에 Linear identifier를 넣고 acceptance별 evidence를 PR에 남긴다.
6. GitHub/Linear integration을 설치·검증한 경우에만 PR 생성 시 `In Review`, 병합 시 `Done`을
   자동화한다. 설치 전에는 사람이 같은 전환을 수행한다.

AI가 답변에서 완료를 주장했다는 이유만으로 hook이 `Done`으로 이동시키지 않는다.

lease 없이 허용하는 도구는 세 종류뿐이다. 단일 `rg`, 제한된 PowerShell 조회 cmdlet, `git status | diff |
log | show | rev-parse` 같은 명백한 로컬 조회, `pnpm workflow:doctor | doctor:infisical | claim | sync |
release | recover-lock` 단일 명령, 그리고 Linear MCP의 `get_* | list_* | search_*` 읽기 도구와 `ToolSearch`다.
workflow 명령은 저장소 파일이 아니라 lease state와 Linear만 바꾸므로 Claude·Codex 세션이 스스로 claim한다.
pipe, command chaining, redirect, command substitution, snapshot update나 `--fix`가 있으면 mutation으로
취급한다. 테스트도 fixture나 snapshot을 쓸 수 있으므로 shell verification은 lease 안에서 수행한다.
분류되지 않은 새 도구와 Linear 쓰기 MCP 도구는 읽기로 추측하지 않고 lease가 필요한 변경 가능 도구로
fail-closed한다.

writer 보장은 하나의 Git common dir을 공유하는 local worktree 범위다. 서로 다른 clone이나 host 사이의
원자적 global lock을 의미하지 않는다. cross-machine 작업은 Linear assignee와 명시적 handoff로 한 명만
쓰기 상태를 유지하며, 중앙 lease backend가 도입되기 전에는 동시에 claim하지 않는다.

`workflow:release`는 아직 Stop되지 않은 session 경로를 원래 issue의 local worklog로 먼저 확정한
뒤 lease를 해제한다. 따라서 release 뒤 `workflow:sync`를 실행해 남은 worklog를 전송한다.

## 6. Codex와 Claude 사이 작업 인계

모델 교대는 새 작업을 시작하는 행위가 아니라 같은 Linear issue의 writing owner를 순차적으로
이전하는 행위다. 대화 요약이나 도구별 memory를 완료 상태의 근거로 사용하지 않는다.

보내는 세션은 다음 순서를 지킨다.

1. 허용된 owned path만 포함한 검토 가능한 commit을 만들고 working tree를 clean하게 만든다.
2. issue acceptance와 직접 연결되는 검증 명령, 통과·실패 결과, 미완료 항목, 외부 mutation 여부를
   worklog에 남긴다. 단순히 "테스트 통과"라고 쓰지 말고 실행한 명령과 범위를 적는다.
3. 다음 세션이 시작할 commit과 worktree, 이어서 수행할 첫 단계, 금지된 외부 작업을 명시한다.
4. `pnpm workflow:sync`로 worklog를 Linear에 전송하고 `pnpm workflow:release`로 현재 lease를
   해제한 뒤 다시 `pnpm workflow:sync`한다.

받는 세션은 다음 순서를 지킨다.

1. `AGENTS.md`와 이 문서의 읽기 순서를 따른 뒤 Linear issue의 최신 scope·acceptance·worklog를 읽는다.
2. 지정된 commit, branch, worktree와 clean 상태를 확인한다. 일치하지 않으면 쓰지 않고 차이를 먼저
   보고한다.
3. 받는 세션이 직접 `pnpm workflow:claim -- EAT-123`을 실행해 새 lease를 얻은 뒤에만 mutation을 시작한다.
   Claude Code project hook은 이 명령과 Linear 읽기 도구를 lease 없이 허용하므로 사용자가 대신 claim할
   필요가 없다.
4. 이전 세션이 완료했다고 적은 작업을 다시 구현하지 않는다. 다만 검증 결과를 신뢰로 대체하지 않고,
   변경할 경계의 관련 gate는 새 세션에서도 다시 실행한다.
5. 구현자와 최종 reviewer를 가능하면 다른 세션이나 모델로 분리한다. reviewer는 수정하지 않고
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

## 7. 진단과 복구

```powershell
pnpm workflow:test
pnpm workflow:doctor
pnpm workflow:recover-lock
claude mcp get linear
codex mcp list
```

- 쓰기가 차단되면 prompt나 branch에 유효한 Linear identifier가 있는지 확인한다.
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
