# Eatbid NestJS 12 + Effect backend foundation implementation plan

> **Execution rule:** implement one gate at a time with tests first. A gate is complete only after its
> focused verification, reverse-order regression, full repository verification, and an independent review.

**Goal:** Replace the exploratory server with a small, production-shaped NestJS 12 application boundary that
keeps domain/application/transport/database responsibilities separate, uses Effect only for typed application
execution, and exposes one canonical read-only vertical slice without inheriting legacy string identities.

**Governing decisions:** `AGENTS.md`, `ARCHITECTURE.md`, ADR 0001/0008/0009/0012/0013/0016/0017/0018/0019, and
`docs/architecture/backend-application-foundation.md`.

**Execution order:** Task 13 → **Task 16** → Task 14 → Task 15 → Task 17. Backend work does not activate eaT,
R2, Argo, or the user-owned service on port 8081. Frontend planning and edits remain a separate user approval gate.

---

## Global Constraints

- Nest owns HTTP, dependency injection, bootstrap, shutdown, and resource lifecycle.
- Domain code imports neither Nest, Effect, Drizzle, Zod, nor HTTP types.
- Application use cases may return fully provided `Effect<Output, ApplicationError, never>` values.
- Only the singleton `EffectRunner` crosses Effect into Promise execution.
- Controllers call one application use case and never import Drizzle, SQL, environment variables, or DB rows.
- `packages/db` remains the sole DDL authority. The server never migrates or calls `db:push` at startup.
- `drizzle-orm/zod` is allowed only at the infrastructure row boundary; public schemas live in
  `packages/contracts`.
- Middleware, pipes, guards, interceptors, and filters have the responsibilities defined by ADR 0016. They are
  not alternate homes for business rules.
- No unsupported Nest 12 peer override is permitted. In particular, do not force `@nestjs/terminus`,
  `@nestjs/throttler`, `nestjs-pino`, or a community Better Auth bridge into the foundation.
- Do not add TypeScript 7, Jest, Effect Layer/ManagedRuntime, native Drizzle Effect adapters, Redis, Kafka,
  GraphQL, a generic event bus, or an observability vendor SDK in this task.
- Do not edit the frontend, call a live source, submit an Argo workflow, sync Argo CD, publish an image, or
  restart/mutate the local service at `127.0.0.1:8081`.

### Mandatory per-task regression and review checkpoint

Before a task's focused evidence, install the actual dependency graph from the committed lockfile and separately
assert that lockfile resolution is immutable:

```powershell
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm install --lockfile-only --frozen-lockfile --strict-peer-dependencies
```

Only then run that task's focused commands. After they pass, rerun every earlier task's focused commands in reverse
task order, then run this repository-wide matrix before review:

```powershell
pnpm test
pnpm --filter @eatbid/db db:check
node tools/architecture/check-stack-docs.mjs
uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra/tests
uv run --project apps/dataplane pyright apps/dataplane/src
pnpm exec turbo build --force
docker build --file Dockerfile.server --tag eatbid-server:task16-verification .
docker run --rm eatbid-server:task16-verification node dist/bootstrap/compatibility-probe.js
```

Record the focused, reverse-regression, and repository-wide outputs in the task report. Commit only that task,
generate a review package from its recorded base and head commits, and obtain fresh specification-compliance and
code-quality approvals. The task's original implementer fixes findings; each fix is rerun through the same focused,
reverse-regression, repository-wide, and independent-review sequence. No later task begins with an unresolved
finding.

## Greenfield disposition

The current exploratory `apps/server/src/app.module.ts`, `auth.ts`, and `db.ts` are not loaded as a
`LegacyApiModule`. Before removal, create a machine-readable route inventory for the later frontend planning
gate. Git history remains the source for old implementation details. The new server deliberately does not keep
the old process-local maps, unrestricted CORS, development secrets, direct controller SQL, or guest-on-error
authentication alive.

