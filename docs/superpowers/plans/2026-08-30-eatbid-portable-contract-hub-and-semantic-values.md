# Eatbid Portable Contract Hub and Semantic Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Checkboxes are the
> execution ledger; do not skip RED, focused verification, review, or commit boundaries.

**Goal:** Replace the duplicated Python/TypeScript normalized-auction contract and primitive-heavy backend
boundaries with one versioned Zod interchange authority, generated Pydantic models, framework-free semantic
values, and exact Drizzle/server adapters.

**Architecture:** `packages/contracts` owns portable Zod wire schemas and emits committed JSON Schema;
`datamodel-code-generator` deterministically emits the Python normalized model. Hand-written Pydantic remains
authoritative only for eaT source parsing, Drizzle remains authoritative for DDL, and `packages/domain` owns
runtime semantics without importing Zod, Nest, Effect, or Drizzle. Argo/dataplane writes ingest/core directly;
Nest reads canonical data and publishes nested public contracts. The frontend is not redesigned in this plan.

**Tech Stack:** Node 24.20.0, pnpm 10.12.1, TypeScript 5.9.3, Zod 4.5.4,
`temporal-polyfill` 1.0.4, Nest 12 Standard Schema/OpenAPI, Drizzle 1 RC/PostgreSQL,
Python 3.12+, Pydantic 2, `datamodel-code-generator` 0.76.0, Bun test, pytest/Hypothesis.

**Spec:** `docs/superpowers/specs/2026-08-30-eatbid-time-and-value-contracts-design.md`

## Global constraints

- First close the existing Korean-test quality gate. Architecture work does not start on a knowingly failing
  repository gate.
- Every task follows RED -> GREEN -> focused verification -> reverse regression -> independent review -> commit.
- Test titles and pytest function names are meaningful Korean behavior specifications.
- Zod direct dependencies are exact `4.5.4` through one catalog entry. Temporal is exact `1.0.4` and imported
  only through `packages/domain/src/time/temporal.ts`.
- `packages/domain` has no Zod, Nest, Effect, Drizzle, HTTP, or database dependency.
- Source Pydantic is hand-written; normalized Pydantic is generated; public TypeScript wire types are inferred
  from Zod; Drizzle row types never become public contracts.
- Final JSON is nested. Same-family variants use `.pick()`, `.omit()`, `.safeExtend()`, `.partial()`, and
  `.required()`. Do not repeat `.shape` spreads, use `z.intersection()` for DTO composition, add parallel
  interfaces, introduce a contract framework, or add Immer.
- Portable schemas contain only JSON-Schema-representable constructs. Codecs, Temporal instances, transforms,
  runtime brands, and custom predicates are excluded from the portable registry.
- Money/rates never pass through JavaScript/Python floating point. Large IDs/counts/byte lengths never pass
  through JavaScript `number`.
- No live eaT/R2 request, Argo submit/sync, frontend behavior change, or mutation of `127.0.0.1:8081`.
- Schema mapping-only changes must produce no SQL migration. Any DDL diff stops the task for explicit review.

---

### Task 0: Close the Korean-test quality gate

**Files:**
- Modify: `tools/quality/check-test-names.mjs`
- Modify: `tools/quality/check-test-names.test.mjs`
- Modify: `tools/quality/check-python-test-names.py`
- Modify: Python tests whose names describe chronology backwards, including
  `apps/dataplane/tests/integration/test_project.py`

**Contract:** Decorations such as `"한국 — English behavior"` and `test_emits_error_거부한다` do not satisfy
the Korean behavior-spec rule. Aliased/rest `node:test` bindings and callback/control-flow aliases are analyzed
fail-closed.

- [ ] **Step 1: Add RED mutation fixtures**

Add fixtures for object-rest require, destructuring assignment rest, callback reassignment, arrow callbacks,
`&&`/`||`/`??` conditional assignment, Korean decoration before English, and Korean suffix after English.

