# Repository Review Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an enforceable Web architecture gate and a shared, read-only Codex advisory reviewer that can identify existing hook/utility reuse opportunities without replacing deterministic lint, type, or test authority.

**Architecture:** Repository-owned Node checkers fail closed on objective Web boundary violations and freeze legacy debt with exact deletion-only fingerprints. A separate review-context builder injects actual repository hook/utility source, locally installed `es-toolkit` declarations, and curated React/Next rules into a bounded prompt. A safe Codex CLI wrapper runs that prompt in read-only ephemeral mode and remains advisory; the active root Git hook calls it only for a push whose remote ref is `refs/heads/main` or an explicit opt-in.

**Tech Stack:** Node.js 24 ESM, TypeScript compiler API, `node:test`, SHA-256 deletion-only ledgers, Git pre-push protocol, Codex CLI 0.138-compatible `exec review`, JSON Schema structured output.

**Spec:** [eatbid 전체 기반 통합 설계](../specs/2026-08-31-eatbid-foundation-integration-design.md), [eatbid 프론트엔드 모듈 아키텍처 설계](../specs/2026-08-31-frontend-modular-architecture-design.md)

## Global Constraints

- `AGENTS.md`, Accepted ADR 0023, `docs/architecture/frontend-application-foundation.md`, and `apps/web/AGENTS.md` remain the authority; review catalogs are adapters, not a parallel source of architecture truth.
- Objective checks are fail-closed. AI findings are advisory and never replace lint, typecheck, tests, contract drift, or architecture checks.
- Existing Web debt is frozen by normalized repository path, rule, evidence kind, SHA-256, and multiplicity. A baseline may shrink but normal check mode may not add, rewrite, or rename an exception.
- Source files over 300 physical lines require a responsibility split or a reviewed entry with reason, owner, and next split trigger. Generated data remains explicit rather than receiving a broad directory exemption.
- Only `apps/web/src/api/_transport/**` may call raw `fetch` or decode a `Response` body. Canonical `/api/vN/...` literals and frontend `ENDPOINTS` mirrors remain forbidden outside their future operation authority.
- The reviewer may suggest an existing hook/utility only with file evidence. Zero consumers is a review candidate, not proof that a module is dead.
- `es-toolkit` is currently a transitive dependency only. The reviewer may cite its locally installed declaration surface, but any production import requires a direct exact dependency and a demonstrated repeated use case.
- Official React 19.2 guidance overrides stale copied examples: `useEffectEvent` is only for non-reactive events fired inside Effects, is not a general stable callback, is not passed to children, and is not placed in dependency arrays.
- React Compiler remains annotation mode. The reviewer may not add/remove memoization or compiler directives without behavior and performance evidence.
- The active hook authority is root `.githooks`; do not add a second root/app Husky execution path in this task.
- 새롭거나 실질적으로 바뀐 자명하지 않은 코드는 module 책임·이유·불변식을 간결한 한국어로 설명한다. token 주석, 줄별 번역과 generated/declarative noise는 금지한다.
- 앞으로 사람, Codex, Claude와 automation이 만드는 commit은 한국어 제목·본문을 사용한다. 기계가 읽는 Conventional Commit type/scope는 한국어 요약 앞에 둘 수 있으며, 이 계획으로 과거 commit을 다시 쓰지 않는다.
- 문자열이 반복된다는 이유만으로 global 상수가 되지 않는다. contract operation, domain value, Drizzle schema, typed config, API resource, feature-local constant, design token 중 가장 좁은 semantic owner가 권위다. 범용 global `constants.ts` mirror는 금지하고 generated artifact는 파생 결과로 유지한다.
- 기존 Web view/component 구조에는 호환성 가치가 없다. 승인된 product slice가 대체할 때 삭제할 수 있으며, 이 계획은 visual parity나 legacy component API가 아니라 검증된 데이터 의미와 동작 증거를 보존한다.
- The main migration is not complete until the remote default branch, protection, required checks, and trusted publication identity are changed together. This plan only prepares `refs/heads/main` local behavior; it does not delete `master` or mutate remote settings.
- All new or changed tests have Korean names and follow RED → GREEN. New production files stay below 300 lines.

---

### Task 1: Deterministic Web boundary and legacy-debt gate

**Files:**

