---
status: repository-side-complete-bootstrap-pending
date: 2026-08-30
linear_issue: pending-workspace-bootstrap
---

# Linear SSOT + Codex/Claude 공통 Hook 구현 계획

> 이 파일은 구현 순서의 역사 기록이다. 실제 owner, priority, status, blocker는 Linear가 구성된 뒤
> Linear issue만 소유한다.

**Goal:** Codex와 Claude Code가 같은 Linear work item을 기준으로 저장소 변경을 시작하고, 실패한
동기화가 유실되지 않게 한다.

**Architecture:** 두 client의 project hook은 Node 24 공통 러너만 호출한다. 명시적인 claim 명령은
Linear에서 team·owner·state를 온라인 검증한 뒤 worktree별 단기 lease를 발급한다. hook은 네트워크를
호출하지 않고 유효한 lease가 없는 mutation을 차단하며, `.git` 아래 state/outbox를 잠금과 atomic
rename으로 Git common dir에 유지한다. 첫 mutation session을 writer로 결박하고 같은 issue의
linked-worktree 중복 lease를 차단한다. Linear MCP는 각 client의 대화형 조회·수정을, GraphQL adapter는 명시적인
claim과 outbox sync를 맡는다.

**Tech Stack:** Node.js 24 ESM, `node:test`, Linear GraphQL API, Codex/Claude project hooks.

## Task 1 — 공통 순수 규칙을 테스트 우선으로 구현

**Files:**
- Create: `tools/agent-workflow/workflow.test.mjs`
- Create: `tools/agent-workflow/workflow.mjs`

1. `EAT-123` 표기 추출과 mutation 분류의 실패 테스트를 작성한다. 표기만으로 issue를 claim하지
   않는다.
2. 읽기와 mutation tool/command 분류의 실패 테스트를 작성한다.
3. provider별 allow/block 응답 계약의 실패 테스트를 작성한다.
4. 최소 구현으로 테스트를 통과시키고 공개 함수의 경계를 정리한다.

## Task 2 — state와 outbox를 테스트 우선으로 구현

**Files:**
- Create: `tools/agent-workflow/state.test.mjs`
- Create: `tools/agent-workflow/state.mjs`

1. worktree별 verified lease, session worklog, outbox가 분리되는 실패 테스트를 작성한다.
2. 저장 후 재로드와 손상 파일 격리의 실패 테스트를 작성한다.
3. lock을 포함한 atomic temp+rename과 FIFO outbox 최소 구현으로 통과시킨다.

## Task 3 — Linear adapter와 hook entrypoint 구현

**Files:**
- Create: `tools/agent-workflow/linear.test.mjs`
- Create: `tools/agent-workflow/linear.mjs`
- Create: `tools/agent-workflow/hook.mjs`
- Create: `tools/agent-workflow/config.json`

1. HTTP transport를 fake로 주입해 issue/team/owner/state 검증과 comment mutation 계약을 테스트한다.
2. API key 부재·오류에서 claim이 실패하고 event를 유실하지 않는 entrypoint 테스트를 작성한다.
3. stdin event 정규화, lease gate, state update와 명시적 outbox sync를 구현한다.
4. log와 state에 token이나 prompt 전문이 남지 않는지 검토한다.

## Task 4 — Claude Code와 Codex adapter 연결

**Files:**
- Create: `.claude/settings.json`
- Create: `.codex/hooks.json`
- Create: `.mcp.json`
- Modify: `package.json`

1. 두 client가 지원하는 `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`을 공통 러너에
   연결한다.
2. Claude project MCP에는 비밀 없는 공식 Linear endpoint만 등록한다.
3. Codex MCP는 사용자 config에 등록하는 bootstrap 명령을 문서화하고 실제 로컬 설치는 OAuth
   단계 직전까지 수행한다.
4. `workflow:test`, `workflow:doctor` script를 추가한다.

## Task 5 — Linear SSOT로 거버넌스 전환

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/README.md`
- Modify: `docs/governance/ai-driven-documentation.md`
- Modify: `docs/product/roadmap.md`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `docs/superpowers/plans/2026-08-30-cross-agent-workflow.md`

1. live work의 유일한 owner를 Linear issue/project로 바꾼다.
2. GitHub Issue template은 신규 intake가 아닌 historical/deprecated 경로로 표시하거나 제거한다.
3. PR template은 `Linear issue`와 acceptance evidence만 참조하게 한다.
4. 이전 GitHub-SSOT plan은 superseded 역사 기록으로 표시한다.

## Task 6 — 검증과 도입 경계 확인

1. 공통 unit/integration tests를 실행한다.
2. 두 hook config를 JSON parser와 각 client의 진단 surface로 확인한다.
3. token 없이 doctor를 실행해 안전한 offline 결과와 outbox 위치를 확인한다.
4. scoped `git diff --check`와 변경 파일 검토를 수행한다.
5. 실제 Linear workspace/team 생성과 OAuth는 사용자 계정 승인이 필요한 미완료 bootstrap으로 명시한다.
