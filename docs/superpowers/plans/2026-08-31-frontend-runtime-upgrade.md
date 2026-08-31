# Frontend Runtime Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Web runtime to the reviewed exact Next/React/TanStack/Tailwind lane, remove the React-19-incompatible command-palette dependency, make clean-checkout type generation deterministic, and install an inert-by-default React Compiler boundary without enabling unrelated experimental features.

**Architecture:** Keep the current App Router deployable intact while upgrading its runtime underneath it. A repository check owns exact Web runtime policy; `typedRoutes` and annotation-mode React Compiler are explicit top-level Next options. Cache Components, the Rust compiler path, and TanStack Form v2 remain disabled.

**Tech Stack:** Next.js 16.3.3, React/React DOM 19.2.8, TypeScript 5.9.3, TanStack Query 5.102.8, TanStack Form 1.33.5, Tailwind CSS 4.3.3, Zod 4.5.4, React Compiler Babel plugin 1.0.0, Bun test types 1.2.22, Testing Library 16.3.3/user-event 14.6.6, Happy DOM 20.12.0, pnpm 10.12.1.

**Spec:** [Frontend modular architecture design](../specs/2026-08-31-frontend-modular-architecture-design.md)

## Global Constraints

- The repository-wide integration sequence requires the `main` PR gate and ingestion spine hardening before this
  runtime work is merged to the canonical branch. It may be prepared in the isolated EAT-9 worktree, but may not
  bypass those integration predecessors.
- Work only in the claimed EAT-9 worktree and keep one writing owner.
- Use exact versions for every foundation dependency named by this plan; keep Zod on the exact root catalog entry and update `pnpm-lock.yaml` with pnpm only.
- Do not enable `cacheComponents`, `experimental.turbopackRustReactCompiler`, or TanStack Form v2.
- Do not treat Sentry `reactComponentAnnotation` as React Compiler annotation mode; they are unrelated settings.
- New and changed test names are Korean.
- The current shell Node 24.2.0 is diagnostic-only; final release evidence requires repository-pinned Node 24.20.0.
- Preserve existing theme behavior and application routes. Product UI redesign is outside this plan.
- Do not invent a destination for dead navigation. Remove an unavailable action or leave it unexposed until product planning creates a real route.
- Commit after each task only when its stated checks pass.

---

## Task 1: Make the runtime target mechanically enforceable

**Files:**

- Create: `tools/architecture/check-web-runtime.mjs`
- Create: `tools/architecture/check-web-runtime.test.mjs`

- [ ] Write failing `node:test` cases named in Korean that create minimal root/Web package and config fixtures and reject:
  - a non-exact or wrongly placed Next, React, React DOM, TypeScript, Query, Query Devtools, Form, Tailwind, Tailwind PostCSS, React Compiler, Bun types, Testing Library, user-event, Happy DOM, `server-only`, or `@eatbid/contracts` declaration;
  - a root Zod catalog entry other than exact `4.5.4`, or a Web Zod declaration that bypasses `catalog:`;
  - any `kbar` declaration in the Web manifest;
  - a missing `next typegen && tsc --noEmit` typecheck command;
  - missing top-level `typedRoutes: true`;
  - React Compiler without `compilationMode: 'annotation'`;
  - either `cacheComponents` or `experimental.turbopackRustReactCompiler` being enabled;
  - TanStack Form `2.x` or a prerelease range.
- [ ] Export `checkWebRuntime({ repositoryRoot })` from `check-web-runtime.mjs`; make its CLI print all violations and exit non-zero without rewriting files.
- [ ] Keep the checker unwired from root `architecture:check` until Tasks 2 and 3 make the real repository green. The checker tests may commit independently; a mandatory repository gate may never be committed intentionally red.
- [ ] Run the focused RED command and retain the failing output:

```text
node --test tools/architecture/check-web-runtime.test.mjs
```

- [ ] Implement the fixture checker until its tests pass. Do not weaken a fixture to match current package drift.
- [ ] Commit:

```text
test(architecture): pin the web runtime contract
```