- Create: `tools/architecture/web-boundaries/policy.mjs`
- Create: `tools/architecture/web-boundaries/inspect.mjs`
- Create: `tools/architecture/check-web-boundaries.mjs`
- Create: `tools/architecture/check-web-boundaries.test.mjs`
- Create: `tools/architecture/web-boundary-legacy-baseline.json`
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `docs/superpowers/plans/2026-08-31-frontend-architecture-foundation.md`

**Interfaces:**

- Produces: `inspectWebBoundaries({ repoRoot, sourceRoot, baselinePath }): Promise<WebBoundaryReport>`.
- Produces: a CLI `node tools/architecture/check-web-boundaries.mjs [--write-baseline]` and root `pnpm lint:web-boundaries`.
- Consumes: TypeScript 5.9 compiler APIs already installed at the workspace root; no new package.

- [ ] **Step 1: Write RED behavior tests**

  Add fixture-based Korean `node:test` cases that prove:

  - new `shell → api|capabilities`, cross-capability internal, cross-resource API, and deep resource imports fail while public `index.ts`/`server.ts` imports pass;
  - raw global/window `fetch`, typed `Response.json()`, unchecked `.json() as`, exported manual `*Response`/`*Dto` declarations under `src/api`, route-level `'use client'`, and identifier-to-`Number`/`parseInt` conversions fail;
  - `/api/v1/...` literals and `ENDPOINTS` declarations fail outside explicit contract/test/document fixtures;
  - exact duplicate source groups and source files over 300 lines are findings;
  - an exact legacy fingerprint passes, deleting it passes, and changing/adding/renaming it fails;
  - `--write-baseline` refuses to overwrite an existing baseline.

- [ ] **Step 2: Run RED**

  Run `node --test tools/architecture/check-web-boundaries.test.mjs` and record the expected missing-module/behavior failures.

- [ ] **Step 3: Implement the minimal checker**

  Use TypeScript AST and `ts.resolveModuleName`, sorted normalized `/` paths, and SHA-256 evidence. Exact duplicates require identical normalized bytes, at least 10 nonblank lines, and at least 200 bytes. Size uses normalized physical line count. The CLI prints every unmatched finding and exits nonzero; baseline deletions are accepted.

- [ ] **Step 4: Create and inspect the one-time baseline**

  Run `node tools/architecture/check-web-boundaries.mjs --write-baseline` once against the current tree. Every entry contains `rule`, `path`, `kind`, `sha256`, `reason`, `owner`, and `splitTrigger`; duplicate groups additionally contain sorted members. Replace generated generic metadata with reviewed EAT-9 reasons and triggers before normal check mode.

- [ ] **Step 5: Wire the gate**

  Add `lint:web-boundaries` before contract generation in root `architecture:check`, and run it before Oxlint in Web `lint:strict` so the cross-file gate is still visible while legacy Oxlint debt remains red. Mark the overlapping Task 1 in the frontend plan as satisfied only after this task's review passes.

- [ ] **Step 6: Verify GREEN and commit**

  Run:

  ```text
  node --test tools/architecture/check-web-boundaries.test.mjs
  pnpm lint:web-boundaries
  pnpm architecture:check
  git diff --check
  ```

  Commit: `test(architecture): enforce web review boundaries`

---

### Task 2: Bounded reuse and framework evidence bundle

**Files:**

- Create: `tools/review/catalog/frontend-advisory-rules.json`
- Create: `tools/review/reuse-catalog.mjs`
- Create: `tools/review/reuse-catalog.test.mjs`
- Create: `tools/review/build-review-context.mjs`
- Create: `tools/review/build-review-context.test.mjs`
- Create: `tools/review/reviewer-instructions.md`
- Modify: `package.json`

**Interfaces:**

- Produces: `buildReuseCatalog({ repoRoot, changedPaths }): Promise<ReuseCatalog>` with repository modules, exports, direct consumers, exact duplicate groups, and bounded source excerpts.
- Produces: `buildReviewContext({ repoRoot, scope }): Promise<string>` capped at 96 KiB.
- Consumes: Task 1 findings and the actual current sources under `apps/web/src/hooks`, `apps/web/src/shared`, and the compatibility `apps/web/src/lib/utils.ts`.