```js
expect(check('const {...tests}=require("node:test"); tests.test("English",()=>{});')).toFail();
expect(check('test("한국 — rejects an unsafe request",()=>{});')).toFail();
```

Add Python mutations for `test_emits_error_거부한다` and repair the four inverted chronology specifications so
the names state the behavior actually asserted.

- [ ] **Step 2: Run the intended RED**

```powershell
pnpm test:quality
pnpm quality:check
```

Expected: mutation tests fail for the newly exposed bypasses.

- [ ] **Step 3: Implement symbol/control-flow tracking and meaningful-language validation**

Track every binding that can resolve to `node:test`, including object-rest and assignment targets. Treat writes
inside callbacks and short-circuit branches as non-dominating. Tokenize Korean/Latin clauses and reject titles
whose behavioral predicate remains English with Korean decoration only. Apply the same predicate rule to pytest
names.

- [ ] **Step 4: Verify and review**

```powershell
pnpm test:quality
pnpm quality:check
pnpm test
```

Require an independent reviewer to confirm all previously reported bypasses are closed, then commit:

```powershell
git add tools/quality apps/dataplane/tests/integration/test_project.py
git commit -m "fix(quality): close Korean specification bypasses"
```

---

### Task 1: Establish the exact dependency lane and domain package

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `turbo.json`
- Modify: `apps/server/package.json`, `apps/web/package.json`, `packages/contracts/package.json`,
  `packages/shared/package.json`, `packages/db/package.json`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`, `packages/domain/src/time/temporal.ts`
- Create: `packages/domain/src/compatibility.test.ts`

**Produces:** buildable `@eatbid/domain`, one exact Zod lane, one side-effect-free Temporal facade.

- [ ] **Step 1: Write the RED compatibility test and package manifest**

```ts
import { expect, test } from "bun:test";
import { Temporal } from "./time/temporal";