This is an intentional API reset on the feature worktree, not an in-place change to the running local service.

---

## Task 1 — Gate 16.1: Runtime compatibility and clean composition root

### Files

- Create: `.node-version`
- Create: `.npmrc`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/build.yml`
- Modify: `Dockerfile.server`
- Modify: `apps/server/package.json`
- Modify: `apps/server/tsconfig.json`
- Create: `apps/server/tsconfig.build.json`
- Delete: `apps/server/nest-cli.json`
- Replace: `apps/server/src/main.ts`
- Replace: `apps/server/src/app.module.ts`
- Delete after inventory: `apps/server/src/auth.ts`
- Delete after inventory: `apps/server/src/db.ts`
- Create: `docs/architecture/legacy-server-route-inventory.json`
- Create: `apps/server/tools/inventory-legacy-routes.ts`
- Test: `apps/server/tools/inventory-legacy-routes.test.ts`
- Create: `apps/server/src/platform/effect/effect-runner.ts`
- Create: `apps/server/src/platform/effect/effect.module.ts`
- Test: `apps/server/src/platform/effect/effect-runner.test.ts`
- Create: `apps/server/tools/check-architecture.ts`
- Test: `apps/server/tools/check-architecture.test.ts`
- Create: `apps/server/src/bootstrap/compatibility-probe.ts`
- Test: `apps/server/src/bootstrap/compatibility.test.ts`

### Red tests first

1. Add an Effect runner test covering success, typed expected failure, unexpected defect preservation, and
   cancellation through `AbortSignal`.
2. Add a TypeScript-resolved import-graph architecture checker and mutation fixtures that prove it fails when:
   - a controller reaches `drizzle-orm`, `postgres`, `@eatbid/db`, or any DB schema through a direct import,
     alias, or re-export;
   - domain code imports Nest/Effect/Drizzle/Zod/HTTP;
   - application imports presentation or infrastructure instead of its own domain/ports;
   - a resolved `Effect.runPromise*` symbol is called outside `EffectRunner`, including aliased imports;
   - root `AppModule` declares controllers/providers instead of only importing modules;
   - a feature imports another feature's `presentation` or `infrastructure` internals rather than its public
     application interface;
   - the server source dependency graph contains a cycle.
3. Add a static route-inventory test that reads `app.module.ts` and `main.ts` from pre-reset commit
   `08405942e64fc22777e64e30f8e3698627a98850` without importing them, derives the 13 controllers and all 34
   method routes including `@All`, records source blob/content hashes and source lines, and proves regeneration is
   byte-identical before the old files are deleted.
4. Add a compiled compatibility probe that creates and closes the Nest application context and asserts
   `process.version === "v24.20.0"`.

Run the focused tests and confirm they fail for the intended missing boundary, not because the test harness is
broken.

### Minimal implementation

1. Pin Node `24.20.0` in the repository declaration, CI, and container tag. Resolve and record the immutable
   container digest; do not retain the floating `node:24-slim` declaration.
2. Pin exact compatible versions of Nest common/core/platform-express/testing `12.0.1`, Effect
   `4.0.0-rc.112`, and the verified exact releases of RxJS, reflect-metadata, TypeScript Node types, and every
   other dependency consumed by this gate. Later gates add their own dependencies when first used. Verify registry
   peers during install and fail on peer override warnings. Commit `.npmrc` with
   `strict-peer-dependencies=true`; every install/check command must also pass `--strict-peer-dependencies` so CI
   cannot silently weaken the policy. Remove the server dependency on `@eatbid/shared`.
3. Keep TypeScript on exact `5.9.3` and build with `tsc -p tsconfig.build.json`. Do not install Nest CLI or
   schematics: their TypeScript `>=6` peer lane cannot coexist with this exact compiler without an override.
   TypeScript 7 and Nest CLI are a separate compiler/toolchain migration under ADR 0019.
4. Keep the server CommonJS output for the first spike. Nest 12's ESM-only packages must boot on Node 24's
   `require(esm)` support. Change the application module format only if the compatibility test proves it is
   necessary, and record that change in the implementation evidence.
5. Remove `nestjs-zod` and all semver ranges from the server foundation dependencies.
6. Add explicit server `test`, `compatibility:node`, and `architecture:check` scripts, and include server tests in
   the repository verification entrypoint. Replace the CLI-based development command with an exact
   `concurrently@10.0.5` setup: `predev` performs one `tsc` build, then `dev` runs `tsc -p
   tsconfig.build.json --watch --preserveWatchOutput` beside `node --watch --enable-source-maps dist/main.js`.
   Add a bounded smoke test proving this command recompiles and boots without `nest` on `PATH`. Gate 16.2 adds
   HTTP/OpenAPI/contract scripts when those artifacts exist.
7. Generate the legacy route inventory with static TypeScript AST analysis of the pinned commit, review the exact
   13-controller/34-route set and old global `api` prefix, then replace the root module with an import-only
   composition root. The JSON includes
   controller prefix, method path, full path, HTTP method, handler, source line, source commit/blob/content hashes,
   and conservative auth classification. Do not execute/import old code or copy handlers into the new tree.
8. Implement one singleton `EffectRunner`; do not create a Layer or ManagedRuntime.

### Gate evidence

```powershell
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server architecture:check
pnpm --filter @eatbid/server build
pnpm --filter @eatbid/server dev:smoke
docker build --file Dockerfile.server --tag eatbid-server:task16-1 .
docker run --rm eatbid-server:task16-1 node dist/bootstrap/compatibility-probe.js
pnpm exec turbo build --force
```

The Docker build and probe must report Node `v24.20.0`; the host's current Node version is not gate evidence.
Verify the pinned image digest resolves to the `24.20.0-slim` manifest and that no peer override warning appears.
The committed worktree must be clean after verification except for the intended gate diff.

---

## Task 2 — Gate 16.2: Operational HTTP shell

### Files

- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/app.module.ts`
- Create: `apps/server/src/bootstrap/create-app.ts`
- Create: `apps/server/src/bootstrap/openapi.ts`
- Create: `apps/server/src/platform/config/config.module.ts`
- Create: `apps/server/src/platform/config/environment.ts`
- Create: `apps/server/src/platform/logging/logging.module.ts`
- Create: `apps/server/src/platform/request-context/request-context.module.ts`
- Create: `apps/server/src/platform/request-context/request-context.middleware.ts`
- Create: `apps/server/src/platform/shutdown/inflight-tracker.ts`
- Create: `apps/server/src/platform/shutdown/inflight.middleware.ts`
- Create: `apps/server/src/platform/shutdown/shutdown-coordinator.ts`
- Create: `apps/server/src/platform/health/readiness-state.ts`
- Create: `apps/server/src/platform/http/problem-details.filter.ts`
- Create: `apps/server/src/platform/http/request-completion.interceptor.ts`
- Create: `apps/server/src/platform/http/standard-schema.pipe.ts`
- Create: `apps/server/src/platform/http/response-schema.interceptor.ts`
- Create: `apps/server/src/platform/health/health.module.ts`
- Create: `apps/server/src/platform/health/health.controller.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/common/problem-details.ts`
- Create: `packages/contracts/src/operations/health.ts`
- Create: `packages/contracts/src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `turbo.json`
- Generate: `apps/server/openapi/openapi.json`
- Modify: `infra/k8s/base/app.yaml`
- Test alongside each implementation file; add HTTP e2e under `apps/server/src/testing/`

### Red tests first

1. Environment tests reject missing/malformed values and every fallback owned by this gate: runtime mode, port,
   exact CORS origin set, proxy hops, payload limit, shutdown grace, Swagger toggle, and build identity. Database
   and auth configuration are added and tested only in the gates that first consume them.
2. Request context tests prove accepted/generated request IDs propagate to response, log, and Problem Details.
3. Redaction fixtures prove Authorization, Cookie, raw query, request/response body, email, share token, and
   business registration number never enter completion/error logs.
4. Problem Details tests cover validation 400, unauthenticated 401, forbidden 403, missing 404, conflict 409,
   rate limit 429, dependency unavailable 503, and unexpected defect 500 with
   `application/problem+json`.
5. Request and response schema tests prove invalid output fails closed instead of leaking an extra field.
6. OpenAPI tests prove deterministic bytes, OpenAPI `3.0.3`, unique stable operation IDs, complete route coverage,
   bounded success/error schemas, and production Swagger UI/raw JSON disabled by default.
7. Health/shutdown tests use a real long-running HTTP request and prove the sequence: readiness false, listener
   stops accepting new connections, the existing request drains, then Nest resources close. A second case proves
   the configured grace deadline bounds shutdown and records forced termination.
8. Kubernetes manifest tests require `/health/live` for liveness and `/health/ready` for readiness.
9. Adapter-order tests prove request-context and in-flight tracking run at the underlying Express boundary before
   any parser or route, count a request exactly once, and finalize on response finish, close, or abort. This shared
   middleware is intentionally transport-neutral; the Nest completion interceptor covers only Nest-managed routes.

### Minimal implementation

1. Validate configuration before application construction. The config module is the only runtime environment
   reader.
2. Add exact `@nestjs/config@12.0.0`, `@nestjs/swagger@12.0.1`, `zod@4.5.2`, `zod-openapi@6.0.1`,
   `helmet@8.3.0`, `supertest@7.2.2` and matching type dependencies with a frozen lockfile. Add server
   `test:e2e`, `openapi:generate`, and `openapi:check` scripts plus contracts/root test/build entries.
3. Use Nest's built-in JSON logger with a small redacting adapter; log route templates rather than raw URLs.
4. Configure Helmet, exact credentialed CORS origins, explicit trusted proxy hops, JSON/body size limits, URI
   versioning for `/api/v1`, and a shutdown coordinator. Do not rely on an unbounded Nest shutdown hook: lower
   readiness, close the HTTP listener, drain the tracked in-flight count until the configured deadline, then close
   Nest-owned resources.
   Construct the Express adapter explicitly with Nest automatic body parsing disabled. Mount request-context and
   in-flight middleware first, then the bounded parsers and Nest-managed routes. Gate 16.4 inserts the raw auth
   transport between those shared middleware and the parsers without changing this ownership order.
5. Use AsyncLocalStorage only for non-sensitive request context, never as a service locator or hidden transaction.
6. Implement small explicit live/ready endpoints. Ready initially consumes a replaceable database-readiness port;
   Gate 16.3 supplies the PostgreSQL implementation.
7. Build Zod 4 bounded contracts and Nest 12 Standard Schema request/response adapters. Do not expose a table
   schema as an HTTP schema.
8. Generate the OpenAPI artifact from the same runtime route/schema source. Expose Swagger UI only when an
   explicit development setting enables it.
9. Wire `main.ts` through `createApp()` and keep `AppModule` import-only while adding the platform modules required
   by this gate. Do not leave bootstrap or module-composition work implicit in later tasks.

### Gate evidence

```powershell
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server test:e2e
pnpm --filter @eatbid/server openapi:check
pnpm --filter @eatbid/server architecture:check
uv run --project apps/dataplane pytest infra/tests
pnpm test
pnpm exec turbo build --force
```

The HTTP e2e command must include the bounded-drain success and deadline cases. OpenAPI generation to a temporary
file must byte-compare with the committed artifact. No HTTP call may target port 8081.

---

## Task 3 — Gate 16.3: Drizzle database boundary and canonical vertical slice

### Files

- Create: `apps/server/src/platform/database/database.module.ts`
- Create: `apps/server/src/platform/database/database.tokens.ts`
- Create: `apps/server/src/platform/database/database-readiness.ts`
- Create: `apps/server/src/platform/database/unit-of-work.ts`
- Create: `packages/db/src/schema/app/principals.ts`
- Create: `packages/db/src/schema/app/workspaces.ts`
- Create: `packages/db/src/schema/app/index.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/version.ts`
- Modify: `packages/db/src/version.test.ts`
- Modify: `packages/db/drizzle.config.ts`
- Modify: `packages/db/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Generate: one reviewed `packages/db/drizzle/<timestamp>_app_workspace_foundation/` migration
- Create: `apps/server/src/modules/procurement/domain/auction-id.ts`
- Create: `apps/server/src/modules/procurement/application/find-auction.ts`
- Create: `apps/server/src/modules/procurement/application/auction-reader.ts`
- Create: `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts`
- Create: `apps/server/src/modules/procurement/presentation/http/auction.controller.ts`
- Create: `apps/server/src/modules/procurement/procurement.module.ts`
- Create: `packages/contracts/src/procurement/auction.ts`
- Modify: `docs/architecture/domain-and-data.md`
- Modify: `docs/architecture/backend-application-foundation.md`
- Modify: `apps/server/src/app.module.ts`
- Modify: `Dockerfile.server`
- Modify: `infra/product/secret-contract.md`
- Modify: `infra/product/migration.yaml`
- Modify: `infra/product/patches/server-secret-env.patch.yaml`
- Modify: `infra/product/patches/postgres-secret-env.patch.yaml`
- Modify: `infra/product/workflows/workflow-template.yaml`
- Modify: `infra/tests/test_workflow_contract.py`
- Modify: `infra/tests/test_build_contract.py`
- Test: colocated unit/contract tests plus PostgreSQL integration and HTTP e2e tests

