# Task 3 implementer report — Gate 16.3

## Outcome

Implemented the Drizzle database boundary and one canonical procurement read slice on
`feat/data-foundation` from base `f67a20c376b2a9e879cf3ef6a8d727bfa0772caa`. The task commit subject is
`feat(server): add database-backed auction read slice`; the final handoff records its SHA.

The server now owns a shutdown-safe postgres-js/Drizzle client through `DatabaseModule`, but exports only
database readiness, `UnitOfWork`, and `AuctionReader` purpose ports. It never runs migrations, pushes schema,
creates roles, grants privileges, or seeds data. `packages/db` remains the sole DDL/migration authority.

The change adds only bigint application principal/workspace/membership relations and the explicit
provider/issuer/subject-to-principal mapping. It also adds `GET /api/v1/auctions/:auctionId` from a strict public
contract through a fully provided Effect use case and a Drizzle repository. Canonical decimal strings preserve
IDs beyond `Number.MAX_SAFE_INTEGER`; database rows and source payloads do not escape infrastructure.

No frontend file, live port 8081, live eaT/R2/Argo resource, deployment, pushed image, branch push, merge, crawler,
or workflow activation was touched.

## Implementation boundaries

- `packages/db/src/schema/app/` owns four modular application tables: `principal`, `identity_subject`,
  `workspace`, and `workspace_membership`. Every relational identity is PostgreSQL bigint. Provider strings occur
  only in `identity_subject`; no provider string is a workspace/business FK.
- The reviewed migration is
  `packages/db/drizzle/20260830021619_app_workspace_foundation/`. Its SQL creates only those four application
  tables, their identity sequences/keys, the subject uniqueness constraint, and three explicit bigint FKs.
- `expectedMigration` is exactly `20260830021619_app_workspace_foundation`, with the UTC-derived timestamp
  `1788056179000`. Startup only reads the latest committed journal row.
- The workspace postgres catalog is pinned exactly to `3.4.9`. The server consumes `postgres`, `drizzle-orm`, and
  `@eatbid/db` only from `platform/database` and procurement `infrastructure/drizzle`; it has no `drizzle-kit`.
- `DatabaseModule` owns postgres-js and Drizzle construction/termination. `DATABASE_CONNECTION` is an internal
  provider and is not exported from the Nest module. Only purpose-specific tokens are exported.
- `UnitOfWork` creates one opaque transaction handle per database transaction and preserves both typed failures
  and defects, allowing the driver to roll back every write.
- `FindAuction` wraps the Promise repository once in Effect, retries nothing, returns a strict bounded response,
  and distinguishes `AuctionNotFound` from `AuctionDependencyUnavailable`.
- The controller calls only `FindAuction` through `EffectRunner`; it has no DB or environment access. The domain
  imports no Nest, Effect, Drizzle, Zod, or HTTP package. The root `AppModule` remains metadata-import-only.
- Readiness is a single read-only query. It verifies the exact journal row; non-superuser/non-owner/no role or
  database creation; no schema CREATE; required core/mart/app usage; SELECT on every current core/mart relation;
  no core/mart DML; all four DML privileges on every module-owned app table; no ingest usage/read; and no migration
  journal write. It fails closed on connection/query errors.
- The four value-free Secret contracts are `eatbid-postgres-bootstrap`, `eatbid-database-migrator`,
  `eatbid-database-api`, and dormant `eatbid-database-dataplane`. Rendered manifests prove that each consumer
  receives only its assigned credential and that no Secret object/value is committed.

## TDD RED evidence

Tests were written before each production boundary.

- `bun test packages/db/src/schema/app/app-schema.test.ts` — RED, 1/1 failed because the modular app schema export
  did not exist.
- `bun test packages/contracts/src/contracts.test.ts packages/contracts/src/procurement/auction.test.ts` — RED,
  3/3 failed because the procurement operation/schema/export and bigint wire contract did not exist.