## Task 2: Upgrade the Web dependency lane and remove the incompatible KBar closure

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/components/command-palette/command-palette.tsx`
- Create: `apps/web/src/components/command-palette/command-palette.test.tsx`
- Create: `apps/web/src/components/command-palette/context.tsx`
- Create: `apps/web/src/components/command-palette/theme-actions.ts`
- Create: `apps/web/bunfig.toml`
- Create: `apps/web/test/setup-dom.ts`
- Modify: `apps/web/src/app/dashboard/layout.tsx`
- Modify: `apps/web/src/components/search-input.tsx`
- Delete: `apps/web/src/components/kbar/index.tsx`
- Delete: `apps/web/src/components/kbar/render-result.tsx`
- Delete: `apps/web/src/components/kbar/result-item.tsx`
- Delete: `apps/web/src/components/kbar/use-theme-switching.tsx`

- [ ] Run the runtime checker against the current repository and retain its expected RED result.
- [ ] Change the Web manifest to these exact declarations and placements:
  - production dependencies: `next: 16.3.3`, `react: 19.2.8`, `react-dom: 19.2.8`, `@tanstack/react-query: 5.102.8`, `@tanstack/react-query-devtools: 5.102.8`, `@tanstack/react-form: 1.33.5`, `zod: catalog:`, `server-only: 0.0.1`, and `@eatbid/contracts: workspace:*`;
  - development dependencies: `typescript: 5.9.3`, `tailwindcss: 4.3.3`, `@tailwindcss/postcss: 4.3.3`, `babel-plugin-react-compiler: 1.0.0`, `@types/bun: 1.2.22`, `@testing-library/react: 16.3.3`, `@testing-library/user-event: 14.6.6`, `happy-dom: 20.12.0`, and `@happy-dom/global-registrator: 20.12.0`;
  - root catalog: exact `zod: 4.5.4`.
- [ ] Remove `kbar`. Its locked `react-virtual@2.10.4` closure declares only React 16/17 peers and cannot remain in a React 19 release candidate; do not hide this with a peer override.
- [ ] Rebuild the existing command palette with the already-installed `cmdk`/shared Command primitive. Preserve Cmd/Ctrl+K, keyboard selection, filtered navigation, theme actions, focus restoration, and the search trigger; this is a compatibility migration, not a visual redesign.
- [ ] Configure Bun's Web-local test preload to register Happy DOM and Testing Library cleanup. Run Web tests from the `apps/web` package directory so the preload is deterministic; do not replace interaction assertions with source-regex tests.
- [ ] Add Korean behavior tests for opening/closing, keyboard selection, route execution, theme action execution, and returning focus to the trigger.
- [ ] Keep `@eatbid/shared` temporarily because legacy pages still import it; its removal belongs to slice retirement, not this upgrade.
- [ ] Add the Web `test` script as `bun test src` so the package has one reproducible test entry used by local and CI gates.
- [ ] Replace the Web typecheck script with `next typegen && tsc --noEmit` and add a `pretypecheck` script that builds `@eatbid/domain`, `@eatbid/contracts`, and `@eatbid/shared` in dependency order.
- [ ] Add the same dependency builds to `prebuild` so `pnpm --filter @eatbid/web build` works from a clean checkout.
- [ ] Add a clean-checkout `predev` dependency build for filtered Web startup. This is only a bootstrap guarantee;
  the architecture plan's contract-export task must add a verified source/watch lane before Web imports the contract,
  so dev correctness never depends on a stale ignored `packages/contracts/dist`.
- [ ] Update the lock only with:

```text
pnpm install --lockfile-only --strict-peer-dependencies
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --filter @eatbid/web... install --frozen-lockfile --strict-peer-dependencies
```

- [ ] Verify resolved top-level versions:

```text
pnpm --filter @eatbid/web list --depth 0
pnpm why react-virtual
pnpm --filter @eatbid/web test
```

- [ ] Commit:

```text
build(web): pin the reviewed runtime lane
```

## Task 3: Enable stable typed routes and controlled compiler configuration

**Files:**

- Modify: `apps/web/next.config.ts`
- Modify: `tools/architecture/check-web-runtime.test.mjs`
- Modify: `package.json`

- [ ] Add a failing repository-fixture test that distinguishes Next React Compiler config from Sentry component annotation.
- [ ] Set these top-level `NextConfig` fields in `baseConfig`:

```ts
typedRoutes: true,
reactCompiler: {
  compilationMode: 'annotation'
}
```

- [ ] Leave `cacheComponents` and every Rust compiler option absent. Add a concise comment explaining that route/Suspense/auth/cache coordination must be audited before Cache Components are enabled.
- [ ] Keep existing Sentry wrapping and its `webpack.reactComponentAnnotation` configuration unchanged.
- [ ] Confirm the source tree contains no `"use memo"`/`"use no memo"` candidate yet. Annotation mode is therefore a reviewed configuration boundary, not a claimed optimization; the first opt-in component requires separate behavior and before/after performance evidence.
- [ ] Wire `node tools/architecture/check-web-runtime.mjs` into root `architecture:check` only after the real repository passes the checker.
- [ ] Run:

```text
node --test tools/architecture/check-web-runtime.test.mjs
node tools/architecture/check-web-runtime.mjs
```

- [ ] Commit:

```text
build(web): enable typed routes and compiler annotation mode
```

## Task 4: Make existing navigation satisfy typed routes without casts

**Files:**

- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/config/nav-config.ts`
- Modify: `apps/web/src/components/command-palette/command-palette.tsx`
- Modify: `apps/web/src/components/layout/sidebar-account.tsx`
- Modify: `apps/web/src/app/dashboard/today/page.tsx`
- Modify every additional navigation caller reported by generated route types; record the complete inventory before editing.

