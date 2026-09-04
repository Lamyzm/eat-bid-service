# EAT-41 (2차) lease 게이트 자가 복구 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 채팅에 이슈 번호를 쳐야만 풀리는 hook 차단(요청 이슈 오염)과 이슈 전환 교착(Backlog·In Review claim 거부, lease 없이는 브랜치 생성 불가)을 없애 agent가 스스로 복구하게 한다.

**Architecture:** `tools/agent-workflow`의 세 지점을 고친다. (1) `workflow.mjs`의 이슈 식별자 추출을 "프롬프트용"과 "브랜치용"으로 나누고 프롬프트용은 대문자 단어 경계만, 주입 블록(teammate·알림·system-reminder·skill 목록) 제외. (2) `hook-runtime.mjs`의 mismatch 판정을 lease·branch 일치 시 경고로 강등하고 claim 재실행이 requestedIssue를 lease로 맞춘다. (3) `cli.mjs`·`linear.mjs`의 claim이 Backlog/In Review에서도 In Progress로 옮기고, release가 이슈 상태를 바꾸지 않으며(`--review` 옵션일 때만 In Review), `--branch <name>`이 브랜치 생성과 claim을 한 번에 하고, lease 없이도 브랜치 생성 명령은 통과한다.

**Tech Stack:** Node ESM(`.mjs`), `node --test`, 기존 `tools/agent-workflow/*.test.mjs` 패턴.

**Spec:** Linear EAT-41 본문 6·7·8항(사용자 경험: "채팅에 저걸 쳐야 릴리즈가 풀리는 이상한 hook 개선"). 기존 1~5항은 branch `eat-41-lease-gate`의 126ccf2..3f96408에 구현돼 있으니 그 위에 쌓는다.

## Global Constraints