- The focused server RED covering database readiness, UoW, domain ID, use case, Drizzle mapping, HTTP, and OpenAPI
  produced 12 failed assertions plus one missing-module import. The intended failures were absent database/read
  ports, typed failures, canonical route, and OpenAPI operation; the existing operational shell stayed intact.
- `uv run --project apps/dataplane pytest infra/tests/test_workflow_contract.py` — RED, 3 of 10 failed because the
  shared `eatbid-database` credential was still assigned to migration/server/dataplane consumers.
- `uv run --project apps/dataplane pytest infra/tests/test_build_contract.py -k dockerfile` — RED because
  `Dockerfile.server` did not explicitly copy the new DB and contracts workspace dependencies.
- Advancing the version expectation before implementation made both exact migration version assertions RED
  against the previous placeholder.
- The first real PostgreSQL run exposed two genuine integration defects: a stale built `@eatbid/db` version and an
  ingest privilege check that tried to resolve `ingest.run` without schema USAGE. Package pretest builds fixed the
  former; catalog-OID lookup fixed the latter without granting ingest access.
- During final self-review, PostgreSQL proved that `has_table_privilege(..., 'SELECT,INSERT,UPDATE,DELETE')`
  succeeds when only SELECT exists. A new real test revoked one app-table DELETE grant: expected false, received
  true. Readiness now checks all four privileges separately on each app table.
- A second real RED revoked mart SELECT: expected false, received true. The final query dynamically verifies read
  and forbidden-write privileges across every current core/mart relation. The same test also adds an accidental
  mart UPDATE grant and requires readiness to fail.
- The first full Ruff run reported `PLC0208` in the new Secret-isolation test because it iterated a set. Replacing
  that one set with a tuple made the focused file test, full Ruff suite, and downstream matrix green.

## Migration, role, transaction, and cleanup evidence

`pnpm --filter @eatbid/server test:integration` starts an owner-scoped disposable container from pinned image
`postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416`.
The disposable admin alone provisions `eatbid_api`; the server and repository use only its non-owner URL.

The final integration result is 2 passed, 0 failed, 30 assertions:

- committed migrations apply once and then apply a second time successfully;
- the latest journal row is exactly the advanced name/timestamp;
- the canonical auction ID `9007199254740993` and provenance IDs round-trip without `Number`;
- core and mart reads succeed and app read/write succeeds;
- app DDL, core write, mart write, ingest read, role creation, and migration journal write attacks are denied;
- readiness remains non-mutating by before/after table and journal counts;
- missing app DELETE, missing mart SELECT, and added mart UPDATE each make readiness false;
- one transaction handle reaches all work and both a typed failure and a defect roll back the inserted principal;
- a real server starts only on the API credential, readiness returns 200, the canonical route returns 200, and the
  migration journal remains seven rows after shutdown, proving startup did not migrate;
- the success path and an intentional failure path both remove their labeled container.

Two manually interrupted diagnostic runs left one labeled disposable container each before their `finally` blocks
could execute. Each exact resolved container name was force-removed immediately. Final and repeated
`docker ps -a --filter label=eatbid.task=gate16-3 --format '{{.Names}}'` checks returned zero task-owned containers.

The explicit staged no-op baseline was
`git add -- packages/db/src/schema packages/db/drizzle packages/db/src/version.ts packages/db/src/version.test.ts`.
After review, `pnpm --filter @eatbid/db db:generate` was run twice and each run reported
`No schema changes, nothing to migrate`. The final proof also produced zero unstaged schema/migration diff and zero
new untracked schema/migration files.

## Governance ruling

Gate 16.1's DB-governance expectation was stale because Gate 16.3 intentionally introduces the first approved
server database consumer. `packages/db/src/ddl-authority.test.ts` now requires the exact `postgres: 3.4.9` catalog,
server catalog/workspace declarations, no server `drizzle-kit`, and permits production database imports only under
`apps/server/src/platform/database/` or a module's `infrastructure/drizzle/` directory. Existing synthetic
architecture tests continue rejecting direct controller imports of `@eatbid/db`, Drizzle, or postgres, controller
require/dynamic/re-export paths, framework/database imports in domain, and application dependency inversion.
`packages/db/src/migrate.test.ts` moved only its synthetic future journal fixture beyond the new real migration.
Sole-DDL, exact catalog/version, lockfile lane, and future-unapproved-consumer checks were not weakened.

