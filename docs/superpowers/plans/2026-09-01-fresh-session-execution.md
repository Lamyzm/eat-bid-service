# Fresh Session Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** clean checkout의 새 Codex/Claude 세션이 Linear 이슈와 저장소 권위 문서만으로 제품기획 작업을 안전하게 시작하게 한다.

**Architecture:** Linear는 owner·상태·blocker의 동적 SSOT, 저장소는 제품 계약과 근거의 안정 SSOT로 유지한다. EAT-11에서 검증한 claim 인자 수정은 별도 commit으로 통합하고, EAT-13은 canonical 제품 문서 패키징과 R1 이슈 handoff 계약만 소유한다.

**Tech Stack:** Linear GraphQL, Infisical CLI, Node.js `node:test`, pnpm, Git, Markdown

**Spec:** `docs/operations/linear-agent-workflow.md`, `docs/product/roadmap.md`, Linear `EAT-13`

## Global Constraints

- 추천가·예측가·안전구간·자동 투찰을 만들지 않는다.
- 다른 세션의 백엔드·DB·dataplane·Kubernetes owned path를 변경하지 않는다.
- 첫 repository mutation 전에 Linear issue와 worktree lease를 검증한다.
- 실제 상태와 검증 evidence를 문서에 복사해 고정하지 않고 Linear와 PR에 둔다.
- clean checkout에 545MB embedded prototype repository를 포함하지 않는다.

---

### Task 1: 검증된 claim 수정 통합

**Files:**
- Integrate commit: `6f46373 fix(workflow): accept pnpm claim separator`
- Verify: `tools/agent-workflow/cli.mjs`
- Verify: `tools/agent-workflow/workflow.mjs`
- Test: `tools/agent-workflow/workflow.test.mjs`
- Test: `tools/agent-workflow/hook.test.mjs`

**Interfaces:**
- Consumes: pnpm이 `workflow:claim -- EAT-13`에 전달하는 `['--', 'EAT-13']`
- Produces: `extractIssueIdentifier(string | string[]): string | null`

- [ ] **Step 1: EAT-11 전용 worktree의 diff와 lease를 확인한다**

Run: `pnpm workflow:doctor:infisical`

Expected: EAT-11 lease가 없거나 현재 writer에게 claim 가능하다.

- [ ] **Step 2: EAT-11의 회귀 테스트를 실행한다**

Run: `pnpm workflow:test`

Expected: 47 tests, 0 fail.

- [ ] **Step 3: 문서화된 명령을 실제 실행한다**

Run: `pnpm workflow:claim -- EAT-11`

Expected: identifier가 `EAT-11`이고 미만료 lease가 생성된다.

- [ ] **Step 4: EAT-11 변경을 commit하고 release한다**

Run: `git commit -m "fix(workflow): accept pnpm claim separator"`

Run: `pnpm workflow:sync; pnpm workflow:release; pnpm workflow:sync`

Expected: branch에 commit이 있고 worktree lease와 outbox가 비어 있다.

- [ ] **Step 5: EAT-13 writer가 검증한 commit을 현재 branch에 통합한다**

Run: `git cherry-pick 6f46373`

Expected: workflow 네 파일만 반영되고 사용자 변경과 충돌하지 않는다.

### Task 2: canonical 제품기획 패키지 추적

**Files:**
- Modify: `docs/product/screen-system.md`
- Create: `docs/product/prototypes/README.md`
- Track: `docs/product/decision-support.md`
- Track: `docs/product/design-brief-analysis-v1.md`
- Track: `docs/evidence/product-direction/2026-08-31-analysis-first-planning-audit.md`
- Track: `docs/evidence/competitors/**`
- Track: `docs/product/mockups/analysis-detail-v1.png`
- Track: `docs/product/mockups/analysis-detail-v1.svg`
- Track: `eatbid-analysis-yulha.png`
- Track existing modification: `docs/product/roadmap.md`

**Interfaces:**
- Consumes: `docs/README.md`의 권위 문서 지도
- Produces: clean checkout에서 끊기지 않는 제품 계약과 시각 evidence 링크

- [ ] **Step 1: embedded prototype를 canonical source에서 분리한다**

`docs/product/prototypes/README.md`에 다음을 기록한다.

