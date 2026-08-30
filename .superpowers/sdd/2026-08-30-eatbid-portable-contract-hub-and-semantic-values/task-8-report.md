# Task 8 report — contract topology and semantic-value gates

## Status

Complete. TypeScript compiler-symbol and Python AST gates now fail closed around the contract and
semantic-value topology established in Tasks 0–7. Exact legacy frontend/shared debt is frozen in a
deletion-only fingerprint ledger, both contract generators remain check-only CI gates, and the final
authority/adaptor/dataflow rules are documented.

Base: `18b2dbc fix(server): align id docs and shutdown grace`.

## RED evidence

### TypeScript semantic mutations

Before `tools/architecture/check-semantic-values.mjs` existed:

```powershell
node --test tools/architecture/check-semantic-values.test.mjs
```

RED: all 9 tests failed with `MODULE_NOT_FOUND`. The fixtures already covered direct, aliased,
destructured, and conditional `Date`/`Temporal.Now`; static/`require`/dynamic date-library imports;
timer, duration, Drizzle floating/bigint, public-response, portable-schema graph, exact-exception, and
legacy-ledger mutations. A subsequent duplicate-identical-node mutation exposed an early ledger bug:
the checker incorrectly treated set membership as sufficient. It was changed to consume exact
fingerprint multiplicity, after which the extra copy failed as a new violation while deletion remained
allowed.

### Python semantic mutations

Before `tools/quality/check-python-semantic-values.py` existed:

```powershell
uv run --project apps/dataplane pytest tools/quality/test_check_python_semantic_values.py -q
```

RED: all 9 tests failed because the checker entrypoint was absent. The fixtures cover direct/import/
assignment/conditional aliases for naive `datetime`, `float` money/rates, raw sleep, and hand-written
normalized Pydantic, together with aware datetime, Decimal, coordinate, named `timedelta`, source
Pydantic, and the exact generated-model allow cases.

### Documentation and removed API surface

Two new stack-documentation mutations failed until the contract audit contained the required semantic
commands and distinguished internal `AuctionRecord` from inferred public `AuctionV1Response`. The
compile-time consumer fixture initially surfaced the missing export diagnostic from
`AuctionResponse`; the final assertion is deliberately tied to TypeScript diagnostic 2305/2724 and
the removed symbol name, proving the old TypeScript-only API cannot be imported.

## GREEN implementation

- `check-semantic-values.mjs` builds a TypeScript `Program` and uses compiler symbols and declaration
  resolution rather than regex-only matching. It follows import, namespace, assignment, destructuring,
  computed literal, and conditional origins for the governed rules.
- The only TypeScript exception boundaries are exact path/symbol pairs:
  `packages/domain/src/time/clock.ts` / `systemClock`, and
  `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts` /
  `AuctionRow` plus `postgresInstant`. Directory and substring exemptions do not exist.
- Public HTTP `*Response` shapes must be Zod-inferred. Application `AuctionRecord` is allowed as an
  internal port and is not treated as a public wire type.
- The portable-registry checker walks the reachable schema declaration graph and rejects codecs,
  transforms, preprocessors, runtime custom predicates/refinements/checks, `instanceof`, functions,
  and pipes. Guarded `z.custom` used by adjacent codecs outside that graph remains legal.
- `check-python-semantic-values.py` uses `ast` plus import/assignment/conditional origin resolution and
  scans production dataplane `src` and `scripts`, never `.venv` or tests. Only source payload models and
  `apps/dataplane/src/eatbid/generated/ingestion_v1.py` are valid Pydantic authoring surfaces.
- The contracts test compiles `removed-auction-response.consumer.ts` and requires the removed export
  diagnostic, providing a durable consumer/API-surface proof.

## Legacy baseline inventory and policy

`tools/architecture/semantic-value-legacy-baseline.json` contains 122 existing violations, exclusively
under `apps/web/src` and `packages/shared/src`:

| Rule | Count |
|---|---:|
| `ambient-date` | 92 |
| `bigint-number-mode` | 7 |
| `floating-canonical-ddl` | 9 |
| `raw-timer-value` | 10 |
| `untyped-duration` | 4 |

Every entry has exactly the ordered fields `path`, `rule`, `nodeKind`, normalized-node-text SHA-256
`fingerprint`, `reason`, and `removalGate`. Runtime comparison is a multiset: deleting occurrences is
allowed; a new occurrence, changed normalized text, changed path/kind/rule, or an additional identical
copy is rejected. Baseline write mode refuses strict backend/domain/contracts/DB violations, so those
areas cannot acquire general exemptions.

## CI ordering and drift behavior

The existing Windows workflow now performs:

1. `pnpm install --frozen-lockfile`.
2. `uv sync --frozen` in `apps/dataplane`.
3. strict-peer immutable backend lockfile closure checks.
4. `pnpm architecture:check` before TypeScript tests/build and dataplane tests/lint/typecheck.