## Install evidence

- `pnpm install --filter @eatbid/server... --frozen-lockfile --strict-peer-dependencies` — exit 0 for the real
  backend dependency closure.
- `pnpm install --filter @eatbid/server... --lockfile-only --frozen-lockfile --strict-peer-dependencies` — exit 0;
  the lockfile remained immutable.
- `pnpm install --frozen-lockfile` — exit 0 for the complete workspace.
- Per the controller ruling, no frontend peer override/change was introduced. The known full-root strict-peer
  React 19 / `kbar -> react-virtual@2.10.4` mismatch remains Task 17 work.

## Final Gate 16.3 evidence

- `pnpm --filter @eatbid/db test` — 77 passed, 0 failed, 273 assertions.
- `pnpm --filter @eatbid/db db:check` — `Everything's fine`.
- Reviewed-baseline `pnpm --filter @eatbid/db db:generate` — no schema changes; zero unstaged and untracked
  schema/migration files.
- `pnpm --filter @eatbid/contracts test` — 3 passed, 0 failed, 24 assertions.
- `pnpm --filter @eatbid/server test` — 82 passed, 0 failed, 357 assertions across 21 files.
- `pnpm --filter @eatbid/server test:integration` — 2 passed, 0 failed, 30 assertions.
- `pnpm --filter @eatbid/server test:e2e` — 14 passed, 0 failed, 107 assertions.
- `pnpm --filter @eatbid/server architecture:check` — 0 violations.
- `pnpm --filter @eatbid/server openapi:check` — committed artifact matched.

## Reverse gate evidence

Reverse Gate 16.2 completed with contracts 3/3, server 82/82, e2e 14/14, OpenAPI, architecture, infrastructure
125/125, root tests, and Turbo build all green. It preserved request IDs, bounded parsing, exact CORS/raw transport
order, `/api/v1`, health routes, logging, drain/deadline shutdown, and deterministic OpenAPI.

Reverse Gate 16.1 completed with server 82/82, architecture 0 violations, server build, `dev:smoke` 1/1, pinned
server image build, compatibility probe, and Turbo 5/5 green. The probe reported Node `v24.20.0`, Nest `12.0.1`,
Effect `4.0.0-rc.112`, and a closed application context.

## Full repository matrix

- `pnpm test` — root Bun suites 120 passed, contracts 3 passed, server 82 passed; 0 failed.
- `pnpm --filter @eatbid/db db:check` — passed.
- `node tools/architecture/check-stack-docs.mjs` — passed.
- `uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests` — 585 passed, 1 warning.
- `uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra/tests` — all checks
  passed.
- `uv run --project apps/dataplane pyright apps/dataplane/src` — 0 errors, 0 warnings, 0 information messages.
- `pnpm exec turbo build --force` — 5 successful, 5 total, 0 cached.
- `docker build --file Dockerfile.server --tag eatbid-server:task16-3-final .` — exit 0 from the pinned Node digest
  with a strict backend install.
- `docker run --rm eatbid-server:task16-3-final node dist/bootstrap/compatibility-probe.js` — exact Node/Nest/Effect
  versions and closed application context.

## Warnings and concerns

- The Windows host uses Node `v24.2.0`, so pnpm prints the expected engine warning against repository-pinned
  `24.20.0`; the final container is authoritative and reports `v24.20.0`.
- Pytest's 585 passing tests include the existing Windows cp949 subprocess-reader warning.
- Turbo/Next prints the existing multiple-lockfile workspace-root and Google Sans fallback warnings.
- Docker prints existing Node `url.parse()` deprecation and legacy pnpm deploy warnings.
- Normal root install prints the existing ignored `@scarf/scarf` build and Husky worktree `.git` warnings.

No blocking concern remains.