### Red tests first

1. Schema tests first define internal bigint identity and FK requirements for principal, workspace, and membership.
   Authentication-provider subject strings may occur only in an explicit identity mapping and must not become
   workspace relational keys.
2. ID contract tests parse only canonical positive decimal strings into bigint, serialize without `Number`, reject
   signs/whitespace/decimal/exponent/leading-zero forms, and round-trip `9007199254740993` unchanged through path,
   application input, response JSON, and OpenAPI example.
3. Repository integration tests start an owner-scoped disposable PostgreSQL, apply committed Drizzle migrations,
   seed one canonical auction revision, and read it by an opaque validated bigint ID.
4. A not-found result is a typed application error; connection/migration mismatch is a distinct dependency error.
5. Unit-of-work tests prove the same transaction handle reaches all participating repositories and rolls back all
   writes on typed failure and defect.
6. Mapping tests prove Drizzle inferred rows never escape infrastructure and bigint/time/nullable fields are
   converted into the bounded contract.
7. E2E tests prove `/api/v1/auctions/:auctionId` emits only the public schema, never accepts a string business key,
   and maps not-found/dependency errors correctly.
8. Readiness tests prove the server checks the exact expected committed migration version and does not migrate.
9. A disposable admin connection creates a non-owner API role, then adversarial tests prove it can read
   `core`/`mart` and read/write its module-owned `app` tables while DDL, `core`/`mart` writes, `ingest` access, role
   changes, and migration-table writes are denied. The server tests connect only as this API role.