`architecture:check` runs stack documentation, TypeScript semantic symbols, Python semantic AST,
Korean test-name quality, `contracts:check`, and `contracts:python:check`. Both generation checks compare
temporary output with committed artifacts and never rewrite tracked output in CI.

## Documentation evidence

`AGENTS.md`, `ARCHITECTURE.md`, arc42, C4, domain-and-data, contracts-and-validation, and
time-and-value-contracts now state the final authority direction:

- domain semantics → Zod canonical/public wire → application adapters, while Drizzle DDL and source
  Pydantic retain their bounded authorities;
- normalized Pydantic derives only from versioned JSON Schema;
- `AuctionRecord` is internal and `AuctionV1Response` is the public wire;
- `AuctionRow`/`postgresInstant` close PostgreSQL `Date | string`, and `systemClock` alone reads ambient
  time;
- Argo/dataplane validates the generated contract and writes directly to PostgreSQL through restricted
  roles without a product-server HTTP ingestion hop;
- frontend contract cutover and coordinate name-lookup enrichment remain explicit non-goals.

Existing accepted ADR files were not modified.

## Verification

Fresh final runs:

- `pnpm install --frozen-lockfile` — lockfile unchanged, exit 0.
- `uv sync --project apps/dataplane --frozen` — audit complete, exit 0.
- Focused Node mutation/stack tests — 17 pass, 0 fail.
- Focused Python semantic tests — 9 pass, 0 fail.
- `pnpm --filter @eatbid/contracts test` — 22 pass, including removed API fixture.
- `pnpm architecture:check` — stack/TS/Python/Korean/generation gates passed; 122 legacy fingerprints,
  328 TypeScript and 267 Python Korean specifications.
- `pnpm contracts:check` — exit 0; no tracked rewrite.
- `pnpm contracts:python:check` — exit 0; no tracked rewrite.
- `pnpm test` — quality Node 29 and Python 9, web/shared/DB 123, contracts 22, domain 31, server 91;
  all passed.
- `pnpm build` — 6 successful, 6 total.
- `pnpm db:check` — `Everything's fine`.
- `pnpm dataplane:test` — 478 passed, 1 warning.
- `pnpm dataplane:lint` — all checks passed.
- `pnpm dataplane:typecheck` — 0 errors, 0 warnings, 0 information.
- `node --check` for the new Node checker/tests, Ruff for the new Python checker/tests, and
  `git diff --check` — passed.

## Files

- Gates/tests/ledger: `tools/architecture/check-semantic-values.mjs`,
  `tools/architecture/check-semantic-values.test.mjs`,
  `tools/architecture/semantic-value-legacy-baseline.json`,
  `tools/quality/check-python-semantic-values.py`,
  `tools/quality/test_check_python_semantic_values.py`,
  `tools/architecture/check-stack-docs.mjs`, and its test.
- Consumer proof: `packages/contracts/fixtures/removed-auction-response.consumer.ts` and
  `packages/contracts/src/contracts.test.ts`.
- Wiring: `package.json`, `pnpm-lock.yaml`, `.github/workflows/build.yml`.
- Authority docs: `AGENTS.md`, `ARCHITECTURE.md`, `docs/architecture/arc42.md`, `c4.md`,
  `domain-and-data.md`, `stack/contracts-and-validation.md`, and `time-and-value-contracts.md`.

## Self-review

- Reviewed all dirty paths and the complete new checker/test sources; no unrelated source or generated
  artifact changes are present.
- Confirmed the TS gate relies on compiler AST/symbol resolution and the Python gate on `ast` origin
  resolution; regexes are limited to semantic names/package classification after symbol resolution.
- Exercised the exact exceptions with same-path/wrong-symbol failing mutations and exact-symbol passing
  fixtures.
- Confirmed the portable graph rejects alias/conditional runtime-only nodes without globally banning
  adjacent guarded `z.custom`.
- Confirmed the ledger is exact and multiplicity-aware, and strict packages cannot be baselined.
- Confirmed CI installs both lockfiles frozen before drift checks and invokes check mode only.
- No migration, merge, push, deployment, live-source action, frontend cutover, coordinate enrichment,
  adapter-boundary redesign, or multi-row eligibility work was performed.

## Concerns

- The host is Node `v24.2.0` while the repository pins `24.20.0`; every pnpm command reports the engine
  warning, although all local gates and builds passed. The pinned Windows CI runtime remains the final
  environment confirmation.
- `apps/web` prepare reports `.git can't be found` in the worktree but exits successfully. Next build
  repeats existing non-fatal multiple-lockfile root inference and Google Sans Flex fallback warnings.
- Dataplane integration tests pass 478/478 but emit one Windows-only
  `PytestUnhandledThreadExceptionWarning`: a subprocess output reader attempts cp949 decoding and sees a
  UTF-8 byte. This did not fail the suite and is outside the semantic-gate change.
- The brief requests independent review, but the task instruction explicitly prohibited subagents and
  reviewers. No independent review was requested; the self-review and complete verification above are
  the available evidence.