```markdown
# 분석 화면 프로토타입

`analysis-hybrid-v1`은 Sites가 만든 로컬 검증 작업공간이며 545MB embedded Git repository라 제품 SSOT가 아니다.
권위는 `../screen-system.md`, `../decision-support.md`, `../mockups/analysis-detail-v1.png`에 있다.
공개된 검토 링크는 `https://eatbid-analysis-workbench-v1.huntington59.chatgpt.site`다.
```

- [ ] **Step 2: screen-system의 prototype 링크를 README로 바꾼다**

`analysis-hybrid-v1` 직접 링크를 `prototypes/README.md`로 교체하고 prototype source가 비권위임을 명시한다.

- [ ] **Step 3: canonical 문서와 직접 참조 자산만 명시적으로 stage한다**

Run: `git add docs/product/roadmap.md docs/product/decision-support.md docs/product/screen-system.md docs/product/design-brief-analysis-v1.md docs/product/prototypes/README.md docs/product/mockups docs/evidence/competitors docs/evidence/product-direction/2026-08-31-analysis-first-planning-audit.md eatbid-analysis-yulha.png docs/superpowers/plans/2026-09-01-fresh-session-execution.md`

Expected: `docs/product/prototypes/analysis-hybrid-v1`과 다른 세션 파일은 stage되지 않는다.

- [ ] **Step 4: clean-checkout 관점의 링크와 추적 상태를 확인한다**

Run: `git ls-files docs/product docs/evidence/competitors docs/evidence/product-direction eatbid-analysis-yulha.png`

Expected: `docs/README.md`와 canonical 문서가 가리키는 파일이 모두 출력된다.

### Task 3: R1 Linear 실행 계약 정규화

**Files:**
- External: Linear project `R1 — 유료 투찰 Decision Loop`
- External: `EAT-6`, `EAT-7`, `EAT-8`, `EAT-13`

**Interfaces:**
- Consumes: 저장소의 issue template heading 계약
- Produces: 문제·Outcome·Scope·Non-goals·Acceptance·Evidence/unknown·검증 계획·관련 링크가 완전한 이슈

- [ ] **Step 1: EAT-13을 R1 M0에 연결한다**

Expected: governance 작업이 제품 계약 확정 milestone에서 발견된다.

- [ ] **Step 2: EAT-6을 실제 R0 publication blocker가 명시된 Backlog issue로 고친다**

Expected: owned path는 `docs/product/decision-support.md`와 향후 별도 구현 이슈에서 claim할 계약 경로로 제한되고, R0 publication identifier가 없으면 시작하지 않는다고 적힌다.

- [ ] **Step 3: EAT-7을 EAT-6 완료 후 시작하는 Backlog issue로 고친다**

Expected: `blocked by EAT-6`과 실제 data publication 선행조건, API/UI owned path를 구현 시작 전에 확정하는 gate가 있다.

- [ ] **Step 4: EAT-8을 독립 실행 가능한 Ready discovery issue로 고친다**

Expected: repository mutation 없이 인터뷰 설계부터 시작할 수 있고, 산출물 위치와 개인정보 취급 범위가 명시된다.

- [ ] **Step 5: 프로젝트 Start Here를 갱신한다**

읽기 순서는 `AGENTS.md → docs/README.md → issue → roadmap → issue 관련 canonical 문서 → claim`이며, `Backlog/Blocked` 이슈는 임의로 시작하지 않는다고 적는다.

### Task 4: 새 세션 인수 검증

**Files:**
- Verify only: repository and Linear readback

**Interfaces:**
- Consumes: Task 1~3 산출물
- Produces: 새 세션이 추측 없이 시작할 수 있다는 검증 evidence

- [ ] **Step 1: workflow test와 문서 diff를 검증한다**

Run: `pnpm workflow:test`

Run: `git diff --check`

Expected: tests 47 이상, fail 0, whitespace error 0.

- [ ] **Step 2: 문서화된 claim 명령으로 EAT-13 lease를 재검증한다**

Run: `pnpm workflow:claim -- EAT-13`

Run: `pnpm workflow:doctor:infisical`

Expected: issue `EAT-13`, team `EAT`, 현재 worktree의 미만료 lease.

- [ ] **Step 3: Linear API readback으로 R1 상태를 확인한다**

Expected: EAT-6·7은 명시적 blocker가 있는 Backlog, EAT-8은 Ready, EAT-13은 M0이며 모든 이슈에 표준 heading이 있다.

- [ ] **Step 4: staged 범위를 검사한다**

Run: `git diff --cached --name-only`

Expected: EAT-13 owned path만 있고 백엔드·DB·인프라 파일은 없다.