- 테스트 제목은 한글 포함(AGENTS 14). 판단 경계에 한국어 why 주석(13). 새 모듈에는 `@module 책임:`(23), 기존 `.mjs`는 실질 변경 시 추가.
- 규칙 20의 취지(저장소 변경은 lease 보유 writer만)는 유지한다. 완화는 "저장소 내용을 바꾸지 않는 동작"과 "lease·branch가 이미 일치하는 세션"에만 적용한다.
- 커밋 메시지 한국어, trailer 블록 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01JCsr2N2vuZVbre9agy38J9`(빈 줄 없이 한 블록), 메시지 파일로 커밋.
- 실행은 worktree 루트 `F:\Project\eat-bid-service\.claude\worktrees\agent-ad2c79a35e7369439`에서 단일 명령. `cd`·`git -C` 금지.
- 검증: `pnpm test:quality`(tools/*.test.mjs 포함), `pnpm quality:check`, `pnpm architecture:check`.

---

### Task 1: 프롬프트 이슈 추출 강화와 mismatch 경고 강등

**Files:**
- Modify: `tools/agent-workflow/workflow.mjs` (`ISSUE_IDENTIFIER`, `extractIssueIdentifier`), `tools/agent-workflow/hook-runtime.mjs` (userpromptsubmit 121~129행, mismatch 152~162행)
- Test: `tools/agent-workflow/workflow.test.mjs`, `tools/agent-workflow/hook-runtime.test.mjs`

**Interfaces:**
- Produces: `extractIssueIdentifier(value)`(브랜치·CLI 인자용, 기존 동작 유지: 소문자 허용), 새 `extractPromptIssueIdentifier(prompt)`(대문자 `EAT-N` 단어 경계만, 경로·소문자 슬러그 무시, 아래 주입 블록 제거 후 추출), `hook-runtime`의 `evaluate`가 mismatch 시 lease·branch 일치면 `exitCode 0` + 경고 메시지(state의 `requestedIssue`를 lease로 덮어씀), 불일치면 기존 차단.

- [ ] **Step 1: 실패하는 테스트**
  - `workflow.test.mjs`: "프롬프트 추출은 대문자 EAT-N만 인정하고 경로의 eat-34는 무시한다"(`...worktrees-eat-34-collection-modes...` → null, `EAT-37 진행` → EAT-37), "teammate·알림·system-reminder·skill 목록 블록 안의 이슈 번호는 무시한다"(`<teammate-message ...>EAT-34</teammate-message> EAT-37` → EAT-37; `<task-notification>...EAT-34...</task-notification>` 단독 → null; `[SYSTEM NOTIFICATION - NOT USER INPUT]`로 시작하는 본문 → null; `<system-reminder>...</system-reminder>` → null), "브랜치 추출은 소문자 슬러그를 그대로 인정한다"(`eat-37-org-attempts` → EAT-37).
  - `hook-runtime.test.mjs`: "lease와 branch가 일치하면 다른 requestedIssue는 차단이 아니라 경고이며 requestedIssue를 lease로 맞춘다", "branch가 lease와 다르면 여전히 차단한다", "UserPromptSubmit이 주입 블록만 담으면 requestedIssue를 바꾸지 않는다".
- [ ] **Step 2: 실패 확인** — `node --test tools/agent-workflow/workflow.test.mjs tools/agent-workflow/hook-runtime.test.mjs`
- [ ] **Step 3: 구현**
  - `workflow.mjs`: `PROMPT_ISSUE_IDENTIFIER = /(?<![\w\/\\.-])([A-Z][A-Z0-9]{1,9}-\d+)(?![\w-])/`(대소문자 구분), `INJECTED_BLOCKS = [/<teammate-message[\s\S]*?<\/teammate-message>/g, /<cross-session-message[\s\S]*?<\/cross-session-message>/g, /<task-notification>[\s\S]*?<\/task-notification>/g, /<system-reminder>[\s\S]*?<\/system-reminder>/g, /\[SYSTEM NOTIFICATION[\s\S]*$/]`, `extractPromptIssueIdentifier`는 블록 제거 후 매칭. `extractIssueIdentifier`는 그대로.
  - `hook-runtime.mjs`: userpromptsubmit에서 `extractPromptIssueIdentifier` 사용. pretooluse mismatch: `branchIssue`가 lease와 다르면 차단(기존), `session.requestedIssue`만 다르면 `exitCode 0`, message `경고: 요청 이슈 ${requestedIssue}가 lease ${lease}와 다릅니다. lease를 따릅니다.`, state의 requestedIssue를 lease로 갱신.
- [ ] **Step 4: 통과 확인** — 같은 명령
- [ ] **Step 5: 커밋** — `fix(workflow): 프롬프트 이슈 추출을 대문자 단어로 좁히고 lease 일치 시 요청 이슈 불일치를 경고로 낮춘다`

---

### Task 2: claim·release 상태 전환과 브랜치 생성 허용

**Files:**
- Modify: `tools/agent-workflow/cli.mjs`(claim 85~130행, release), `tools/agent-workflow/linear.mjs`(`claimIssue` 152~159행 readyStates 판정), `tools/agent-workflow/command-line.mjs`(`--branch <name>`, `--review` 인자), `tools/agent-workflow/workflow.mjs`(`WORKFLOW_LIFECYCLE_COMMAND`에 `--branch <name>`·`--review` 허용, `MUTATING_COMMANDS`/`READ_ONLY_COMMANDS`에 브랜치 생성 허용), `tools/agent-workflow/config.json`(readyStates에 Backlog·In Review 추가 여부는 여기서 결정)
- Test: `tools/agent-workflow/cli` 관련 테스트(`hook.test.mjs`의 claim 시나리오), `linear.test.mjs`, `command-line.test.mjs`, `workflow.test.mjs`

**Interfaces:**
- Produces: `pnpm workflow:claim -- EAT-N [--branch <name>]`(브랜치가 없으면 `git branch <name>` + `git symbolic-ref`/`checkout`으로 만들고 그 브랜치에서 claim; 이미 다른 이슈 브랜치면 기존처럼 거부), `pnpm workflow:release [--review]`(기본은 Linear 상태 유지, `--review`일 때만 In Review), claim이 Backlog·Ready·In Review·In Progress 어디서든 In Progress로 옮김(Done·Canceled·Duplicate는 거부), lease 없이 허용되는 명령: `git branch <name>`, `git checkout -b <name>`, `git switch -c <name>`, `git worktree add ...`(내용 변경 없음).

- [ ] **Step 1: 실패하는 테스트**
  - `linear.test.mjs`: "Backlog와 In Review 이슈도 claim이 In Progress로 옮긴다", "Done·Canceled 이슈는 claim을 거부한다".
  - `hook.test.mjs`(실제 git repo fixture 사용 패턴 참고): "lease 없이도 git checkout -b는 통과한다", "lease 없이 git commit은 여전히 막힌다", "`--branch`로 브랜치를 만들며 claim한다"(branch가 생기고 lease가 잡힘), "release 기본은 Linear 상태를 바꾸지 않고 `--review`일 때만 In Review로 보낸다"(Linear client stub의 호출 기록으로 단언).
  - `command-line.test.mjs`: `--branch`·`--review` 파싱. `workflow.test.mjs`: lifecycle regex가 `pnpm workflow:claim -- EAT-41 --branch eat-41-x`와 `pnpm workflow:release --review`를 허용.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 브랜치 생성은 `git branch <name>`(현재 HEAD) 뒤 `git checkout <name>`을 `child_process.spawnSync`로 실행하고 working tree가 dirty하면 거부(메시지에 이유). 상태 판정은 config의 `claimableStates`(기본 `["Backlog","Ready","Todo","In Review","In Progress"]`)와 `terminalStates`(기본 `["Done","Canceled","Duplicate"]`)로 옮긴다.
- [ ] **Step 4: 통과 확인** — `pnpm test:quality`
- [ ] **Step 5: 커밋** — `feat(workflow): claim이 상태와 브랜치를 스스로 맞추고 release는 이슈 상태를 바꾸지 않는다`

---

### Task 3: 복구 절차 문서와 차단 메시지

**Files:**
- Modify: `docs/operations/linear-agent-workflow.md`(복구 절차 한 문단: 오염·교착 시나리오와 명령), `tools/agent-workflow/hook-runtime.mjs`(차단 메시지에 "지금 풀려면: `pnpm workflow:claim -- <lease 이슈>`" 한 줄)
- Test: 문서는 테스트 없음. 메시지는 `hook-runtime.test.mjs`에 문자열 단언 1건.

- [ ] Step 1 테스트 → Step 2 실패 → Step 3 구현 → Step 4 `pnpm test:quality`, `pnpm quality:check`, `pnpm architecture:check` → Step 5 커밋 `docs(operations): lease 게이트 자가 복구 절차와 차단 메시지를 갱신한다`

---

## 자기 검토

- EAT-41 6항 (a)(b)(c) → Task 1. 7항 (a)(b)(c) → Task 2. 8항 (a)(b)(c) → Task 1. 5항(메시지) 보강 → Task 3. Acceptance "각 시나리오 테스트 한글 제목" → 각 Task Step 1. "복구 절차 문서" → Task 3.
- 이름 일관: `extractPromptIssueIdentifier`(Task 1)만 새로 생기고 Task 2·3은 기존 API를 쓴다. config 키 `claimableStates`/`terminalStates`는 Task 2에서만 정의·사용.
- 주의: 이 수정은 이 worktree의 hook에만 적용된다. 다른 worktree(eat-37 등)는 main에 merge된 뒤 hook을 다시 읽는다.