test("Temporal facade가 전역 객체를 변경하지 않고 UTC Instant를 만든다", () => {
  const before = (globalThis as { Temporal?: unknown }).Temporal;
  expect(Temporal.Instant.from("2026-08-30T00:00:00Z").toString()).toBe("2026-08-30T00:00:00Z");
  expect((globalThis as { Temporal?: unknown }).Temporal).toBe(before);
});
```

Run `pnpm --filter @eatbid/domain test`; it must fail only because the facade is missing.

- [ ] **Step 2: Pin and implement the minimal lane**

Add catalog `zod: 4.5.4`, make every direct consumer use `"zod": "catalog:"`, add exact
`"temporal-polyfill": "1.0.4"` only to domain, and export:

```ts
export { Temporal } from "temporal-polyfill";
```

Add workspace dependencies from contracts/server/db to domain only where semantic types are consumed. Do not
add domain to web/shared in this task.

- [ ] **Step 3: Freeze, verify, commit**

```powershell
pnpm install --no-frozen-lockfile
pnpm install --lockfile-only --frozen-lockfile
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/domain build
pnpm exec turbo build --force
git add pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json apps/server/package.json apps/web/package.json packages/contracts/package.json packages/shared/package.json packages/db/package.json packages/domain
git commit -m "build(domain): establish exact semantic dependency lane"
```

---

### Task 2: Implement time and exact semantic domain values

**Files:**
- Create: `packages/domain/src/time/{clock,elapsed-duration,instant-text}.ts`
- Create: `packages/domain/src/time/{clock,elapsed-duration,instant-text}.test.ts`
- Create: `packages/domain/src/numeric/{canonical-decimal,money,rates,quantities}.ts`
- Create: `packages/domain/src/numeric/{canonical-decimal,money,rates,quantities}.test.ts`
- Create: `packages/domain/src/geo/coordinate.ts`, `packages/domain/src/geo/coordinate.test.ts`
- Modify: `packages/domain/src/index.ts`

**Produces:** `Clock`, `Temporal.Instant`, branded elapsed duration, exact decimal/money/rates, bigint
quantities/byte lengths, and WGS84 coordinate factories.

- [ ] **Step 1: Write RED boundary/property tests**

```ts
expect(toMilliseconds(seconds(5))).toBe(5_000);
expect(() => milliseconds(0.1)).toThrow();
expect(canonicalDecimal("10000000.10", 2)).toBe("10000000.10");
expect(() => canonicalDecimal("1e3", 2)).toThrow();
expect(krw(canonicalDecimal("1.00", 2))).toEqual({ amount: "1.00", currency: "KRW" });
expect(wgs84(latitude(37.5665), longitude(126.9780))).toEqual({
  latitude: 37.5665, longitude: 126.978, crs: "EPSG:4326",
});
```

Also prove bid rate, floor rate, share percent, expected/captured/published count, sample count, byte length, and
payload-byte limit cannot be assigned interchangeably at compile time.

- [ ] **Step 2: Implement minimal named factories**

```ts
export interface Clock { now(): Temporal.Instant }
export const systemClock: Clock = { now: () => Temporal.Now.instant() };
export const fixedClock = (instant: Temporal.Instant): Clock => ({ now: () => instant });
```

Use unique-symbol brands. Decimal validates canonical fixed scale without `Number`; persisted counts/bytes use
`bigint`; payload limits use bounded safe integers. Rate conversions require explicit input scale, output scale,
and rounding mode. Coordinate factories validate finite latitude/longitude ranges and always attach
`EPSG:4326`.

- [ ] **Step 3: Verify reverse cases and commit**

```powershell
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/domain build
pnpm exec tsc -p packages/domain/tsconfig.json --noEmit
git add packages/domain
git commit -m "feat(domain): define exact time and semantic values"
```

---

### Task 3: Build nested Zod atoms, values, resources, and codecs

**Files:**
- Create: `packages/contracts/src/atoms/{decimal,identifier,instant,geo,source-code}.ts`
- Create: `packages/contracts/src/values/{money,rate,coordinate,provenance}.ts`
- Create: `packages/contracts/src/resources/procurement/{identity,schedule,pricing,buyer,location,classification}.ts`
- Create: `packages/contracts/src/codecs/{money,temporal}.ts`
- Create: `packages/contracts/src/api/v1/auctions/{resource,get-auction.response,operations}.ts`
- Create: `packages/contracts/src/api/v1/auctions/get-auction.response.test.ts`
- Modify: `packages/contracts/src/procurement/auction.ts`, `packages/contracts/src/procurement/auction.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/contracts.test.ts`

**Produces:** nested public auction JSON and inferred `AuctionV1Response`; reusable portable atoms/values;
adjacent wire/domain codecs. The current flat export remains a named migration bridge until Task 7 so the
repository stays green between commits.

- [ ] **Step 1: Write the RED nested public-response test**

```ts
const response = {
  identity: {
    auctionId: "9007199254740993", revisionId: "9007199254740995",
    externalBidId: "opaque", displayBidNumber: null, title: "급식 식재료", status: "OPEN",
  },
  schedule: { announcedAt: "2026-08-30T00:00:00Z", deadlineAt: null, openedAt: null },
  pricing: { baseAmount: { amount: "1234567890.50", currency: "KRW" }, plannedAmount: null },
  provenance: {
    sourceSystem: "eat", observationId: "9007199254740997",
    normalizedRecordId: "9007199254740999", contentSha256: "a".repeat(64),
  },
};
expect(auctionResponseSchema.parse(response)).toEqual(response);
expect(auctionResponseSchema.safeParse({ ...response, sourcePayload: {} }).success).toBe(false);
```

RED must show the old flat response is still accepted and the new nested shape is absent.

- [ ] **Step 2: Implement bottom-up composition**

Atoms own regex/range/metadata. Values are `z.strictObject`. Resource files group lifecycle-coherent fields.
The final schema is:

```ts
export const auctionResourceSchema = z.strictObject({
  identity: publicAuctionIdentitySchema,
  schedule: auctionScheduleSchema,
  pricing: auctionPricingSchema,
  provenance: auctionProvenanceSchema,
}).meta({ id: "EatbidApiV1Auction" });
export const auctionV1ResponseSchema = auctionResourceSchema;
export type AuctionV1Response = z.infer<typeof auctionV1ResponseSchema>;
```

Reuse a same-family identity base via `.pick()`/`.omit()` and refinement-preserving `.safeExtend()` only.
Use `instantTextSchema` in OpenAPI and `z.codec()` only in `codecs/temporal.ts`; never register the codec as
portable. Money codec delegates to domain factories rather than duplicating validation.

- [ ] **Step 3: Verify old-shape rejection, OpenAPI compatibility, commit**

```powershell
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/contracts build
pnpm --filter @eatbid/server test
git add packages/contracts
git commit -m "feat(contracts): compose nested procurement contracts"
```

The legacy flat export is explicitly marked deprecated and tested only as a compatibility bridge. All contract,
server, and repository tests must be GREEN before commit; Task 7 removes the bridge after consumers migrate.

---

### Task 4: Add the versioned ingestion contract and deterministic JSON Schema emitter

**Files:**
- Create: `packages/contracts/src/ingestion/v1/normalized-auction.ts`
- Create: `packages/contracts/src/ingestion/v1/normalized-auction.test.ts`
- Create: `packages/contracts/src/ingestion/v1/resources/{identity,buyer,location,schedule,pricing,classification}.ts`
- Create: `packages/contracts/src/portable-registry.ts`
- Create: `packages/contracts/src/portable-registry.test.ts`
- Create: `packages/contracts/src/generate-json-schema.ts`
- Create: `packages/contracts/generated/ingestion-v1.schema.json`
- Create: `packages/contracts/fixtures/ingestion-v1/normalized-auction.json`
- Modify: `packages/contracts/package.json`, `packages/contracts/src/index.ts`, root `package.json`

**Produces:** `normalizedAuctionV1Schema`, a portable registry with stable IDs, deterministic committed JSON
Schema, and a canonical cross-language fixture.

- [ ] **Step 1: Write RED ingestion and determinism tests**

The V1 normalized wire is explicitly versioned and nested:

```ts
export const normalizedAuctionV1Schema = z.strictObject({
  contractVersion: z.literal("eatbid.ingestion.auction.v1"),
  identity: normalizedAuctionIdentitySchema,
  buyer: normalizedBuyerSchema,
  location: normalizedLocationSchema,
  schedule: normalizedAuctionScheduleSchema,
  pricing: normalizedAuctionPricingSchema,
  classification: normalizedClassificationSchema,
}).meta({ id: "EatbidIngestionAuctionV1" });
```

Test leading-zero codes, unknown-field rejection, UTC `Z` timestamps, fixed two-decimal KRW values, stable key
ordering, registry ID uniqueness, and two consecutive emitter runs producing byte-identical output.

The ingestion resource schemas compose shared atoms/values directly. They do not `.pick()` public API resources
or DB/source models, even when their current fields happen to match.

- [ ] **Step 2: Implement a portable-only registry and emitter**

```ts
export const portableContracts = Object.freeze([
  { id: "EatbidIngestionAuctionV1", schema: normalizedAuctionV1Schema },
] as const);
```

The emitter calls Zod's JSON Schema API with draft 2020-12, fails on unrepresentable types, sorts registry IDs
and object keys recursively, appends one LF, and writes only `packages/contracts/generated/ingestion-v1.schema.json`.
Add `contracts:generate` and `contracts:check` scripts; check mode generates to a temporary directory and performs
a byte comparison without rewriting the committed artifact. Package scripts run the TypeScript emitter with Bun,
so no second script runtime dependency is introduced.

- [ ] **Step 3: Verify generated drift behavior and commit**

```powershell
pnpm contracts:generate
pnpm contracts:check
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/contracts build
git diff --check
git add package.json packages/contracts
git commit -m "feat(contracts): publish portable ingestion schema"
```

---

### Task 5: Generate and consume the normalized Pydantic model

**Files:**
- Modify: `apps/dataplane/pyproject.toml`, `apps/dataplane/uv.lock`
- Create: `apps/dataplane/src/eatbid/generated/__init__.py`
- Create: `apps/dataplane/src/eatbid/generated/ingestion_v1.py`
- Create: `apps/dataplane/scripts/generate_contract_models.py`
- Create: `apps/dataplane/tests/unit/test_generated_contract.py`
- Modify: root `package.json`

**Produces:** deterministic generated Pydantic v2 model from the committed Zod artifact and a zero-drift CI
lane. Generated code is never hand-edited.

- [ ] **Step 1: Pin the generator and write RED parity tests**

Add exact `datamodel-code-generator==0.76.0` to the dev dependency group. Import the generated root class as
`EatbidIngestionAuctionV1`. Test that the golden fixture validates,
an extra field fails, codes retain leading zeros, and `model_dump(by_alias=True, mode="json")` recreates the
same logical JSON.

- [ ] **Step 2: Implement deterministic generation**

The checked-in script resolves paths from its own file, invokes:

```text
datamodel-codegen --input-file-type jsonschema --output-model-type pydantic_v2.BaseModel
  --preset practical-py312-20260619 --snake-case-field --disable-timestamp --formatters builtin