- [ ] **Step 1: Write RED catalog tests**

  Use temporary fixture repositories to prove the catalog:

  - resolves extensionless imports without double-counting `.ts`/`.tsx`;
  - records exported symbol names and actual external consumers;
  - marks zero consumers as `candidate`, never `unused` or a blocking finding;
  - collapses byte-identical hook files into one duplicate group;
  - includes full bounded source for relevant repository reuse candidates;
  - detects whether `es-toolkit` is directly declared and, when a local installed `dist/index.d.ts` exists, injects its real declaration text with package version and a transitive-only warning;
  - excludes secrets, generated output, lockfiles, and files beyond the byte cap.

- [ ] **Step 2: Run RED**

  Run `node --test tools/review/reuse-catalog.test.mjs tools/review/build-review-context.test.mjs` and record the expected missing-module failures.

- [ ] **Step 3: Implement the catalog and bounded selector**

  Parse imports/exports with TypeScript rather than grep. Always include changed Web modules and the small hook/shared catalog; include actual source only within per-file and total caps. If `es-toolkit` is transitive, allow a dependency proposal but forbid a direct-import recommendation. Never load an entire `node_modules` tree.

- [ ] **Step 4: Encode curated advisory rules**

  Give every rule a stable ID, applicability condition, counterexample condition, project authority path, and source URL. Include only review concerns not already deterministically decided: repository reuse, semantic duplication, business/View separation, RSC serialization, independent async waterfalls, `useEffectEvent`, global listener ownership, composition, immutable array operations, intentional `Activity`, and measured dynamic imports. Explicitly suppress generic SWR advice because this project chose TanStack Query.

- [ ] **Step 5: Build the reviewer instruction adapter**

  Require evidence at changed file/line, existing candidate path, confidence, and recommendation. Instruct the reviewer not to repeat deterministic lint diagnostics, not to auto-fix, not to invent product endpoints/contracts, and not to flag a module as dead from consumer count alone.

- [ ] **Step 6: Verify GREEN and commit**

  Run:

  ```text
  node --test tools/review/reuse-catalog.test.mjs tools/review/build-review-context.test.mjs
  node tools/review/build-review-context.mjs --base HEAD~1 --check
  git diff --check
  ```

  Commit: `feat(review): build bounded frontend evidence`

---

### Task 2A: 한국어 코드 설명·커밋 메시지·semantic ownership gate

**파일:**

- 생성: `tools/quality/check-korean-comments.mjs`
- 생성: `tools/quality/check-python-korean-comments.py`
- 생성: `tools/quality/check-korean-comments.test.mjs`
- 생성: `tools/quality/korean-comment-legacy-baseline.json`
- 생성: `tools/quality/check-commit-message.mjs`
- 생성: `tools/quality/check-commit-message.test.mjs`
- 생성: `tools/git/configure-hooks.mjs`
- 생성: `.githooks/commit-msg`
- 수정: `tools/architecture/web-boundaries/global-fetch-analysis.mjs`
- 수정: `tools/architecture/check-web-boundaries.test.mjs`
- 수정: `AGENTS.md`
- 수정: `apps/web/AGENTS.md`
- 수정: `docs/architecture/frontend-application-foundation.md`
- 수정: `tools/review/catalog/frontend-advisory-rules.json`
- 수정: `tools/review/reviewer-instructions.md`
- 수정: `.github/workflows/build.yml`
- 수정: `.githooks/pre-push` executable mode
- 수정: `package.json`

**Interface:**

- 제공: `validateCommitMessage(message): CommitMessageResult`와 CLI `node tools/quality/check-commit-message.mjs <message-file>`.
- 제공: 정확하고 immutable한 legacy ledger와 Python helper를 사용하는 tracked-file 한국어 module 책임 검사기.
- 제공: 유일한 commit hook owner인 root `.githooks/commit-msg`. root install/bootstrap은 Husky 없이 `core.hooksPath=.githooks`를 설정한다.
- 사용: Task 2 breaker finding, commit `e7fdcd2` 시점의 규칙 도입 전 legacy tree, 현재 `AGENTS.md` 권위와 기존 `architecture:check`/`quality:check` chain.

- [x] **1단계: RED 증거로 이어받은 spread 위치 false positive 수정**

  불확정 spread가 뒤따르더라도 이미 확인된 위치 역할은 보존한다. bound `thisArg`일 뿐임이 입증된 DOM fetch 값이 callable target을 오염시키면 안 된다. 의도한 unknown-spread fail-closed case, local-shadow control과 duplicate suppression은 유지한다.