10. Rendered-manifest tests prove the PostgreSQL bootstrap, migration job, API server, and dormant dataplane
    workflow each reference only their assigned Secret and never receive another component's database credential.

### Minimal implementation

1. `DatabaseModule` constructs postgres-js/Drizzle from validated config and closes the client during Nest
   shutdown. It exports purpose-specific ports, not a global query builder.
   Pin the existing workspace `postgres` catalog entry from `^3.4.5` to its exact locked release `3.4.9`; this
   gate's install must not introduce a semver range.
2. Add only the minimum application identity/workspace tables needed to make transaction and later authorization
   boundaries real: bigint principal/workspace/membership relations plus an explicit provider-subject mapping.
   Better Auth's provider-owned string subject never becomes a domain FK.
3. Generate and review the SQL through Drizzle Kit, apply it twice to a disposable database, and prove a no-op
   regeneration. Advance `packages/db/src/version.ts` and its exact timestamp/name tests in the same change. The
   server still never applies it. After reviewing the intended schema and generated migration, stage
   `packages/db/src/schema`, `packages/db/drizzle`, `packages/db/src/version.ts`, and its version test as the
   explicit no-op baseline. Regenerate, require zero unstaged diff for schema/migrations, and fail if
   `git ls-files --others --exclude-standard -- packages/db/src/schema packages/db/drizzle` reports any new file.
