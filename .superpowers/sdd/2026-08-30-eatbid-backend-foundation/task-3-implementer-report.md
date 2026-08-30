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

---

## Fix round 1

### Scope and outcome

Fix round 1 started from reviewed Task 3 commit
`27d6e6a0b9b24fef3a3a231464b709bd5e710b89` and addresses all three findings without adding
DDL, migrations, dependencies, runtime mutation, or a broader endpoint. Readiness now proves the connected API
role has exactly the approved capabilities, the signed-bigint/public response boundaries are finite, and the
production role contract documents the PostgreSQL 16 behavior verified below. The generated OpenAPI artifact was
regenerated only for the stricter public string lengths/patterns.

### Round 1 RED evidence

Tests were extended before production implementation.

- `pnpm --filter @eatbid/contracts test` — meaningful RED: 2 passed / 2 failed. The signed bigint one-over value
  `9223372036854775808` and the newly oversized public strings/amounts were still accepted.
- Focused domain/HTTP execution — meaningful RED: 3 passed / 3 failed. The domain accepted signed-bigint
  one-over; the one-over path returned 200 instead of 400; and an oversized repository title escaped as 200
  instead of failing the strict response boundary with 500.
- The isolated real PostgreSQL sequence case first proved baseline identity INSERT with zero sequence ACL, then
  granted sequence `USAGE`: the operation became usable while the old readiness result incorrectly remained
  true.
- The isolated real PostgreSQL escalation case granted database `TEMPORARY`: a temporary table became creatable
  while the old readiness result incorrectly remained true.
- Additional RED cases covered `CREATE` on all six relevant schemas, protected/app/migration table capabilities,
  object/database ownership, unsafe role flags, direct and transitive role escalation, and sequence
  `USAGE`/`SELECT`/`UPDATE`/ownership. Each case restores owner state and expects readiness to return true again.

An unexpected Bun timeout was diagnosed rather than weakening an assertion. `pg_stat_activity` showed the SQL
had completed and the postgres-js API session was `idle in transaction` after `BEGIN`; Bun's
`.resolves`/`.rejects` matcher path retained the postgres-js thenable. Explicit `await` plus ordinary boolean or
caught-error identity assertions returns immediately and preserves the same readiness/rollback checks. The
interrupted exact container `eatbid-gate16-3-6528-1788060464166` was force-removed after resolving it through the
task label. Earlier isolated diagnostics similarly removed
`eatbid-gate16-3-82408-1788059633290`, `eatbid-gate16-3-27280-1788059846403`, and
`eatbid-gate16-3-72500-1788059947084`.

### Least-privilege implementation and attacks

The single read-only catalog query now requires the exact committed migration, `LOGIN NOINHERIT`, database
`CONNECT`, schema `USAGE` on only `core`/`mart`/`app`/`drizzle`, SELECT on every current core/mart relation, all
four ordinary DML privileges on every current module-owned app relation, and SELECT on the migration journal. It
fails closed for:

- `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, `INHERIT`, `NOLOGIN`, database ownership,
  database `CREATE` or `TEMPORARY`, and any direct/transitive `MEMBER` or `SET ROLE` path;
- `CREATE` on `core`, `mart`, `app`, `ingest`, `drizzle`, or `public`;
- ownership of a relation/sequence/view/routine/type in the six relevant schemas;
- protected relation `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`, app
  `TRUNCATE`/`REFERENCES`/`TRIGGER`, any ingest/public table privilege, or any migration relation capability
  beyond journal SELECT; and
- any `USAGE`, `SELECT`, or `UPDATE` on every relevant sequence.

The disposable attacks prove real capability where it is independently usable: database TEMP creates a temp
table; schema CREATE creates and drops attack tables (the ingest-only CREATE grant is detected but is not usable
without the intentionally absent USAGE); mart TRUNCATE executes inside a deliberately rolled-back transaction;
public SELECT reads a probe; app/mart/migration ownership enables ALTER or UPDATE; database ownership enables
schema DDL; sequence grants enable `nextval`, `last_value`, or `setval`; and both direct and transitive membership
enable `SET ROLE` to a `CREATEROLE` target. Every grant/owner/flag/membership is restored before the next case.

Provisioning documentation now explicitly requires `REVOKE TEMPORARY ... FROM PUBLIC`, zero sequence ACL, zero
role membership, the safe role flags, no ownership, no schema CREATE, and the exact per-schema/table privileges.
The server still only detects drift and never changes grants or schema.

### PostgreSQL 16 identity-sequence ruling

The pinned image is
`postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416`.
The final standalone disposable probe created otherwise-equivalent
`GENERATED ALWAYS AS IDENTITY` and `BIGSERIAL` tables, granted the API table INSERT but revoked every sequence
ACL, and produced:

```text
INSERT into identity: exit 0, one row inserted
INSERT into BIGSERIAL: exit 1, permission denied for sequence bigserial_probe_id_seq
nextval(identity sequence): exit 1, permission denied
identity sequence USAGE/SELECT/UPDATE: false/false/false
TASK_CONTAINERS=0
```

Therefore the true minimum for the three current module-owned `app` identity sequences is zero API sequence
privileges. The integration catalog assertion enumerates all three exact sequences and proves
USAGE/SELECT/UPDATE are false. Identity default INSERT still succeeds; direct `nextval`, sequence SELECT, and
`setval` fail. Granting any one capability or transferring the owning identity table/sequence to the API role
makes readiness false and demonstrates the dangerous operation. This preserves the reviewer's useful BIGSERIAL
contrast without applying serial semantics to the actual identity DDL. The first standalone probe observed the
official container's temporary bootstrap server before its restart; its `finally` removed the exact labeled
container, and the successful rerun gated on the second ready event.

### Signed bigint and bounded public contract

Canonical IDs retain `^[1-9][0-9]*$`, have a 19-character allocation bound, and refine lexically against exact
PostgreSQL signed bigint maximum `9223372036854775807` without `Number`. Domain construction enforces the same
maximum. HTTP tests prove the maximum round-trips, `9007199254740993` remains exact, and one-over returns 400
before repository invocation.

The strict response contract now caps title 512, status 64, nullable display bid number 128, ISO timestamp 35,
source system 64, and external ID 512 characters. Currency remains exactly three uppercase characters and the
content hash exactly 64 lowercase hex characters. Amounts now exactly model non-negative PostgreSQL
`numeric(18,2)`: at most 16 integer digits and exactly two fractional digits (19 characters including the decimal
point). These are intentionally finite HTTP allocation limits even where canonical DB source text remains
unbounded. Boundary/one-over tests cover every field, and an oversized adapter result proves output validation
fails closed with 500 rather than leaking an unbounded response.

### Round 1 migration, install, and cleanup evidence

- Strict real backend closure install:
  `pnpm install --filter @eatbid/server... --frozen-lockfile --strict-peer-dependencies` — exit 0.
- Strict backend lockfile-only install:
  `pnpm install --filter @eatbid/server... --lockfile-only --frozen-lockfile --strict-peer-dependencies` — exit 0.
- Normal full workspace install: `pnpm install --frozen-lockfile` — exit 0; lockfile unchanged.
- After explicitly staging the already-reviewed DB schema/migration/version baseline,
  `pnpm --filter @eatbid/db db:generate` ran twice; both reported `No schema changes, nothing to migrate`.
  Schema/migration/version unstaged diff was zero and untracked schema/migration count was zero.
- The focused integration suite double-applied the committed chain in each disposable database and still checked
  the exact expected journal row. The real server startup left the journal at seven rows, so no startup mutation
  was introduced.
- `docker ps -a --filter label=eatbid.task=gate16-3 --format '{{.Names}}'` was empty after the focused suite, full
  suite, interrupted diagnostics, failed standalone bootstrap observation, and final successful sequence probe.

### Round 1 focused, reverse, and full GREEN evidence

- `pnpm --filter @eatbid/db test` — 77 passed, 0 failed, 273 assertions; `db:check` passed.
- `pnpm --filter @eatbid/contracts test` — 4 passed, 0 failed, 40 assertions.
- `pnpm --filter @eatbid/server test` — 86 passed, 0 failed, 462 assertions across 21 files.
- `pnpm --filter @eatbid/server test:integration` — 4 passed, 0 failed, 120 assertions.
- `pnpm --filter @eatbid/server test:e2e` — 18 passed, 0 failed, 205 assertions.
- Server architecture — 0 violations; OpenAPI check matched; server TypeScript build passed.
- Reverse Gate 16.2 infrastructure — 125 passed; contracts/server/e2e/OpenAPI/architecture remained green.
- Reverse Gate 16.1 — server build, architecture, and `dev:smoke` 1/1 passed.
- `pnpm test` — root Bun 120, contracts 4, server 86 passed; 0 failed.
- Full Python matrix — 585 passed with the existing Windows cp949 reader warning; Ruff all checks passed; Pyright
  0 errors/0 warnings/0 information.
- `node tools/architecture/check-stack-docs.mjs` passed; `pnpm exec turbo build --force` completed 5/5 with zero
  cached.
- `docker build --file Dockerfile.server --tag eatbid-server:task16-3-fix1 .` passed using exact Node
  `24.20.0-slim` digest and a strict backend install. The runtime probe returned Node `v24.20.0`, Nest `12.0.1`,
  Effect `4.0.0-rc.112`, and `applicationContextClosed: true`.

### Round 1 warnings and concerns

The host remains Node `v24.2.0` versus the repository engine `24.20.0`; the pinned container supplied the
authoritative exact-runtime result. Existing non-blocking warnings remain unchanged: the Python cp949 subprocess
reader warning, Next's multiple-lockfile/Google Sans fallback warnings, ignored `@scarf/scarf`, the Husky worktree
message, Docker's Node `url.parse()` deprecation, and legacy pnpm deploy warning. No frontend override or change
was made. No blocking concern remains.

---

## Fix round 2

### Scope and TDD evidence

Fix round 2 started from
`40998d8730c0943282fe1dea8a931d4d29ac4fa5` and changes only the readiness catalog query, its real
PostgreSQL attack suite, and the two production provisioning/architecture documents. It adds no DDL, migration,
dependency, endpoint, manifest activation, or runtime mutation.

The new test was written and run before production code. Against round 1, PostgreSQL reported
`has_table_privilege(...)=false` and `has_any_column_privilege(...)=true` for every one of 18 column-only grants,
while readiness incorrectly returned true for all 18. The exact focused RED was 0 passed / 1 failed after 43
successful assertions, with the final literal outcome comparison showing every expected `ready: false` was
received as `ready: true`.

The first test execution also characterized a real PostgreSQL restriction before the intended assertion:
temporary tables cannot reference permanent tables. The test was corrected—not weakened—to create and drop a
permanent attack table under a temporary adjunct `CREATE` grant only after recording the app REFERENCES-only
readiness result. The next run reached the intended all-18 RED described above.

After the minimal query change, the same isolated pinned-PostgreSQL test passed 1/1 with 44 assertions. A final
version grants the public probe's SELECT column ACL to `PUBLIC`, not directly to the API role, and still proves the
effective API capability is detected and executable. The final focused rerun remained 1/1 with 44 assertions and
left zero labeled containers.

### Effective column-ACL boundary

The readiness query retains its existing full-table requirements: core/mart read readiness still requires table
`SELECT` on every current relation, and every module-owned app relation still requires full table
`SELECT`/`INSERT`/`UPDATE`/`DELETE`. Partial column grants cannot satisfy those requirements.

For forbidden privileges, the query now calls `has_any_column_privilege(current_user, relation.oid, capability)`
once per capability; no comma list is used for column checks. This catches direct, `PUBLIC`, and effective role
grants while the independent direct/transitive membership checks continue to reject `SET ROLE` escalation. The
protected relation classes are covered consistently:

- core and mart reject column `INSERT`, `UPDATE`, and `REFERENCES`;
- app preserves its required full table DML but rejects column `REFERENCES`;
- ingest rejects column `SELECT`, `INSERT`, `UPDATE`, and `REFERENCES`;
- the migration journal rejects column `INSERT`, `UPDATE`, and `REFERENCES`, while any future non-journal
  `drizzle` relation additionally rejects column `SELECT`;
- public rejects column `SELECT`, `INSERT`, `UPDATE`, and `REFERENCES`.

Table-only capabilities (`DELETE`, `TRUNCATE`, and `TRIGGER`) remain covered by the round-1 table privilege
predicates. Sequence, ownership, database, schema, role flag, membership, and migration-version checks are
unchanged.

The disposable attack matrix enumerates all 18 applicable class/capability combinations and restores each grant
before the next case. It also proves real dangerous operations where safe: core column UPDATE and migration-name
column UPDATE execute inside deliberately rolled-back transactions; mart column INSERT executes and rolls back;
ingest column SELECT reads the seeded mode after a temporary adjunct schema-USAGE grant; app column REFERENCES
allows creation of a real foreign-key table after a temporary adjunct public-CREATE grant; and a column SELECT
granted to `PUBLIC` is effective for and executable by the API role. Adjunct grants are applied only after the
column-only readiness result is recorded and are always revoked in `finally` blocks.

The production Secret/role contract and backend architecture document now state explicitly that table policy
applies to effective table and column ACLs, including `PUBLIC` and role-derived grants. Runtime remains a
read-only detector and performs no grant/revoke operation.

### Fix round 2 verification evidence

- Strict backend closure install and strict lockfile-only install both exited 0; normal frozen root install exited
  0 with the lockfile unchanged.
- `pnpm --filter @eatbid/db test` — 77 passed, 0 failed, 273 assertions; `db:check` passed.
- After staging the reviewed DB baseline, two `db:generate` runs both reported no schema changes. DB
  schema/migration/version diff and untracked schema/migration counts were zero.
- `pnpm --filter @eatbid/contracts test` — 4 passed, 0 failed, 40 assertions.
- `pnpm --filter @eatbid/server test` — 87 passed, 0 failed, 506 assertions.
- `pnpm --filter @eatbid/server test:integration` — 5 passed, 0 failed, 164 assertions. Every disposable setup
  double-applied the committed migration chain and the intentional-failure cleanup case passed.
- `pnpm --filter @eatbid/server test:e2e` — 19 passed, 0 failed, 249 assertions.
- Server architecture reported 0 violations; OpenAPI matched; server build passed.
- Reverse Gate 16.2 infrastructure — 125 passed; reverse Gate 16.1 `dev:smoke` — 1 passed. The prior contracts,
  HTTP, OpenAPI, architecture, build, shutdown, route, and logging boundaries remained green.
- `pnpm test` — root Bun 120, contracts 4, server 87 passed; 0 failed.
- Full Python matrix — 585 passed with the existing Windows cp949 warning; Ruff passed; Pyright reported 0
  errors/0 warnings/0 information.
- Stack documentation check passed; forced Turbo build completed 5/5 with zero cached.
- `docker build --file Dockerfile.server --tag eatbid-server:task16-3-fix2 .` passed from the exact pinned Node
  digest. The runtime probe reported Node `v24.20.0`, Nest `12.0.1`, Effect `4.0.0-rc.112`, and a closed
  application context.
- Repeated `docker ps -a --filter label=eatbid.task=gate16-3 --format '{{.Names}}'` checks were empty after RED,
  focused GREEN, Gate 3, full repository, and final effective-PUBLIC runs.

Host/build warnings are unchanged from round 1: host Node `v24.2.0` versus pinned `24.20.0`, the existing cp949
reader warning, Next workspace/font warnings, ignored `@scarf/scarf`, Husky worktree notice, Node `url.parse()`
deprecation, and legacy pnpm deploy warning. No blocking concern remains.
