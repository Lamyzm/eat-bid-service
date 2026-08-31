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