4. Wrap Promise adapters once into typed Effect failures in the application composition. Retry no DB operation by
   default.
5. Use `@eatbid/db` schema only inside infrastructure. If DB-row validation is needed, use
   `drizzle-orm/zod` there and nowhere else.
6. Implement one read-only Procurement use case end to end. The public response encodes internal bigint IDs as
   canonical decimal strings and includes provenance fields required by the product, not legacy shared DTOs.
7. Update the server container build context to include `packages/db` and `packages/contracts`; keep migrations in
   the separate migration image/process.
8. Treat DB role creation/grants as environment provisioning, not application DDL: create them only in the
   owner-scoped disposable test setup and document the production secret/role contract. Runtime readiness verifies
   the connected role's required/forbidden privileges without changing them.
9. Replace the shared `eatbid-database` Secret contract with distinct references and no committed values:
   `eatbid-postgres-bootstrap` for the PostgreSQL owner/bootstrap container,
   `eatbid-database-migrator` for the migration job, `eatbid-database-api` for the Nest server, and dormant
   `eatbid-database-dataplane` for the current workflow template. The server and tests use only the non-owner API
   credential. Task 14 may split the dormant dataplane credential into narrower ingestor/projector roles before
   activation; no Task 16 manifest activates a crawler or workflow.

### Gate evidence

