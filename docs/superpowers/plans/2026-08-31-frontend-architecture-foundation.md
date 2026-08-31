# Frontend Architecture Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish enforceable Web module boundaries, a contract-validating resource API, a behavior-preserving shell, and the first canonical auction read slice without redesigning product screens or inventing missing backend contracts.

**Architecture:** `app` owns Next lifecycle and route-private presentation, `shell` owns providers/chrome, `capabilities` own reusable user intents and orchestration, `api/<resource>` owns consumer adapters and Query Options, and `shared` owns generic UI/lib. `packages/contracts` owns one resource-scoped operation descriptor from which Nest paths, OpenAPI paths and encoded Web request paths are derived. Browser and RSC entries share contract decoding but remain separate import graphs. The first executable slice is `/auctions/[auctionId]` backed by the existing Nest V1 operation.

**Tech Stack:** Next.js App Router/RSC, React 19, `@eatbid/contracts` Zod 4 schemas, TanStack Query v5 `queryOptions`, nuqs, stable TanStack Form v1, Tailwind CSS v4 semantic tokens, Base UI/shadcn primitives, Bun tests, Node architecture gates.

**Spec:** [Frontend modular architecture design](../specs/2026-08-31-frontend-modular-architecture-design.md)

## Global Constraints

- The repository-wide integration sequence requires the `main` PR gate and ingestion spine hardening before EAT-9
  merges to the canonical branch. Worktree preparation is allowed, but integration may not bypass those predecessors.
- Execute [Frontend Runtime Upgrade](2026-08-31-frontend-runtime-upgrade.md) first; this plan assumes its exact dependency lane and deterministic typecheck.
- Work only in the claimed EAT-9 worktree and keep one writing owner. Review agents are read-only.
- Do not edit EAT-5-owned product/domain roadmap files or reconcile their temporary frontend-deferral wording in this branch.
- `packages/contracts` owns operation method, version, semantic path/input builder and wire schemas; Nest owns endpoint behavior; Web owns only the consumer adapter/query placement.
- API origin is runtime configuration. Next screen routes are owned by `app/` plus generated route types. Neither belongs in the public HTTP operation registry.
- No new market, analysis, work-item, candidate, auth, or school API is allowed until its Server contract exists.
- Tests are written first and every new or changed test name is Korean.
- Every Query `AbortSignal` reaches `fetch`; every public 2xx body is parsed from `unknown` with its operation response schema.
- Only `src/api/_transport/**` may call raw `fetch` or decode a `Response` body. Resource modules must use the injected contract transport.
- No `res.json() as T`, unvalidated `res.json()`, manual public DTO, ID `Number` conversion, capability-to-capability import, API-resource cross-import, or product Route Handler.
- `/api/**` is Nest-owned. A Server Action is allowed only as a thin Zod-validated caller of the same resource
  `server.ts` for progressive enhancement/RSC invalidation/server-only cookie composition; it may not own DB/domain
  logic or a parallel command contract.
- A source file over 300 lines must be split or have an explicit reviewed waiver with reason, owner, and next split trigger.
- Preserve existing theme mode/palette controls and common Button press feedback. Do not put auth or logging inside the base Button.
- Commit after each task only when its stated checks pass.

---

## Task 1: Freeze legacy debt and enforce the new import graph

**Files:**

- Create: `tools/architecture/check-web-boundaries.mjs`
- Create: `tools/architecture/check-web-boundaries.test.mjs`
- Create: `tools/architecture/web-boundaries/policy.mjs`
- Create: `tools/architecture/web-boundaries/inspect.mjs`
- Create: `tools/architecture/web-boundary-legacy-baseline.json`
- Modify: `package.json`