- [x] **2단계: 주석·commit 정책의 한국어 RED 테스트 작성**

  TypeScript/TSX directive와 shebang, Python module docstring, generated/test/fixture/declarative/barrel 제외, 한국어 책임 header, token/generic 주석, 정확한 legacy hash, 변경된 legacy 파일과 새 파일을 다룬다. 한국어 conventional/no-prefix commit, 한국어 본문 문단, 영문·빈 값·merge·revert·fixup·squash·release·bot 제목, 주석, fenced code, URL-only metadata와 Git trailer를 검증한다.

- [x] **3단계: 한국어 책임 주석 gate 구현**

  대상 production module에는 `@module 책임:`(JS/TS family) 또는 `모듈 책임:` module docstring(Python)을 요구한다. 존재, 위치, 한국어 여부와 명백한 token 주석은 결정적으로 검사하고 semantic 정확성은 review가 소유한다. 좁게 정의한 generated output, test/fixture, pure barrel과 declarative schema/config는 제외한다. 일회성 ledger에는 full legacy commit `e7fdcd2`에 존재하던 변경되지 않은 대상 blob만 들어갈 수 있고 overwrite를 거부하며 줄어들 수는 있어도 현재 branch code를 grandfather하지 않는다.

- [x] **4단계: 한국어 commit gate와 hook bootstrap 구현**

  선택적 Conventional Commit prefix를 허용하되 제목 요약에는 한글을 요구한다. 선택적 prose 본문 문단도 한글을 요구하고 빈 줄, Git comment, fenced code, URL-only 기술 줄과 끝 trailer는 제외한다. Merge/revert/fixup/squash/release와 automation에는 언어 우회를 주지 않는다. 과거 commit은 범위 밖으로 둔다. POSIX `commit-msg` hook을 추가하고 root hook을 executable로 만들며 `.githooks`만 설정하고 deployment automation commit template을 한국어로 바꾼다.

- [x] **5단계: semantic ownership과 disposable view 규칙을 한 곳에 기록**

  root `AGENTS.md`를 확장하고 `CLAUDE.md`와 `.cursor`는 중복 권위가 아닌 adapter로 유지한다. Web 규칙과 문서에는 기존 view가 조사 재료이지 호환성 대상이 아님을 명시한다. 의미 있는·오래된 주석과 semantic owner 선택을 위한 advisory review 규칙을 추가한다. global constants package를 만들거나 legacy `part_n`을 승격하지 않는다. 미래 canonical 이름은 mart 계약을 통해 fact에서 파생한 resource 단위 `participationCount`/`awardCount`다.

- [x] **6단계: GREEN 검증과 한국어 commit**

  다음을 실행한다.

  ```text
  node --test tools/architecture/check-web-boundaries.test.mjs
  node --test tools/quality/check-korean-comments.test.mjs tools/quality/check-commit-message.test.mjs
  pnpm quality:check
  pnpm architecture:check
  pnpm test:quality
  node tools/quality/check-commit-message.mjs <temporary-valid-message-file>
  git diff --check
  ```

  commit 예시: `feat(quality): 한국어 코드 설명과 커밋 규칙을 강제한다`

---

### Task 3: Read-only Codex advisory command and `main` pre-push trigger

**Files:**

- Create: `tools/review/review-result.schema.json`
- Create: `tools/review/git-scope.mjs`
- Create: `tools/review/codex-advisory.mjs`
- Create: `tools/review/codex-advisory.test.mjs`
- Create: `tools/review/pre-push.mjs`
- Create: `tools/review/pre-push.test.mjs`
- Create: `docs/operations/ai-code-review.md`
- Modify: `.githooks/pre-push`
- Modify: `package.json`
- Modify: `docs/governance/ai-driven-documentation.md`
- Modify: `apps/web/AGENTS.md`

**Interfaces:**

- Produces: `pnpm review:ai -- --base <branch>`.
- Produces: `runCodexAdvisory({ repoRoot, baseRef, executable, timeoutMs }): Promise<ReviewRunResult>`.
- Produces: `runPrePush({ stdin, env, runRequired, runAdvisory }): Promise<number>`.
- Consumes: Task 2 review context and Codex CLI global flags before `exec review`.