```

It writes a temporary file, normalizes LF, and either replaces the generated file (`--write`) or exits nonzero
on byte drift (`--check`). It must not inject current time or absolute paths. Add root scripts
`contracts:python:generate` and `contracts:python:check`.

- [ ] **Step 3: Verify regeneration and commit**

```powershell
uv lock --project apps/dataplane
pnpm contracts:python:generate
pnpm contracts:python:check
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_generated_contract.py -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
uv run --project apps/dataplane pyright apps/dataplane/src
git add package.json apps/dataplane
git commit -m "build(dataplane): generate normalized Pydantic contract"
```

---

### Task 6: Migrate the Python dataplane to the generated interchange model

**Files:**
- Modify: `apps/dataplane/src/eatbid/source/eat/models.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/normalize.py`
- Modify: `apps/dataplane/src/eatbid/pipeline/project.py`
- Modify: `apps/dataplane/src/eatbid/core/models.py`
- Modify: relevant repository adapters under `apps/dataplane/src/eatbid/{ingest,core}`
- Modify: `apps/dataplane/tests/unit/test_eat_normalize.py`, `test_project.py`
- Modify: `apps/dataplane/tests/integration/test_normalize_validate.py`, `test_project.py`,
  `test_foundation_slice.py`

**Produces:** hand-written source parsing -> generated normalized V1 -> canonical JSON -> direct DB projection,
using ZoneInfo/Decimal/int without Nest ingestion.

- [ ] **Step 1: Write RED source-to-generated and projection tests**

Assert the fixture normalizes to `contractVersion == "eatbid.ingestion.auction.v1"`, Seoul source time becomes
the same UTC instant ending in `Z`, money becomes a canonical two-decimal string inside `{amount,currency}`, and
the canonical payload is byte-stable. Projection tests consume the nested generated model and preserve code
namespace/role relationships.

- [ ] **Step 2: Split source and interchange authorities**

Keep `BidListPage` and actual eaT source shapes in `source/eat/models.py`; remove the hand-written
`NormalizedAuction`. Parse source timestamps with `ZoneInfo("Asia/Seoul")`, convert to UTC text, and convert
`Decimal` through an explicit fixed-scale serializer. Construct the generated model using Python snake-case
fields and serialize aliases:

```python
return json.dumps(
    record.model_dump(mode="json", by_alias=True),
    ensure_ascii=False, sort_keys=True, separators=(",", ":"),
).encode("utf-8")
```

`parse_canonical_normalized_auction` imports generated `EatbidIngestionAuctionV1`, rejects noncanonical bytes, and keeps
`record_type="auction.v1"`. Projection maps nested identity/buyer/location/schedule/pricing/classification to
existing canonical tables. No normalized row is posted to Nest.

- [ ] **Step 3: Verify full dataplane and commit**

```powershell
pnpm contracts:check
pnpm contracts:python:check
uv run --project apps/dataplane pytest apps/dataplane/tests -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
uv run --project apps/dataplane pyright apps/dataplane/src
git add apps/dataplane
git commit -m "refactor(dataplane): consume generated ingestion contract"
```

---

### Task 7: Migrate Drizzle and Nest boundaries to semantic values

**Files:**
- Modify: all `packages/db/src/schema/{core,ingest}` files containing `bigint(...mode: "number")`
- Modify: `packages/db/src/version.ts`, `packages/db/src/migrate.ts` and tests
- Modify: server config/logging/shutdown files containing ambient Date/raw durations
- Modify: `apps/server/src/modules/procurement/application/{auction-reader,find-auction}.ts` and tests
- Modify: `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts` and test
- Modify: `apps/server/src/modules/procurement/presentation/http/auction.controller.ts`
- Modify: `apps/server/src/testing/procurement.e2e.test.ts`
- Modify: generated OpenAPI artifact and OpenAPI tests
- Delete: legacy flat contract implementation/tests under `packages/contracts/src/procurement`
- Modify: `packages/contracts/src/index.ts`

**Produces:** bigint-safe Drizzle types, Temporal/Money application records, nested Zod response, deterministic
OpenAPI, and unchanged PostgreSQL DDL.

- [ ] **Step 1: Write RED adapter/use-case/E2E tests**

Require `Temporal.Instant` and `Money` in `AuctionRecord`; require nested response blocks; prove IDs above
`MAX_SAFE_INTEGER`, UTC instants, and exact amount strings survive database row -> application -> HTTP. Inject a
fixed `Clock` into logging/shutdown tests and use branded durations/payload limits in environment tests.

- [ ] **Step 2: Change Drizzle TypeScript mappings without changing SQL**

Replace every persisted ID/count/byte `mode: "number"` with `mode: "bigint"`. Keep numeric amounts as exact
strings. Update affected schema assertions and integration values to bigint. Run generation and stop if any SQL
file changes:

```powershell
pnpm --filter @eatbid/db db:generate
git diff --exit-code -- packages/db/drizzle
if (git ls-files --others --exclude-standard -- packages/db/drizzle) { throw "unexpected DDL migration" }
```

- [ ] **Step 3: Migrate time/config/logging/shutdown adapters**

Use `Clock`, `Temporal.Instant`, `ElapsedMilliseconds`, and `PayloadByteLimit`. Only the named postgres row
adapter may accept `Date|string`; it immediately converts to `Temporal.Instant`. Migration journal epoch text is
parsed losslessly through bigint nanoseconds. No application/controller code calls `new Date`, `Date.now`,
`.toISOString()`, or passes raw timer literals.

- [ ] **Step 4: Publish the nested contract**

`AuctionReader` returns semantic domain values. `toAuctionResponse` encodes through contract codecs into
`identity`, `schedule`, `pricing`, and `provenance`; controller response validation remains the final fail-closed
boundary. Switch consumers to `auctionV1ResponseSchema`/`AuctionV1Response`, remove the deprecated flat bridge,
regenerate OpenAPI, and assert stable schema IDs/refs and UTC/money examples.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/db test
pnpm --filter @eatbid/db db:check
pnpm --filter @eatbid/server test
pnpm exec turbo build --force
git add packages/contracts packages/db apps/server
git commit -m "refactor(server): preserve semantic values end to end"
```

