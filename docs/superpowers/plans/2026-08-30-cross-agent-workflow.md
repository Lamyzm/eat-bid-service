---
status: superseded
issue: https://github.com/Lamyzm/eat-bid-service/issues/1
shared_status: superseded-by-linear
superseded_by: docs/superpowers/plans/2026-08-30-linear-agent-workflow.md
---

# Codex + Claude Code Cross-Agent Workflow Implementation Plan

> 이 체크리스트는 GitHub Issue를 SSOT로 검토했던 역사 기록이다. 2026-08-30에 Linear가 살아 있는
> work item의 SSOT로 채택되어 현재 workflow에는 적용하지 않는다. 대체 설계와 구현 계획은
> `2026-08-30-linear-agent-workflow.md`를 따른다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's product and engineering workflow equally usable from Codex and Claude Code without duplicating project truth or live work status in Markdown.

**Architecture:** `AGENTS.md` remains the shared repository contract. Claude-specific entrypoints import the relevant `AGENTS.md`; GitHub Issues/Projects own changing work state; repository documents own stable product and architecture knowledge; an OpenSpec delta is optional for ambiguous medium changes and required for large behavior changes. Tool-specific memory, hooks, and agent configurations may automate the workflow but never own product decisions or completion state.

**Tech Stack:** Markdown, Claude Code project instructions, GitHub Issue Forms, existing ADR/architecture documentation

**Spec:** `docs/governance/ai-driven-documentation.md`

## Global Constraints

- Preserve the authority order and all twelve invariants in root `AGENTS.md`.
- Do not install OpenSpec, Spec Kit, BMAD, GSD, or another task database in this change.
- Do not change product code, database schemas, deployment resources, or another session's existing working-tree changes.
- Do not treat Claude auto memory, Codex conversation state, or Markdown task checkboxes as shared work status.
- Do not introduce recommended bid prices, predicted prices, or automated NeaT submission.

---

### Task 1: Normalize agent entrypoints

**Files:**
- Modify: `CLAUDE.md`
- Modify: `apps/web/CLAUDE.md`
- Modify: `apps/web/AGENTS.md`

**Interfaces:**
- Consumes: root `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, and the actual `apps/web/package.json`
- Produces: one shared root contract plus a concise web-only extension, with Claude adapters that contain no duplicate product rules

- [x] **Step 1: Replace the root Claude document with an import adapter**

  Make `CLAUDE.md` import `AGENTS.md`, identify conversation/auto-memory as non-authoritative, and point Claude to the shared work item rather than a progress text file.

- [x] **Step 2: Replace the web Claude document with a local import adapter**

  Make `apps/web/CLAUDE.md` import `apps/web/AGENTS.md` and contain no duplicated framework conventions.

- [x] **Step 3: Reduce the web AGENTS file to verified local constraints**

  Keep only the current Next.js, package-manager, data-fetching, icon, formatting, and product-boundary rules that differ from the repository root. Remove starter-template claims, obsolete versions, and instructions that invent a separate product identity.

- [x] **Step 4: Inspect the resulting instruction chain**

  Verify that launching Claude from the repository root reads root `AGENTS.md`, and working under `apps/web` adds only the nested web constraints.

### Task 2: Replace document-centric work tracking with a cross-agent contract

**Files:**
- Modify: `docs/governance/ai-driven-documentation.md`
- Modify: `docs/README.md`
- Modify: `docs/product/roadmap.md`

**Interfaces:**
- Consumes: the existing product roadmap, architecture authority model, and the reviewed Codex/Claude/OpenSpec/GitHub capabilities
- Produces: a stable knowledge map, a capability-oriented roadmap, and one workflow that both agents can execute

- [x] **Step 1: Rewrite the governance conclusion and source-of-truth table**

  Assign stable product knowledge to repository docs, live status to GitHub Issues/Projects, change contracts to optional OpenSpec deltas, architectural rationale to ADRs, and completion evidence to PR/CI.

- [x] **Step 2: Define the S/M/L workflow**

  Use `Issue → PR` for small changes, `Issue → OpenSpec delta → PR` for medium changes, and add an ADR for large changes that alter an architecture boundary. Require one writing agent and a different reviewing agent for material work.

- [x] **Step 3: Remove the mandatory feature document bundle**

  Delete the rule requiring `spec.md`, `plan.md`, `tasks.md`, and `verification.md` for every meaningful feature. Preserve historical plans as records, but do not use them as live status.

- [x] **Step 4: Reframe the knowledge map and roadmap**

  Make `docs/README.md` describe Issue/OpenSpec/PR authority and make `docs/product/roadmap.md` a product capability and outcome-gate map. Remove the live feature-status table from the roadmap.

### Task 3: Add a tool-neutral work intake contract

**Files:**
- Create: `.github/ISSUE_TEMPLATE/product-change.yml`
- Create: `.github/ISSUE_TEMPLATE/incident.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Consumes: product roadmap outcomes, architecture invariants, and the S/M/L workflow
- Produces: one structured work item that Codex, Claude Code, and a human reviewer can all use without relying on chat history

- [x] **Step 1: Add the product-change Issue Form**

  Collect the user problem, expected outcome, scope, non-goals, evidence, acceptance criteria, risk/size, architecture impact, and verification evidence. Do not ask the reporter to preselect an implementation.

- [x] **Step 2: Add Issue template configuration**

  Disable blank issues after adding a small incident form, and link no external tracker.

- [x] **Step 3: Add the PR evidence template**

  Require the linked Issue, writing/review owners, approved scope, acceptance evidence, executed and omitted verification, and remaining risk.

### Task 4: Remove stale Claude-only commands from automatic context

**Files:**
- Move: `.claude/rules/*.md` → `docs/evidence/claude-incident-lessons/*.md`

**Interfaces:**
- Consumes: Claude Code's path-scoped rules mechanism and existing legacy incident evidence
- Produces: preserved historical evidence that no Claude session treats as current target architecture

- [x] **Step 1: Move the legacy rules out of Claude's automatic context**

  Preserve every incident lesson under `docs/evidence/claude-incident-lessons/` and mark the directory as historical evidence, not current instructions.

- [x] **Step 2: Leave `.claude/rules/` empty**

  Keep shared invariants in root `AGENTS.md`, architecture documents, ADRs, repository scripts, and CI rather than rebuilding Claude-only commands.

### Task 5: Review and verify the documentation-only change

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-cross-agent-workflow.md`

**Interfaces:**
- Consumes: the complete diff and independent attacker/defender reviews
- Produces: a checked implementation that does not overwrite unrelated working-tree changes

- [x] **Step 1: Run an attacker review**

  Ask whether the workflow can drift, duplicate state, hide a product decision in tool-specific memory, or let two agents edit the same work item.

- [x] **Step 2: Run a defender review**

  Ask whether the workflow is usable for a solo founder, avoids unnecessary ceremony, and retains enough context for both agents.

- [x] **Step 3: Inspect links and whitespace**

  Run scoped `git diff --check` and inspect every changed Markdown link. Do not run product tests because no product code changes in this plan.

- [x] **Step 4: Confirm working-tree preservation**

  Compare `git status --short` with the baseline and verify that the pre-existing schema, Gate A, image deletion, and `tmp/` changes were not modified by this plan.

- [x] **Step 5: Mark the plan complete**

  Check completed steps only after their evidence exists; leave any intentionally deferred item unchecked with a concrete reason.