- [ ] Write failing `node:test` fixtures named in Korean for these rules:
  - `shell` importing `api` or `capabilities` fails;
  - one capability importing another capability's internals fails;
  - an API resource importing another API resource fails;
  - `@/api/auctions/get-auction` deep import fails while `@/api/auctions` and `@/api/auctions/server` pass;
  - direct `fetch` or `Response.json()` outside `src/api/_transport/**` fails, including a resource module that tries to bypass `_transport` with plain `await response.json()`;
  - unchecked `.json() as` and a manual public response interface fail;
  - within a resource, only `index.ts` may import `browser-request`, only `server.ts` may import `server-request.server`, and transport-neutral operation files may import only the `ContractRequest` type;
  - `'use client'` in a `page.tsx` or `layout.tsx` fails, while a route `error.tsx` is allowed;
  - an ID passed through `Number`/`parseInt` fails;
  - a source over 300 lines without a complete waiver fails;
  - an exact legacy baseline fingerprint passes, but changing its content without deleting the violation fails.
- [ ] Implement `inspectWebBoundaries({ sourceRoot, baselinePath })` and a check-only CLI. Use normalized paths plus SHA-256 fingerprints for deletion-only legacy entries; never match by path alone.
- [ ] Support `--write-baseline` only for the initial reviewed inventory. Each entry records `rule`, `path`, `sha256`, `reason`, `owner`, and `splitTrigger`.
- [ ] Generate the baseline once from the post-runtime-upgrade legacy tree, inspect every entry, then run the checker without `--write-baseline`.
- [ ] Add `node tools/architecture/check-web-boundaries.mjs` to root `architecture:check` after the Web runtime check.
- [ ] Run:

```text
node --test tools/architecture/check-web-boundaries.test.mjs
node tools/architecture/check-web-boundaries.mjs
```

- [ ] Commit:

```text
test(architecture): enforce web module boundaries
```

## Task 2: Make the public HTTP operation descriptor the path authority

**Files:**

- Create: `packages/contracts/src/api/operation.ts`
- Create: `packages/contracts/src/api/operation.test.ts`
- Create: `packages/contracts/src/api/v1/auctions/index.ts`
- Create: `tools/architecture/check-contract-client-exports.mjs`
- Create: `tools/architecture/check-contract-client-exports.test.mjs`
- Create: `tools/architecture/check-http-operations.mjs`
- Create: `tools/architecture/check-http-operations.test.mjs`
- Modify: `packages/contracts/src/api/v1/auctions/operations.ts`
- Modify: `packages/contracts/src/operations/health.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/tsconfig.json`
- Modify: `apps/server/src/modules/procurement/presentation/http/auction.controller.ts`
- Modify: `apps/server/src/bootstrap/openapi.ts`
- Modify: `apps/server/src/bootstrap/openapi.test.ts`
- Modify: `apps/server/package.json`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `turbo.json`

- [ ] Write RED tests proving:
  - one operation descriptor owns method, versioning policy, semantic path segments, path/query/body schemas, status response schemas, Problem Details statuses, implementation owner and `operationId`;
  - `buildPath({ path, query })` validates before interpolation, percent-encodes dynamic values exactly once and never accepts an origin;
  - the auction operation lets the Nest adapter derive controller/handler/version, the OpenAPI adapter derive its template, and Web build `/api/v1/auctions/<encoded-id>` from one framework-neutral semantic path definition;
  - invalid bigint text is rejected before path generation and the max signed-bigint text remains unchanged;
  - duplicate operation IDs and duplicate method+OpenAPI-path pairs are rejected when the registry is assembled;
  - Nest decorator paths and generated OpenAPI consume the derived fields without hand-written `/api/v1/...` equality checks;
  - actual Nest route discovery matches the operation method/version/path, rather than only comparing metadata objects;
  - health operations remain explicitly unversioned and keep their existing public paths.
- [ ] Write RED architecture-lint fixtures that reject a new canonical `/api/v1/...` literal in Nest/Web source,
  frontend `ENDPOINTS` mirrors, and hand-written operation paths outside the one reviewed contract definition. Exempt
  committed OpenAPI artifacts, tests/fixtures, documentation and isolated legacy fingerprints explicitly; do not use a
  blanket directory exemption that lets new legacy literals through.
- [ ] Write RED package/export fixtures proving `@eatbid/contracts/api/v1/auctions` has a browser-safe ESM import,
  keeps Node generator/portable ingestion/server-only exports out of its transitive graph, and does not load
  `@eatbid/domain` runtime. The existing package root may remain a Server/generator compatibility surface but Web
  source must not import it.