---

### Task 8: Enforce contract topology and semantic-value policy

**Files:**
- Create: `tools/architecture/check-semantic-values.mjs`
- Create: `tools/architecture/check-semantic-values.test.mjs`
- Create: `tools/architecture/semantic-value-legacy-baseline.json`
- Create: `tools/quality/check-python-semantic-values.py`
- Create: `tools/quality/test_check_python_semantic_values.py`
- Modify: `tools/architecture/check-stack-docs.mjs`, `package.json`, CI workflow files
- Modify: `AGENTS.md`, `ARCHITECTURE.md`, `docs/architecture/{arc42,c4,domain-and-data}.md`
- Modify: `docs/architecture/stack/contracts-and-validation.md`
- Modify: `docs/architecture/time-and-value-contracts.md`

**Produces:** fail-closed AST/source gates, exact legacy debt ledger, generation-drift CI gates, and architecture
evidence other sessions can follow.

- [ ] **Step 1: Write RED mutation tests**

Mutations must catch: ambient Date/Temporal.Now outside adapters, forbidden date libraries, raw timer values,
untyped timeout/TTL fields, floating DDL for canonical money/rates, Drizzle bigint number mode, hand-written
public response interfaces, portable codecs/transforms/custom predicates, hand-written normalized Pydantic,
naive Python datetimes, float money/rates, and raw Python sleep literals. Include aliased/dynamic forms so the
checker fails closed.