```powershell
pnpm --filter @eatbid/db test
pnpm --filter @eatbid/db db:check
git add -- packages/db/src/schema packages/db/drizzle packages/db/src/version.ts packages/db/src/version.test.ts
pnpm --filter @eatbid/db db:generate
git diff --exit-code -- packages/db/src/schema packages/db/drizzle
if (git ls-files --others --exclude-standard -- packages/db/src/schema packages/db/drizzle) { throw "Drizzle no-op generation created untracked files" }
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server test:integration
pnpm --filter @eatbid/server test:e2e
pnpm --filter @eatbid/server architecture:check
pnpm --filter @eatbid/server openapi:check
pnpm test
pnpm exec turbo build --force
```

Run the migration twice and the least-privilege attack matrix in one owner-scoped disposable PostgreSQL container.
Prove success and intentional-failure cleanup leave zero task-owned containers, the latest journal row exactly
matches the advanced `expectedMigration`, and no server startup path changed the schema.

---

## Task 4 — Gate 16.4: Identity and authorization boundary

### Files

- Create: `apps/server/src/platform/identity/auth.module.ts`
- Create: `apps/server/src/platform/identity/identity-provider.ts`
- Create: `apps/server/src/platform/identity/better-auth-options.ts`
- Create: `apps/server/src/platform/identity/better-auth.transport.ts`
- Create: `apps/server/src/platform/identity/raw-auth-completion.ts`
- Create: `apps/server/src/platform/identity/session.guard.ts`
- Create: `apps/server/src/platform/identity/access.decorators.ts`
- Create: `apps/server/src/platform/identity/workspace-permission.guard.ts`
- Create: `apps/server/src/modules/identity/application/resolve-principal.ts`
- Create: `apps/server/src/modules/identity/application/identity-subject-repository.ts`
- Create: `apps/server/src/modules/identity/infrastructure/drizzle/drizzle-identity-subject-repository.ts`
- Create: `apps/server/src/modules/identity/identity.module.ts`
- Create: `apps/server/tools/check-better-auth-schema.ts`
- Test: `apps/server/tools/check-better-auth-schema.test.ts`
- Create: `apps/server/auth.config.ts`
- Create: `packages/db/src/schema/app/auth.ts`
- Modify: `packages/db/src/schema/app/index.ts`
- Modify: `packages/db/src/version.ts`
- Modify: `packages/db/src/version.test.ts`
- Modify: `packages/db/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Generate: one reviewed `packages/db/drizzle/<timestamp>_app_auth_boundary/` migration
- Modify: `apps/server/src/bootstrap/create-app.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `docs/architecture/domain-and-data.md`
- Modify: `docs/architecture/backend-application-foundation.md`
- Modify: `infra/product/secret-contract.md`
- Test: raw transport, session modes, provider failure, origin/cookie/CSRF, and permission e2e tests