- [ ] Write clean-checkout process tests for filtered Web dev startup, root `turbo dev`, Web typecheck and production
  build. Contract source edits must reach the dev graph through a verified source/watch lane; a stale ignored `dist`
  directory or a developer's prior manual build may not be a hidden prerequisite.
- [ ] Implement a small repository-owned `defineOperation()` helper. Do not adopt a second RPC framework or generate Nest controllers from metadata.
- [ ] Keep the descriptor portable and free of Nest, Next, React, environment origin and transport state. Zod schemas and pure path builders are allowed.
- [ ] Represent successful responses by status so the transport can select the correct runtime schema. Keep shared RFC 9457 schemas in the contract package; do not turn thrown Nest classes into contract metadata.
- [ ] Export a reviewed operation registry used by uniqueness tests and OpenAPI generation. The resource-scoped exports remain the normal consumer entry.
- [ ] Add explicit client-safe ESM subpath exports and separate Server/generator surfaces. Do not expose the entire
  root barrel to Web merely because a bundler appears to tree-shake it; verify the emitted/import graph.
- [ ] Reserve `/api/**` for `implementationOwner: 'server'`. Reject a new `app/**/route.ts` by default; a Web-owned
  public handler requires a non-`/api` prefix, explicit ingress rule and ADR in the same change.
- [ ] Add root `lint:endpoints` for the checker. Invoke it from root `architecture:check`, Web `lint:strict`, Server
  `architecture:check` and protected-branch CI so editor/package lint and monorepo CI enforce the same rule. Keep Oxlint
  for AST/style rules; this repository checker owns cross-file uniqueness and Nest/OpenAPI/Web drift.
- [ ] Run:

```text
node --test tools/architecture/check-http-operations.test.mjs
node --test tools/architecture/check-contract-client-exports.test.mjs
pnpm lint:endpoints
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server openapi:check
pnpm --filter @eatbid/web lint:strict
pnpm --filter @eatbid/server architecture:check
pnpm architecture:check
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web build
```

- [ ] Commit:

```text
refactor(contracts): centralize public operation paths
```

## Task 3: Build the generic contract transport and explicit ingress split

**Files:**

- Create: `apps/web/src/api/_transport/http-problem.ts`
- Create: `apps/web/src/api/_transport/request-contract.ts`
- Create: `apps/web/src/api/_transport/browser-request.ts`
- Create: `apps/web/src/api/_transport/server-request.server.ts`
- Create: `apps/web/src/api/_transport/request-contract.test.ts`
- Create: `apps/web/config/api-rewrites.ts`
- Create: `apps/web/config/api-rewrites.test.ts`
- Modify: `apps/web/next.config.ts`

- [ ] Write RED tests using an injected `fetch` implementation for:
  - valid JSON parsed by the supplied Zod schema;
  - malformed 2xx JSON rejected as `ContractResponseError` and never returned;
  - valid RFC 9457 non-2xx mapped to `HttpProblemError` with status/code/requestId;
  - malformed/non-JSON non-2xx mapped to a sanitized `HttpStatusError` without returning raw response text;
  - the exact incoming `AbortSignal` reaching `fetch` and an abort remaining an abort;
  - browser target remaining same-origin and server target using a validated `API_URL`;
  - server-only environment code not being exported by the browser module;
  - API rewrites existing only when `NODE_ENV === 'development'`, with production returning `[]`.
- [ ] Implement a transport-neutral interface shaped like this (derive the exact generic helpers from `defineOperation`; do not widen operation inputs back to strings):

```ts
export interface ContractRequest {
  <Operation extends PublicHttpOperation>(input: {
    operation: Operation
    path: OperationPathInput<Operation>
    query?: OperationQueryInput<Operation>
    body?: OperationBodyInput<Operation>
    signal?: AbortSignal
  }): Promise<OperationSuccess<Operation>>
}
```