- [ ] Run `pnpm --filter @eatbid/web typecheck` and retain the complete typed-route failure inventory, not only the first diagnostic.
- [ ] Import Next's generated `Route` type and define internal navigation URLs as `Route | '#'`; keep external URLs on explicit anchor-only types.
- [ ] Type the command palette's navigation action as `Route` and narrow out `'#'` before calling `router.push`.
- [ ] Remove the unavailable `/dashboard/notifications` action because no route exists and product navigation has not authorized one. Do not create a placeholder page or silently redirect it.
- [ ] Rewrite composed dynamic URLs such as the Today analysis link as generated-route-compatible template literals with `URLSearchParams`; preserve the existing destination and query values.
- [ ] Do not silence errors with `as Route`, `as any`, or by widening route props back to `string`.
- [ ] Run:

```text
pnpm --filter @eatbid/web typecheck
pnpm --dir apps/web exec oxlint src/types/index.ts src/config/nav-config.ts src/components/command-palette src/components/layout/sidebar-account.tsx src/app/dashboard/today/page.tsx --deny-warnings
```

- [ ] Commit:

```text
refactor(web): make navigation route-safe
```

## Task 5: Prove the runtime upgrade; promote it only in the pinned runtime

**Files:**

- Modify only if evidence changes: `docs/architecture/stack/application-runtime.md`
- Modify only if commands change: `apps/web/AGENTS.md`

- [ ] Run the complete focused chain in this order:

```text
node tools/architecture/check-stack-docs.mjs
node tools/architecture/check-web-runtime.mjs
node --test tools/architecture/check-stack-docs.test.mjs tools/architecture/check-web-runtime.test.mjs
pnpm architecture:check
pnpm --filter @eatbid/web test
pnpm --filter @eatbid/web typecheck
pnpm --dir apps/web exec oxlint next.config.ts src/types/index.ts src/config/nav-config.ts src/components/command-palette src/components/layout/sidebar-account.tsx src/app/dashboard/today/page.tsx --deny-warnings
pnpm --filter @eatbid/web build
pnpm --filter @eatbid/web... install --frozen-lockfile --strict-peer-dependencies
git diff --check
```

- [ ] Confirm the build log uses Next 16.3.3 and does not report Cache Components or the Rust compiler path as enabled.
- [ ] Start the production build and hard-navigate directly to `/welcome` and `/dashboard/today`; verify document responses, hydration, command-palette keyboard behavior, theme persistence, browser back/forward, and no browser/server console errors.
- [ ] Confirm annotation mode has no opted-in source candidate and make no compiler behavior/performance claim. Before any future `"use memo"` lands, require a behavior regression test and comparative performance evidence for that exact candidate.
- [ ] Treat Node 24.2.0 results as source diagnostics only. The same frozen-install, test, typecheck, build, and hard-navigation chain must pass under repository-pinned Node 24.20.0 locally or in CI before calling the result a release candidate.
- [ ] Update runtime documentation only when the frozen lock proves a different resolved fact.
- [ ] Commit:

```text
docs(web): record runtime upgrade evidence
```