### Red tests first

1. Raw auth transport tests prove Better Auth receives the original request stream before Nest body parsing.
2. Required, optional, and public endpoint tests distinguish absent/invalid sessions from provider failure.
3. Provider dependency failure maps to 503 and is never silently converted to guest.
4. Production tests reject missing secret/base URL/trusted origins and insecure cookie/origin combinations.
5. With exact `better-auth@1.7.2` and `auth@1.7.2`, generate the Drizzle schema offline to a disposable output and
   compare its table/column/index/relation semantics with the committed modular `packages/db` auth schema,
   including the database-backed rate-limit table. Formatting and one-file layout are not comparison inputs.
6. Auth schema tests prove provider-owned auth tables are in `packages/db`, never `packages/shared`, and their
   provider subject maps explicitly to one internal bigint principal.
7. Workspace permission tests prove tenant filtering occurs in both the guard/application policy and repository
   query constraint; client-supplied workspace membership is never trusted.
8. Two real Nest application instances sharing the disposable PostgreSQL send client-facing sign-in requests and
   prove Better Auth's database-backed counter enforces the configured endpoint rule, returns 429 plus retry
   metadata, and cannot be bypassed by alternating replicas. No process-local fake is completion evidence.
9. Raw-transport lifecycle tests prove `/api/auth/*` receives the same accepted/generated request ID as Nest
   routes, is enrolled exactly once in the shared in-flight tracker, emits exactly one sanitized completion record,
   and preserves the provider body/status/headers. A slow raw-auth request participates in the real shutdown-drain
   sequence; both successful drain and configured-deadline termination remain bounded.
10. Principal resolution tests prove an authenticated subject absent from `identity_subject` is provisioned with
    exactly one bigint principal and mapping in one application-owned transaction. Concurrent first requests from
    two server instances converge on the same mapping through a database uniqueness constraint; email/name equality
    never merges principals and client-supplied subjects are ignored.

### Minimal implementation

1. Define and test the `IdentityProvider` port before wiring Better Auth.
2. Pin both `better-auth` and the standalone `auth` CLI to `1.7.2`. The checker creates an owner-scoped temporary
   directory, runs exactly `pnpm exec auth generate --config apps/server/auth.config.ts --output
   <owner-scoped-temp-dir> --adapter drizzle --dialect postgresql --yes`, compares semantics, and cleans the
   directory on both success and failure. `auth.config.ts` is deterministic and side-effect-free: importing it
   opens no socket/database and reads no ambient secret. Runtime construction and generator configuration consume
   the same typed `better-auth-options.ts` factory so their tables, plugins, rate-limit settings, and model names
   cannot drift. Model the generated semantics in the modular `packages/db` app schema, generate/review a Drizzle
   migration, advance `expectedMigration`, and verify the same forward/no-op/disposable-DB gates as every DDL
   change. Stage the reviewed auth schema/migration/version baseline before the no-op regeneration, then require
   zero unstaged diff and zero new untracked schema/migration files exactly as Gate 16.3. Never run `auth migrate`
   and do not reuse the legacy `packages/shared` auth schema.