- [ ] Make `_transport` responsible only for asking the supplied operation to validate/build its relative request, adding the runtime origin, status, Problem Details, JSON decoding, status-schema invocation, correlation-safe errors, and signal propagation. It must not import auction operations, Query, React, toast, or UI and must not accept an arbitrary endpoint URL from resource callers.
- [ ] Put `import 'server-only'` in `server-request.server.ts`. Read `API_URL` at call time, default development to `http://localhost:4400`, and reject an invalid origin before network I/O.
- [ ] Add a tested `createApiRewrites({ nodeEnv, apiUrl })` config helper. Return the `/api/:path*` proxy only for `development`; return `[]` for production/test. Browser code keeps same-origin calls locally, while production ingress owns `/api` routing. This is a transport proxy, not a business BFF.
- [ ] Run:

```text
bun test apps/web/src/api/_transport/request-contract.test.ts apps/web/config/api-rewrites.test.ts
pnpm --dir apps/web exec oxlint src/api/_transport config/api-rewrites.ts next.config.ts --deny-warnings
pnpm --filter @eatbid/web typecheck
```

- [ ] Commit:

```text
feat(web): add contract-validating API transport
```

## Task 4: Add the canonical auction resource API and Query Options

**Files:**

- Create: `apps/web/src/api/auctions/get-auction.ts`
- Create: `apps/web/src/api/auctions/auction-resource-error.ts`
- Create: `apps/web/src/api/auctions/queries.ts`
- Create: `apps/web/src/api/auctions/index.ts`
- Create: `apps/web/src/api/auctions/server.ts`
- Create: `apps/web/src/api/auctions/get-auction.test.ts`
- Create: `apps/web/src/api/auctions/queries.test.ts`

- [ ] Write RED tests proving:
  - `9007199254740993` and `9223372036854775807` remain decimal strings in URL and query key;
  - leading-zero, zero, negative, decimal, and overflow IDs fail `auctionIdPathSchema` before fetch;
  - the request passes `auctionV1Operations.find` plus validated path input to the transport, its encoded path comes from `buildPath`, and response parsing uses the status-specific operation schema;
  - a valid response preserves exact money strings, nullable schedule fields, revision identity, and provenance;
  - malformed 2xx never enters returned data;
  - the Query function consumes its supplied signal;
  - `auctionQueries.detail(id)` produces one hierarchical canonical key and does not need a third-party key factory;
  - an exact 404/`AUCTION_NOT_FOUND` problem maps to the resource-level not-found error, while 500/503, malformed problems, and aborts remain their original typed failures;
  - `index.ts` does not export the server entry and consumers cannot deep-import internals.
- [ ] Implement one internal `getAuctionWith(request, { auctionId, signal })` function. Bind the browser request in `index.ts`/`queries.ts` and the server request in `server.ts`; pass the operation descriptor and structured path input rather than a URL, and do not duplicate path construction or schema parsing.
- [ ] Export client-safe `getAuction`, `auctionQueries`, and contract-inferred result types from `index.ts`. Export `getAuctionFromServer`, route-ID parsing, and `isAuctionNotFoundError` from `server.ts` only so a route never imports `_transport` or resource internals.
- [ ] Do not add React hooks to `src/api`; capability Client Components call `useQuery(auctionQueries.detail(id))` themselves when interaction is justified.
- [ ] Run:

```text
bun test apps/web/src/api/auctions
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint src/api/auctions --deny-warnings
pnpm --filter @eatbid/web typecheck
```

- [ ] Commit:

```text
feat(web): add the canonical auction resource client
```

## Task 5: Move providers/theme authority into shell and harden shared Button behavior

**Files:**