- [ ] **Step 2: Implement scope-aware gates and an exact legacy ledger**

Use TypeScript compiler AST/symbol resolution for TS. Fingerprint existing web/shared violations by exact
path/node/text hash; allow deletion but reject additions or drift. Backend/domain/contracts/db/dataplane have no
general exceptions beyond named adapter paths. Python gate uses `ast` with import alias resolution.

- [ ] **Step 3: Wire all drift checks into CI**

`architecture:check` runs stack docs, semantic gates, Korean quality, JSON Schema drift, and Python-model drift.
Frozen install precedes generation checks. CI does not rewrite tracked artifacts.

- [ ] **Step 4: Record evidence and run full verification**

Update docs with the final dependency direction and commands. Then run:

```powershell
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm test:quality
pnpm contracts:check
pnpm contracts:python:check
pnpm test
pnpm build
pnpm db:check
pnpm dataplane:test
pnpm dataplane:lint
pnpm dataplane:typecheck
git diff --check
git status --short
```

Require independent specification and code-quality review with no unresolved findings, then commit:

```powershell
git add AGENTS.md ARCHITECTURE.md docs tools package.json .github
git commit -m "chore(architecture): enforce portable semantic contracts"
```

---

### Task 9: Integrate to main and verify Windows CI/CD

**Files:** no production changes expected.

- [ ] Confirm the feature worktree is clean and every Task 0-8 commit is reviewed.
- [ ] Fast-forward or merge into `master` while preserving the four pre-existing user dirty paths in the main
  checkout; never overwrite or stage them accidentally.
- [ ] Push `master`, watch the Windows CI run to completion, and fix failures in a reviewed follow-up commit.
- [ ] Do not switch the Argo application or deploy the frontend/API until required secrets and deployment target
  are explicitly ready. Current localhost 8081 remains untouched.

## Completion evidence

- One Zod V1 ingestion schema generates committed JSON Schema and committed Pydantic code with byte-zero drift.
- The eaT fixture follows source parse -> generated normalized contract -> canonical JSON -> projection without
  Nest ingestion and without loss of code leading zeros, UTC time, Decimal money, or provenance.
- Nest returns the nested Zod response from Temporal/Money/bigint application values; OpenAPI matches it.
- Drizzle uses bigint semantics and creates no DDL migration for the mapping-only change.
- Semantic and Korean test gates resist their mutation suites.
- Full test/build/type/lint and Windows CI are green; frontend redesign and coordinate enrichment remain separate
  user-planned work.