- [ ] **Step 1: Write RED process-boundary tests**

  Use a fake executable and temporary Git repository to prove:

  - argv is exactly `--sandbox read-only --ask-for-approval never exec review --base <branch> --ephemeral --ignore-user-config --ignore-rules --output-schema <path> --json --output-last-message <path> -` with no shell interpolation;
  - prompt bytes are sent only through stdin and environment variables are allowlisted without token/secret/Infisical/Linear values;
  - dirty trees, invalid/non-ancestor base refs, more than 100 files, more than 6,000 changed lines, more than 1 MiB patch, and denied secret/generated paths are refused before Codex starts;
  - timeout kills the process tree and returns a typed advisory-unavailable result;
  - structured output rejects unknown paths, invalid line spans, more than 50 findings, and malformed JSON;
  - only validated success is cacheable, with a key containing policy/prompt/schema/Codex versions, model, base/merge-base/head, path hash, and diff-stat hash;
  - audit metadata contains hashes/status/duration but no prompt, patch, environment, or raw result.

- [ ] **Step 2: Run RED**

  Run `node --test tools/review/codex-advisory.test.mjs tools/review/pre-push.test.mjs` and record the expected missing-module failures.

- [ ] **Step 3: Implement safe Git scope and Codex execution**

  Resolve a branch-like base ref, merge-base, HEAD, changed paths, numstat, and patch bytes with direct `spawn` argv. Require a clean worktree. Discover a native executable through `CODEX_REVIEW_BIN`, `codex.exe` on Windows, or `codex` on POSIX without `shell: true`. Use a minimal environment, OS temp files with `finally` cleanup, the Git-common-dir workflow lock, and a 180-second default timeout. The structured schema version is `eatbid.codex-review/v1`.

- [ ] **Step 4: Implement advisory result policy**

  Valid findings are printed and return process code 0. Preflight refusal, lock contention, missing/auth-failing CLI, timeout, and invalid output are clearly reported as `advisory unavailable` and also return 0 from the package command; the typed internal category remains available to tests and audit. No mode may mutate or apply a finding.

- [ ] **Step 5: Replace the active pre-push body with the Node orchestrator**

  Preserve `pnpm test` for every push. Parse every stdin update and run `pnpm architecture:check` plus `pnpm review:ai -- --base origin/main` only when a remote ref is exactly `refs/heads/main`; `EATBID_AI_REVIEW=1` enables an explicit feature-branch run with `EATBID_REVIEW_BASE`. AI failure never overrides a required command failure.

- [ ] **Step 6: Document the actual authority and limitations**

  State that root `.githooks` is active, app Husky files are inert legacy, PR CI remains the eventual merge authority, `exec review` read-only is not a strong secret-isolation sandbox, and remote `main` settings/publication identity are a separate migration gate. Claude and Codex both call the same package command.

- [ ] **Step 7: Verify GREEN and commit**

  Run:

  ```text
  node --test tools/review/*.test.mjs
  pnpm review:ai -- --base master
  pnpm workflow:test
  pnpm test:quality
  pnpm architecture:check
  pnpm test
  git diff --check
  ```

  Commit: `feat(review): add shared Codex advisory gate`

---

### Task 4: Independent branch review and handoff

**Files:**

- Modify only for verified drift: `docs/operations/ai-code-review.md`
- Modify only for verified plan status: `docs/superpowers/plans/2026-08-31-frontend-architecture-foundation.md`

**Interfaces:**

- Consumes: Tasks 1–3 commits and reports.
- Produces: independent task reviews, one whole-branch review, and fresh verification evidence.

- [ ] **Step 1: Obtain task-scoped independent reviews**

  Review each task against its brief and diff. Fix every Critical/Important finding through the original implementer and obtain a scoped re-review.

- [ ] **Step 2: Run fresh whole-branch verification**

  Run `pnpm test`, `pnpm architecture:check`, `pnpm workflow:test`, `node --test tools/review/*.test.mjs`, `pnpm lint:web-boundaries`, and `git diff --check`. Report the known Node `24.2.0` versus required `24.20.0` engine warning separately from test failures.

- [ ] **Step 3: Obtain the final independent code review**

  Review the full merge-base-to-HEAD diff for spec compliance, process safety, secret exposure, cross-platform behavior, false-positive policy, and hook authority. No unresolved Critical/Important finding may remain.

- [ ] **Step 4: Stop before external branch mutation**

  Do not push, merge, rename the remote default branch, alter protection, or change Cosign identity without the separate main-migration step. Hand off exact commits and remaining external actions.