- Create: `apps/web/src/shell/providers/app-providers.tsx`
- Create: `apps/web/src/shell/providers/query-client.ts`
- Create: `apps/web/src/shell/providers/query-provider.tsx`
- Create: `apps/web/src/shell/providers/query-policy.test.ts`
- Create: `apps/web/src/shell/theme/active-theme.tsx`
- Create: `apps/web/src/shell/theme/font.config.ts`
- Create: `apps/web/src/shell/theme/theme.config.ts`
- Create: `apps/web/src/shell/theme/theme-provider.tsx`
- Create: `apps/web/src/shell/theme/theme-mode-toggle.tsx`
- Create: `apps/web/src/shell/theme/theme-selector.tsx`
- Create: `apps/web/src/shell/theme/theme-transition.ts`
- Create: `apps/web/src/shell/index.ts`
- Create: `apps/web/src/shared/lib/cn.ts`
- Create: `apps/web/src/shared/lib/format-bytes.ts`
- Create: `apps/web/src/shared/lib/format-bytes.test.ts`
- Create: `apps/web/src/shared/ui/button.tsx`
- Create: `apps/web/src/shared/ui/button.test.ts`
- Create: `apps/web/src/types/tanstack-query.d.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/components/layout/header.tsx`
- Modify: `apps/web/src/components/layout/header.test.tsx`
- Modify: `apps/web/src/components/command-palette/theme-actions.ts` (created by the prerequisite runtime plan)
- Replace with compatibility re-export: `apps/web/src/components/ui/button.tsx`
- Replace with compatibility re-export: `apps/web/src/lib/utils.ts`
- Delete after imports move: `apps/web/src/components/layout/providers.tsx`
- Delete after imports move: `apps/web/src/components/layout/query-provider.tsx`
- Delete after imports move: `apps/web/src/lib/query-client.ts`
- Delete after imports move: `apps/web/src/lib/theme-transition.ts`
- Delete after imports move: `apps/web/src/components/themes/active-theme.tsx`
- Delete after imports move: `apps/web/src/components/themes/font.config.ts`
- Delete after imports move: `apps/web/src/components/themes/theme.config.ts`
- Delete after imports move: `apps/web/src/components/themes/theme-provider.tsx`
- Delete after imports move: `apps/web/src/components/themes/theme-mode-toggle.tsx`
- Delete after imports move: `apps/web/src/components/themes/theme-selector.tsx`

- [ ] Write RED tests that assert:
  - Query and Mutation failures with `meta.errorPresentation: 'toast'` invoke one injected notifier;
  - `inline` and `silent` failures do not toast, aborts do not toast, and unexpected errors still reach the telemetry callback;
  - React Query Devtools are mounted only in development;
  - the QueryClient preserves 60-second default stale time, includes pending queries in dehydration, creates one client per server request, and reuses one browser singleton;
  - the shared Button accepts an injected `onClick`, contains common `active:scale-[0.98]`/press feedback and a reduced-motion fallback, and has no auth/session/telemetry import;
  - the header still renders both `ThemeModeToggle` and `ThemeSelector` from shell paths;
  - `formatBytes` remains available from the compatibility `@/lib/utils` path and the new shared path with identical output.
- [ ] Define TanStack `Register.queryMeta` and `Register.mutationMeta` with a small `RequestMeta` containing `errorPresentation: 'toast' | 'inline' | 'silent'` and optional user-safe success/error message IDs. Do not permit arbitrary payloads, bid values, or PII in meta.
- [ ] Make `createQueryClient({ notify, report })` testable; QueryCache/MutationCache callbacks classify errors globally while the capability chooses policy via typed meta.
- [ ] Move existing theme logic without changing available palettes, cookie name, keyboard behavior, or root hydration behavior.
- [ ] Move the Button implementation to `shared/ui`; keep the old path as a temporary re-export so untouched legacy components continue to compile.
- [ ] Move both `cn` and `formatBytes` to focused shared modules and re-export both from legacy `src/lib/utils.ts`; `file-uploader.tsx` must keep compiling without an unrelated migration.
- [ ] Keep auth, permission checks, audit events, and command execution out of the primitive. Those belong to future contract-backed capability action components.
- [ ] Run:

```text
pnpm --dir apps/web exec bun test src/shell src/shared src/components/layout/header.test.tsx
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint src/shell src/shared src/app/layout.tsx src/components/layout/header.tsx src/components/command-palette/theme-actions.ts --deny-warnings
pnpm --filter @eatbid/web typecheck
```

- [ ] Commit:

```text
refactor(web): establish shell providers and shared primitives
```

## Task 6: Implement the first canonical RSC walking skeleton

**Files:**

- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/present-auction.ts`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/present-auction.test.ts`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen.tsx`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen.test.tsx`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/page.tsx`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/loading.tsx`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/error.tsx`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/not-found.tsx`
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/page.test.tsx`

- [ ] Write RED model/render tests for:
  - exact decimal money text plus currency, without float conversion;
  - nullable schedule values rendered as `미확인`, not zero or fabricated dates;
  - identity/revision/source/provenance rendered separately;
  - no recommended rate, predicted value, candidate default, or client-side domain calculation;
  - a fully valid contract fixture producing stable server-rendered markup;
  - async params are awaited, an invalid ID short-circuits before network I/O, and a resource not-found error calls `notFound()`;
  - dependency/internal 500/503 errors are rethrown to the route error boundary rather than presented as 404.
- [ ] Implement `presentAuction(response)` as a pure route-local presentation model. It may format for display but must retain canonical raw values needed for provenance and must not become API or business authority.
- [ ] Keep `page.tsx` an async Server Component using generated `PageProps<'/auctions/[auctionId]'>`. Await params, call only `@/api/auctions/server`, map `AUCTION_NOT_FOUND` and invalid IDs to `notFound()`, and rethrow dependency/internal failures to the route error boundary.
- [ ] Keep `error.tsx` as the only Client Component in the segment. It provides retry/correlation-safe text and does not expose raw error bodies.
- [ ] Do not add this route to product navigation yet; navigation/information architecture is a joint frontend planning decision.
- [ ] Run:

```text
pnpm --dir apps/web exec bun test 'src/app/(workspace)/auctions/[auctionId]' src/api/auctions
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint 'src/app/(workspace)/auctions' --deny-warnings
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web build
```

- [ ] Commit:

```text
feat(web): add the canonical auction read skeleton
```

## Task 7: Verify behavior locally without declaring legacy migration complete

**Files:**

- Modify only if verified facts changed: `docs/architecture/frontend-application-foundation.md`
- Modify only if verified facts changed: `apps/web/AGENTS.md`
- Create: `apps/server/tools/find-verification-auction.ts`
- Create: `apps/server/tools/find-verification-auction.test.ts`

- [ ] Run the repository and focused gates:

```text
node tools/architecture/check-stack-docs.mjs
node tools/architecture/check-web-runtime.mjs
node tools/architecture/check-web-boundaries.mjs
node --test tools/architecture/check-stack-docs.test.mjs tools/architecture/check-web-runtime.test.mjs tools/architecture/check-web-boundaries.test.mjs
pnpm architecture:check
pnpm quality:check
pnpm --filter @eatbid/web test
pnpm --filter @eatbid/web typecheck
pnpm --dir apps/web exec oxlint src/api src/capabilities src/shell src/shared --deny-warnings
pnpm --filter @eatbid/web build
git diff --check
```

- [ ] Before querying dev data, run the verification helper's focused test and Server tools architecture check:

```text
bun test apps/server/tools/find-verification-auction.test.ts
pnpm --filter @eatbid/server architecture:check
```

- [ ] Run the full Server e2e suite (procurement, operational HTTP, and disposable database integration), and report it accurately as full Server evidence:

```text
pnpm --filter @eatbid/server test:e2e
```

- [ ] Write a read-only verification helper that uses the Server's existing `postgres` dependency, requires Infisical-injected `DATABASE_URL`, selects one latest canonical auction/revision ID, prints only the decimal ID, and fails clearly when the dev database is empty. Unit-test its row selection with Korean test names; it must never seed, mutate, or print connection details.
- [ ] Resolve the real dev ID through `infisical run --project-config-dir=<repo-root> --env=dev --path=/runtime/server --secret-overriding=false -- bun apps/server/tools/find-verification-auction.ts`. Do not assume the disposable-test-only `9007199254740993` exists in dev.
- [ ] Start local Web on port 3001 and the canonical Server on port 4400 with that same dev secret scope. Inspect `/auctions/<resolved-id>`, hard refresh it, toggle light/dark and palette themes, exercise Button press feedback, and check browser/server consoles for hydration or contract errors.
- [ ] Also inspect invalid and missing IDs to confirm not-found/error behavior. Do not substitute a product mock store; a test-only fixture server is permitted only for automated transport tests.
- [ ] Report full legacy lint failures separately from the green target-directory lint. Do not edit a legacy baseline merely to make the report green.
- [ ] Confirm `/dashboard/market` and the old bid-number/composite-school routes remain explicitly legacy and are not called migrated.
- [ ] Commit only evidence-driven documentation changes:

```text
docs(web): record foundation verification evidence
```