3. Mount request-context and in-flight middleware on the underlying Express adapter before the version-neutral raw
   Better Auth handler, and mount bounded body parsers/Nest routes after it. Because the raw handler bypasses Nest
   interceptors and exception filters, a dedicated raw completion adapter must sanitize the route to
   `/api/auth/*`, log exactly once with the shared request ID, preserve every provider response byte/header, and
   observe the same request context. The shared middleware exclusively owns one idempotent in-flight lease and
   releases it on finish, close, or abort for both raw and Nest routes.
4. Resolve the authenticated provider subject to an internal bigint principal before any workspace query.
   Provision a missing mapping through an idempotent application service/UoW after Better Auth has validated the
   session; use uniqueness plus conflict-reload for concurrent first access. Do not infer account linking from
   email, display name, or organization label. The platform auth module calls the identity module's public
   application service and never imports its Drizzle adapter directly.
5. Install a global session guard with explicit `@Public` and `@OptionalAuth` metadata.
6. Keep role/permission decisions in guards and application policies; do not execute procurement/workspace
   commands inside guards.
7. Configure Better Auth's built-in rate limiter with `storage: "database"` and explicit sign-in rules. The pinned
   CLI-generated rate-limit schema and PostgreSQL adapter are the actual multi-replica implementation. Future
   non-auth share/public endpoints require a separate ingress/storage-backed policy; do not add a fake generic
   guard or unsupported Nest throttler now.
8. Preserve the raw provider response contract for `/api/auth/*`, including its 429 body/headers. RFC 9457 and the
   canonical OpenAPI artifact apply to `/api/v1`, not dynamic Better Auth transport routes.

### Gate evidence

```powershell
pnpm --filter @eatbid/server auth:schema:check
pnpm --filter @eatbid/db test
pnpm --filter @eatbid/db db:check
git add -- packages/db/src/schema packages/db/drizzle packages/db/src/version.ts packages/db/src/version.test.ts
pnpm --filter @eatbid/db db:generate
git diff --exit-code -- packages/db/src/schema packages/db/drizzle
if (git ls-files --others --exclude-standard -- packages/db/src/schema packages/db/drizzle) { throw "Drizzle no-op generation created untracked files" }
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server test:integration
pnpm --filter @eatbid/server test:e2e
pnpm --filter @eatbid/server architecture:check
pnpm --filter @eatbid/server openapi:check
pnpm test
pnpm exec turbo build --force
```

The e2e evidence must include the two-instance database-backed rate-limit test and required/optional/public session
matrix. Migration evidence must show exact latest version, double apply, no-op regeneration, and zero task-owned
containers after success and intentional failure.

---

## Task 5 — Gate 16.5: Consolidation and independent completion review

### Files

- Update: `docs/architecture/backend-application-foundation.md`
- Update: `docs/architecture/c4.md`
- Update: `docs/architecture/arc42.md`
- Update: `docs/architecture/runtime-and-deployment.md`
- Update: `docs/superpowers/plans/2026-08-29-eatbid-data-foundation.md`
- Update: relevant stack audit and runbook evidence

### Verification

1. Search for all forbidden dependency directions and runtime shortcuts.
2. Regenerate OpenAPI and prove a zero diff.
3. Run server focused tests in reverse gate order, then all root/database/dataplane/infra tests and builds.
4. Build the server image from a clean context and smoke-test live/ready/canonical read in a disposable local
   network only.
5. Prove no live eaT/R2/Argo/8081 access, no shared database mutation, no image push, and no frontend diff.
6. Obtain a fresh specification review and a fresh code-quality review. The original implementer fixes findings;
   each fix receives a new independent review.

### Completion condition

Task 16 is complete only when all gates have objective evidence, the worktree contains no unreviewed server
changes, and the final reviewer reports no unresolved P1/P2/P3 findings. Then execution returns to Task 14; it
does not begin Task 17 automatically.
