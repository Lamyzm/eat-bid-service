# Eatbid Time and Semantic Value Contracts Implementation Plan

> **PAUSED — DO NOT EXECUTE:** ADR 0021 changed the contract topology to a Zod portable contract hub,
> generated Pydantic bridge, and native nested composition. This plan predates that decision and must be
> replaced after the revised written spec is reviewed. Its task details are historical input only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one exact, testable foundation for time, money, rates, quantities, byte lengths, and coordinates, with Zod as the public wire-contract authority.

**Architecture:** `packages/domain` owns framework-free semantic values and a side-effect-free Temporal facade; `packages/contracts` owns bounded serializable Zod schemas and adjacent codecs; Drizzle and Pydantic remain independent storage/source authorities joined by golden fixtures. New backend/dataplane code is migrated immediately, while legacy frontend debt is frozen in an exact AST ledger until the separately approved frontend cutover.

**Tech Stack:** Node 24.20.0, TypeScript 5.9.3, temporal-polyfill 1.0.4, Zod 4.5.4, Nest 12 Standard Schema/OpenAPI, Drizzle/PostgreSQL numeric+bigint, Python Decimal+ZoneInfo, Bun test, pytest/Hypothesis.

**Spec:** `docs/superpowers/specs/2026-08-30-eatbid-time-and-value-contracts-design.md`

## Global Constraints

- Node is exact `24.20.0`; TypeScript is exact `5.9.3`.
- `temporal-polyfill` is exact `1.0.4` and may be imported only by `packages/domain/src/time/temporal.ts`; no global shim is installed.
- Every direct Zod consumer is exact `4.5.4`, preferably through one exact pnpm catalog entry; semver ranges are forbidden.
- `packages/domain` imports neither Nest, Effect, Drizzle, Zod, nor HTTP types.
- Public JSON schemas live in `packages/contracts`; public TypeScript wire types come only from `z.infer`, `z.input`, or `z.output`.
- Zod does not generate DDL. Drizzle row schemas do not become HTTP schemas. Pydantic is not generated from TypeScript.
- Absolute time is `Temporal.Instant`, business date is `Temporal.PlainDate`, regional time is `Temporal.ZonedDateTime`, and elapsed timeout is branded `ElapsedMilliseconds`.
- TypeScript does not perform canonical money/rate arithmetic with `number`; PostgreSQL `numeric` and Python `Decimal` remain exact authorities.
- Drizzle `bigint` uses `mode: "bigint"`; canonical money/rate fields do not use floating-point DDL.
- Source regional time uses IANA `Asia/Seoul`; internal/wire absolute time is canonical UTC ISO text ending in `Z`.
- Test titles and pytest function names are meaningful Korean behavior specifications.
- No frontend behavior change, no live eaT/R2 call, no Argo submit/sync, and no mutation of the user service at `127.0.0.1:8081` occurs in this plan.
- Every task uses RED→GREEN, focused verification, reverse regression, repository-wide verification proportional to the diff, one commit, and independent specification/code-quality review before the next task.

---

### Task 1: Exact dependency lane and focused domain package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/server/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/shared/package.json`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/compatibility.test.ts`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: repository Node `24.20.0`, TypeScript `5.9.3`, pnpm workspace conventions.
- Produces: buildable/testable `@eatbid/domain`; exact `temporal-polyfill@1.0.4`; one exact `zod@4.5.4` catalog lane.

- [ ] **Step 1: Add the package manifest and a RED compatibility test**

Create `packages/domain/package.json` with CommonJS output compatible with the current server and no framework dependency:

```json
{
  "name": "@eatbid/domain",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "bun test src"
  },
  "dependencies": {
    "temporal-polyfill": "1.0.4"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

Create `packages/domain/src/compatibility.test.ts` before the missing facade:

```ts
import { describe, expect, test } from "bun:test";
import { Temporal } from "./time/temporal";

describe("Temporal 호환 경계", () => {
  test("전역 객체를 변경하지 않고 UTC Instant를 생성한다", () => {
    const before = (globalThis as { Temporal?: unknown }).Temporal;
    expect(Temporal.Instant.from("2026-08-30T00:00:00Z").toString()).toBe("2026-08-30T00:00:00Z");
    expect((globalThis as { Temporal?: unknown }).Temporal).toBe(before);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the intended RED**

Run:

```powershell
pnpm --filter @eatbid/domain test
```

Expected: FAIL because `src/time/temporal.ts` does not exist, not because Bun or workspace resolution is broken.

- [ ] **Step 3: Pin one dependency lane and add the minimal facade**

Add exact catalog entries:

```yaml
catalog:
  zod: 4.5.4
  drizzle-orm: 1.0.0-rc.4
  drizzle-kit: 1.0.0-rc.4
  postgres: 3.4.9
```

Change every direct Zod dependency to `"zod": "catalog:"`. Add `@eatbid/domain: "workspace:*"` to server and contracts. Add server prebuild/pretest domain builds. Create:

```ts
// packages/domain/src/time/temporal.ts
export { Temporal } from "temporal-polyfill";
```

Export only the facade from `src/index.ts` for this task.

- [ ] **Step 4: Freeze and verify the exact dependency graph**

Run:

```powershell
pnpm install --no-frozen-lockfile
pnpm install --lockfile-only --frozen-lockfile
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/domain build
pnpm --filter @eatbid/contracts build
pnpm --filter @eatbid/server build
pnpm exec turbo build --force
```

Expected: domain test PASS; compiled server loads the CommonJS domain package; lockfile resolves Zod 4.5.4 and temporal-polyfill 1.0.4 exactly.

- [ ] **Step 5: Commit the dependency/package gate**

```powershell
git add pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json apps/server/package.json apps/web/package.json packages/contracts/package.json packages/shared/package.json packages/domain
git commit -m "build(domain): establish exact semantic value lane"
```

---

### Task 2: Temporal clock and elapsed-duration semantics

**Files:**
- Create: `packages/domain/src/time/clock.ts`
- Create: `packages/domain/src/time/clock.test.ts`
- Create: `packages/domain/src/time/elapsed-duration.ts`
- Create: `packages/domain/src/time/elapsed-duration.test.ts`
- Create: `packages/domain/src/time/instant-text.ts`
- Create: `packages/domain/src/time/instant-text.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `Temporal` from Task 1.
- Produces: `Clock`, `systemClock`, `fixedClock`, `ElapsedMilliseconds`, duration factories, canonical Instant parse/format functions.

- [ ] **Step 1: Write RED tests for clock isolation and bounded durations**

```ts
import { describe, expect, test } from "bun:test";
import { Temporal } from "./temporal";
import { fixedClock } from "./clock";
import { hours, milliseconds, minutes, seconds, toMilliseconds } from "./elapsed-duration";

describe("주입 가능한 시계", () => {
  test("고정 시계가 같은 Instant를 반복해서 반환한다", () => {
    const instant = Temporal.Instant.from("2026-08-30T12:34:56Z");
    const clock = fixedClock(instant);
    expect(clock.now().equals(instant)).toBe(true);
    expect(clock.now().equals(instant)).toBe(true);
  });
});

describe("고정 경과 시간", () => {
  test("명명한 단위를 안전한 밀리초로 변환한다", () => {
    expect(toMilliseconds(milliseconds(5))).toBe(5);
    expect(toMilliseconds(seconds(5))).toBe(5_000);
    expect(toMilliseconds(minutes(5))).toBe(300_000);
    expect(toMilliseconds(hours(1))).toBe(3_600_000);
  });

  test("음수와 비정수 밀리초 및 안전 범위 초과를 거부한다", () => {
    expect(() => seconds(-1)).toThrow();
    expect(() => milliseconds(0.1)).toThrow();
    expect(() => seconds(Number.MAX_SAFE_INTEGER)).toThrow();
  });
});
```

- [ ] **Step 2: Run RED tests**

```powershell
pnpm --filter @eatbid/domain test
```

Expected: FAIL on missing clock/duration modules.

- [ ] **Step 3: Implement the minimal exact APIs**

Use unique-symbol branding and checked multiplication:

```ts
declare const elapsedMillisecondsBrand: unique symbol;
export type ElapsedMilliseconds = number & {
  readonly [elapsedMillisecondsBrand]: "ElapsedMilliseconds";
};

export function milliseconds(value: number): ElapsedMilliseconds {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Elapsed milliseconds must be a nonnegative safe integer");
  return value as ElapsedMilliseconds;
}

function scaled(value: number, factor: number): ElapsedMilliseconds {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Elapsed duration must be finite and nonnegative");
  return milliseconds(value * factor);
}

export const seconds = (value: number) => scaled(value, 1_000);
export const minutes = (value: number) => scaled(value, 60_000);
export const hours = (value: number) => scaled(value, 3_600_000);
export const toMilliseconds = (value: ElapsedMilliseconds): number => value;
```

Define `Clock.now(): Temporal.Instant`; `systemClock` alone calls `Temporal.Now.instant()` and `fixedClock` returns the supplied immutable Instant.

- [ ] **Step 4: Add canonical Instant round-trip tests and implementation**

Tests must reject offset-preserving/noncanonical output and accept a valid UTC Instant:

```ts
expect(parseInstantText("2026-08-30T09:00:00Z").toString()).toBe("2026-08-30T09:00:00Z");
expect(formatInstantText(Temporal.Instant.from("2026-08-30T18:00:00+09:00"))).toBe("2026-08-30T09:00:00Z");
expect(() => parseInstantText("2026-08-30T18:00:00+09:00")).toThrow();
```

Implement `parseInstantText` with a canonical `Z` regex plus `Temporal.Instant.from`, and `formatInstantText` with `instant.toString()`.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/domain build
pnpm exec turbo build --force
git add packages/domain/src
git commit -m "feat(domain): define Temporal and elapsed duration semantics"
```

---

### Task 3: Exact quantitative and coordinate domain values

**Files:**
- Create: `packages/domain/src/decimal/canonical-decimal.ts`
- Create: `packages/domain/src/decimal/canonical-decimal.test.ts`
- Create: `packages/domain/src/money/currency.ts`
- Create: `packages/domain/src/money/money.ts`
- Create: `packages/domain/src/money/money.test.ts`
- Create: `packages/domain/src/rate/percentage-points.ts`
- Create: `packages/domain/src/rate/ratio.ts`
- Create: `packages/domain/src/rate/rate.test.ts`
- Create: `packages/domain/src/quantity/count.ts`
- Create: `packages/domain/src/quantity/byte-length.ts`
- Create: `packages/domain/src/quantity/quantity.test.ts`
- Create: `packages/domain/src/geo/coordinate.ts`
- Create: `packages/domain/src/geo/distance.ts`
- Create: `packages/domain/src/geo/geo.test.ts`
- Create: `test/fixtures/semantic-values.json`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: no framework package; JSON fixture is a repository cross-language authority.
- Produces: exact decimal/money/rate/count/byte/coordinate constructors and stable fixture outputs consumed by Tasks 4 and 6.

- [ ] **Step 1: Add the golden fixture and RED decimal/money tests**

The fixture contains exact accepted and rejected examples:

```json
{
  "instant": { "source": "2026-08-30T18:00:00+09:00", "utc": "2026-08-30T09:00:00Z" },
  "money": { "amount": "123456789.00", "currency": "KRW" },
  "bidRate": "90.123000",
  "ratio": "0.901230",
  "bigint": "9007199254740993",
  "coordinate": { "latitude": 37.5665, "longitude": 126.978, "crs": "EPSG:4326" }
}
```

Tests cover canonical fixed scale, leading/trailing form, negative/NaN/exponent rejection, KRW pairing, and no number constructor:

```ts
expect(canonicalDecimal("123456789.00", 2)).toBe("123456789.00");
for (const value of ["01.00", "1", "1.0", "1e2", "-1.00", "NaN"]) {
  expect(() => canonicalDecimal(value, 2)).toThrow();
}
expect(krw(canonicalDecimal("123456789.00", 2))).toEqual({ amount: "123456789.00", currency: "KRW" });
```

- [ ] **Step 2: Run RED tests**

```powershell
pnpm --filter @eatbid/domain test
```

Expected: FAIL because the value constructors do not exist.

- [ ] **Step 3: Implement canonical decimal and focused nominal types**

Use ASCII canonical strings with an exact scale. Do not add arithmetic. Implement separate unique-symbol brands for `PercentagePoints`, `Ratio`, `BidRate`, `FloorRate`, and `SharePercent`; named constructors validate their domain range without converting through number.

The ratio/percentage conversion uses string coefficient movement with a fixed requested output scale, not floating-point multiplication. Its tests include `90.123000 ↔ 0.901230` and explicit rejection when precision would be lost.

- [ ] **Step 4: Add RED count, byte, and geo tests**

```ts
expect(recordCount(9_007_199_254_740_993n)).toBe(9_007_199_254_740_993n);
expect(() => recordCount(-1n)).toThrow();
expect(byteLength(0n)).toBe(0n);
expect(payloadByteLimit(1_048_576)).toBe(1_048_576);
expect(wgs84Coordinate(37.5665, 126.978)).toEqual({
  latitude: 37.5665,
  longitude: 126.978,
  crs: "EPSG:4326",
});
for (const [lat, lon] of [[91, 0], [0, 181], [Number.NaN, 0]]) {
  expect(() => wgs84Coordinate(lat, lon)).toThrow();
}
```

- [ ] **Step 5: Implement checked bigint/number/coordinate factories**

Persisted count and byte constructors accept bigint only. `PayloadByteLimit` and `Meters` accept finite nonnegative safe numbers because downstream Node/map APIs require number. Coordinate factories return frozen WGS84 objects with finite/range checks.

- [ ] **Step 6: Verify fixture stability and commit**

```powershell
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/domain build
pnpm test
git add packages/domain/src test/fixtures/semantic-values.json
git commit -m "feat(domain): add exact quantitative value types"
```

---

### Task 4: Zod wire schemas and bidirectional codecs

**Files:**
- Create: `packages/contracts/src/primitives/time.ts`
- Create: `packages/contracts/src/primitives/time.test.ts`
- Create: `packages/contracts/src/primitives/decimal.ts`
- Create: `packages/contracts/src/primitives/money.ts`
- Create: `packages/contracts/src/primitives/money.test.ts`
- Create: `packages/contracts/src/primitives/rate.ts`
- Create: `packages/contracts/src/primitives/rate.test.ts`
- Create: `packages/contracts/src/primitives/quantity.ts`
- Create: `packages/contracts/src/primitives/quantity.test.ts`
- Create: `packages/contracts/src/primitives/geo.ts`
- Create: `packages/contracts/src/primitives/geo.test.ts`
- Modify: `packages/contracts/src/procurement/auction.ts`
- Modify: `packages/contracts/src/procurement/auction.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/openapi/openapi.json`

**Interfaces:**
- Consumes: Task 2/3 constructors and `test/fixtures/semantic-values.json`.
- Produces: serializable Zod wire schemas, domain codecs, `AuctionResponse` inferred only from Zod, deterministic OpenAPI primitives.

- [ ] **Step 1: Write RED wire/codec contract tests**

Tests prove parse, decode, encode, metadata, and invalid forms separately:

```ts
expect(instantTextSchema.parse("2026-08-30T09:00:00Z")).toBe("2026-08-30T09:00:00Z");
expect(z.decode(instantCodec, "2026-08-30T09:00:00Z").toString()).toBe("2026-08-30T09:00:00Z");
expect(z.encode(instantCodec, Temporal.Instant.from("2026-08-30T09:00:00Z"))).toBe("2026-08-30T09:00:00Z");
expect(moneyWireSchema.parse({ amount: "123456789.00", currency: "KRW" })).toEqual({ amount: "123456789.00", currency: "KRW" });
expect(() => moneyWireSchema.parse({ amount: 123, currency: "KRW" })).toThrow();
expect(() => coordinateWireSchema.parse({ latitude: 37.5, longitude: 126.9 })).toThrow();
```

- [ ] **Step 2: Run RED contracts**

```powershell
pnpm --filter @eatbid/domain build
pnpm --filter @eatbid/contracts test
```

Expected: FAIL because primitive schema modules are missing.

- [ ] **Step 3: Implement wire-first schemas and adjacent codecs**

Use `z.strictObject`, fixed canonical decimal regexes/refinements, explicit bounds, `.meta({ id, description, example })`, and `z.codec(wireSchema, domainSchema, { decode, encode })`. Export OpenAPI-facing wire schemas separately from codecs.

For timestamps, accept only canonical UTC text ending in `Z`. For potentially large bigint values, reuse one canonical nonnegative decimal string schema and convert with `BigInt` only in the codec. For money, require `currency: z.literal("KRW")`.

- [ ] **Step 4: Replace auction primitive fields without parallel interfaces**

Change `auctionResponseSchema` to compose `instantTextSchema.nullable()` and `moneyWireSchema.nullable()` for `baseAmount` and `plannedAmount`; remove the detached `currency` field. Keep IDs as canonical decimal strings. `AuctionResponse` remains:

```ts
export type AuctionResponse = z.infer<typeof auctionResponseSchema>;
```

Update fixtures and OpenAPI expectation so money is represented as `{ amount, currency }` and timestamps end in `Z`.

- [ ] **Step 5: Verify deterministic projection and commit**

```powershell
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/contracts build
pnpm --filter @eatbid/server openapi:generate
pnpm --filter @eatbid/server openapi:check
pnpm --filter @eatbid/server test
git add packages/contracts apps/server/openapi/openapi.json
git commit -m "feat(contracts): make Zod semantic wire schemas authoritative"
```

---

### Task 5: Migrate the new server and Drizzle boundary

**Files:**
- Modify: `apps/server/src/platform/config/environment.ts`
- Modify: `apps/server/src/platform/config/environment.test.ts`
- Modify: `apps/server/src/platform/shutdown/inflight-tracker.ts`
- Modify: `apps/server/src/platform/shutdown/inflight-tracker.test.ts`
- Modify: `apps/server/src/platform/shutdown/shutdown-coordinator.ts`
- Modify: `apps/server/src/platform/logging/logging.module.ts`
- Modify: `packages/db/src/version.ts`
- Modify: `packages/db/src/version.test.ts`
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/migrate.test.ts`
- Modify: `apps/server/src/platform/database/database-readiness.ts`
- Modify: `apps/server/src/platform/database/database-readiness.test.ts`
- Modify: `apps/server/src/modules/procurement/application/auction-reader.ts`
- Modify: `apps/server/src/modules/procurement/application/find-auction.ts`
- Modify: `apps/server/src/modules/procurement/application/find-auction.test.ts`
- Modify: `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts`
- Modify: `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.test.ts`
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/schema/core/codes.ts`
- Modify: `packages/db/src/schema/core/organizations.ts`
- Modify: `packages/db/src/schema/core/procurement.ts`
- Modify: `packages/db/src/schema/ingest/evidence.ts`
- Modify: `packages/db/src/schema/ingest/lineage.ts`
- Modify: `packages/db/src/schema/ingest/publication.ts`
- Modify: `packages/db/src/schema/ingest/run.ts`
- Modify: `packages/db/src/schema/core/canonical.test.ts`
- Modify: `packages/db/src/schema/ingest.test.ts`
- Modify: `packages/db/src/schema/ingest/lineage.test.ts`
- Modify: `apps/server/src/testing/database.integration.test.ts`
- Modify: `apps/server/src/testing/procurement.e2e.test.ts`

**Interfaces:**
- Consumes: domain Clock/duration/money and contract schemas/codecs.
- Produces: Date-free application records, typed environment durations/bytes, exact bigint Drizzle mapping, unchanged SQL DDL.

- [ ] **Step 1: Write RED server tests for semantic values**

Tests require:

```ts
expect(environment.shutdownGrace).toBe(seconds(10));
expect(environment.payloadLimit).toBe(payloadByteLimit(1_048_576));
expect(record.announcedAt?.toString()).toBe("2026-08-30T09:00:00Z");
expect(response.baseAmount).toEqual({ amount: "1000.00", currency: "KRW" });
```

Inject a fixed clock into shutdown/inflight deadline tests so no assertion calls `Date.now()`.

- [ ] **Step 2: Run focused RED tests**

```powershell
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/db test
```

Expected: FAIL on old `number`/`Date` fields and old flat money response.

- [ ] **Step 3: Migrate config, shutdown, logging, and migration timestamp**

Rename typed properties to expose meaning rather than suffix-only primitives:

```ts
readonly payloadLimit: PayloadByteLimit;
readonly shutdownGrace: ElapsedMilliseconds;
```

Zod environment transforms call domain factories. `ShutdownCoordinator` accepts `Clock` and `ElapsedMilliseconds`; `InflightTracker.waitForZero` accepts a `Temporal.Instant` deadline. Structured log timestamp uses injected Clock plus `formatInstantText`.

Replace `migrationNameTimestamp`/`expectedMigrationTimestamp` with `migrationNameInstant`/`expectedMigrationInstant`. Parse the UTC prefix with Temporal, parse Drizzle journal epoch-millisecond text as `BigInt(value) * 1_000_000n` through `Temporal.Instant.fromEpochNanoseconds`, and compare with `Instant.equals`; do not convert through `Number`, `Date`, or `Date.UTC`.

Add `@eatbid/domain: "workspace:*"` to `packages/db/package.json`; DB schema files still import no domain package. Only migration timestamp parsing uses the shared Temporal facade.

- [ ] **Step 4: Migrate procurement records and adapters**

`AuctionRecord` uses `Temporal.Instant | null` and `Money | null`. The Drizzle adapter is the only named `Date` bridge if the driver returns Date; it converts via epoch milliseconds directly to `Temporal.Instant.fromEpochMilliseconds`. The use case serializes through contract codec helpers and never calls `.toISOString()`.

- [ ] **Step 5: Change all target Drizzle bigint modes and prove SQL no-diff**

Replace `mode: "number"` with `mode: "bigint"` for IDs, counts, and byte lengths. Narrow HTTP status to a bounded integer representation only if a reviewed DDL migration is intentionally created; otherwise keep DB bigint but map it to bigint.

Stage the schema/migration baseline, run generation, and require zero SQL drift:

```powershell
git add packages/db/src/schema packages/db/drizzle
pnpm --filter @eatbid/db db:generate
git diff --exit-code -- packages/db/drizzle
if (git ls-files --others --exclude-standard -- packages/db/drizzle) { throw "Semantic mapping change created an unexpected migration" }
```

- [ ] **Step 6: Run database and HTTP verification**

```powershell
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/db test
pnpm --filter @eatbid/db db:check
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server test:integration
pnpm --filter @eatbid/server test:e2e
pnpm --filter @eatbid/server openapi:check
pnpm exec turbo build --force
```

- [ ] **Step 7: Commit the server/DB migration**

```powershell
git add apps/server packages/db
git commit -m "refactor(server): preserve time and numeric semantics"
```

---

### Task 6: Align the Python dataplane with the same canonical fixture

**Files:**
- Create: `apps/dataplane/src/eatbid/semantic_values.py`
- Create: `apps/dataplane/tests/unit/test_semantic_values.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/normalize.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/models.py`
- Modify: `apps/dataplane/tests/unit/test_eat_normalize.py`
- Modify: `apps/dataplane/tests/unit/test_project.py`
- Modify: `apps/dataplane/tests/integration/test_foundation_slice.py`

**Interfaces:**
- Consumes: root `test/fixtures/semantic-values.json`.
- Produces: IANA-zone source parsing, UTC-aware canonical datetimes, finite exact Decimal values, fixture parity with TypeScript.

- [ ] **Step 1: Write RED Python fixture and timezone tests**

```python
def test_서울_source_시각을_같은_UTC_Instant로_정규화한다() -> None:
    value = parse_source_datetime("20260830180000", "%Y%m%d%H%M%S")
    assert canonical_instant(value) == "2026-08-30T09:00:00Z"


def test_금액과_비율을_float를_거치지_않고_canonical_decimal로_직렬화한다() -> None:
    assert canonical_decimal(Decimal("123456789.00"), scale=2) == "123456789.00"
    assert canonical_decimal(Decimal("90.123000"), scale=6) == "90.123000"
```

Add Hypothesis coverage for arbitrary finite nonnegative Decimal coefficients within the DB precision and for aware/naive datetime rejection.

- [ ] **Step 2: Run RED pytest**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_semantic_values.py apps/dataplane/tests/unit/test_eat_normalize.py -q
```

Expected: FAIL because `semantic_values.py` and IANA-zone parsing do not exist.

- [ ] **Step 3: Implement aware time and exact decimal helpers**

Use:

```python
SEOUL_ZONE = ZoneInfo("Asia/Seoul")
UTC_ZONE = timezone.utc

def require_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value

def canonical_instant(value: datetime) -> str:
    return require_aware(value).astimezone(UTC_ZONE).isoformat(timespec="seconds").replace("+00:00", "Z")
```

Quantize Decimal with an explicit scale and reject nonfinite/negative values; never cast to float.

- [ ] **Step 4: Replace the fixed offset and tighten Pydantic models**

Replace `timezone(timedelta(hours=9))` with `ZoneInfo("Asia/Seoul")`. The source parser attaches that IANA zone and immediately converts the normalized field to UTC-aware datetime so Pydantic canonical JSON emits the same absolute instant. Add validators that reject naive datetime and nonfinite/negative monetary Decimal while preserving source-invalid records as typed normalization failures/quarantine inputs.

- [ ] **Step 5: Verify Python and cross-language fixture parity**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
uv run --project apps/dataplane pyright apps/dataplane/src
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/contracts test
```

- [ ] **Step 6: Commit the dataplane alignment**

```powershell
git add apps/dataplane
git commit -m "refactor(dataplane): canonicalize time and decimal values"
```

---

### Task 7: Fail-closed semantic-value quality gate and completion review

**Files:**
- Create: `tools/architecture/check-semantic-values.mjs`
- Create: `tools/architecture/check-semantic-values.test.mjs`
- Create: `tools/architecture/semantic-value-legacy-baseline.json`
- Create: `tools/quality/check-python-semantic-values.py`
- Create: `tools/quality/test_check_python_semantic_values.py`
- Modify: `package.json`
- Modify: `.github/workflows/build.yml`
- Modify: `AGENTS.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/architecture/README.md`
- Modify: `docs/architecture/domain-and-data.md`
- Modify: `docs/architecture/c4.md`
- Modify: `docs/architecture/runtime-and-deployment.md`
- Modify: `docs/architecture/arc42.md`
- Modify: `docs/architecture/stack/contracts-and-validation.md`
- Modify: `docs/architecture/glossary.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/adr/0020-semantic-values-temporal-zod-contracts.md`
- Modify: `docs/architecture/time-and-value-contracts.md`

**Interfaces:**
- Consumes: all preceding migrated code and the approved spec/ADR.
- Produces: CI-enforced no-new-debt policy, exact legacy ledger, synchronized architecture documentation, independent completion evidence.

- [ ] **Step 1: Write RED mutation fixtures for every bypass class**

The Node test creates temporary files and expects violations for direct/aliased/imported forms of:

```ts
new Date();
Date.now();
Temporal.Now.instant();
setTimeout(callback, 5_000);
import dayjs from "dayjs";
bigint("count", { mode: "number" });
doublePrecision("bid_rate");
```

It also proves no false positive for a shadowed local `Date`, a named adapter bridge, `seconds(5)`, a regular non-time numeric calculation, and legacy entries whose exact AST fingerprints are in the baseline. Python tests cover naive datetime, float money/rate annotations/conversion, raw `sleep(5)`, aware datetime, Decimal, and named timedelta constants.

- [ ] **Step 2: Run RED quality tests**

```powershell
node --test tools/architecture/check-semantic-values.test.mjs
uv run --project apps/dataplane pytest tools/quality/test_check_python_semantic_values.py -q
```

Expected: FAIL because the checkers are absent.

- [ ] **Step 3: Implement symbol-aware TypeScript and Python AST checks**

Use the TypeScript compiler API to resolve imports/bindings rather than matching identifier text. Baseline entries contain normalized repository path, rule ID, AST-node fingerprint, reason, and removal gate. The checker permits deletion, rejects new entries, and rejects a changed fingerprint that attempts to inherit an old exception.

Use Python `ast` with import alias resolution for datetime/float/sleep rules. Dynamic constructs the checker cannot prove are violations, not silent passes, inside governed production paths.

- [ ] **Step 4: Generate and review only the existing frontend/shared baseline**

Run an explicit `--write-baseline` mode once, review that every entry is pre-existing under `apps/web` or `packages/shared`, then remove write mode from normal CI invocation. No server/domain/contracts/db/dataplane production violation may enter the ledger.

- [ ] **Step 5: Wire the gate into local and CI entrypoints**

Set:

```json
{
  "scripts": {
    "architecture:check": "node tools/architecture/check-stack-docs.mjs && node tools/architecture/check-semantic-values.mjs && uv run --project apps/dataplane python tools/quality/check-python-semantic-values.py && pnpm quality:check"
  }
}
```

Make `.github/workflows/build.yml` call the root architecture gate before tests/builds; do not duplicate a weaker command.

- [ ] **Step 6: Self-review documentation against implementation**

Check all ADR 0020 decisions have code/tests, scan for prohibited placeholder language from the writing-plan rules, verify every exported signature used by a later task exists, and update documentation only when implementation evidence differs from the approved design.

- [ ] **Step 7: Run the full completion matrix**

```powershell
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm test:quality
pnpm --filter @eatbid/domain test
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/db test
pnpm --filter @eatbid/db db:check
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server test:integration
pnpm --filter @eatbid/server test:e2e
pnpm --filter @eatbid/server openapi:check
uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra/tests tools/quality
uv run --project apps/dataplane pyright apps/dataplane/src
pnpm exec turbo build --force
docker build --file Dockerfile.server --tag eatbid-server:semantic-values .
docker run --rm eatbid-server:semantic-values node dist/bootstrap/compatibility-probe.js
```

Expected: all commands PASS; Node probe reports `v24.20.0`; no live source/Argo/8081 access occurs.

- [ ] **Step 8: Obtain independent reviews and fix every finding**

Provide reviewers the exact base/head commits, spec, ADR, task evidence, generated OpenAPI diff, legacy baseline diff, and Drizzle SQL no-diff evidence. The original implementer fixes findings; rerun the affected task plus the full matrix and obtain a fresh review until no finding remains.

- [ ] **Step 9: Commit, fast-forward main, push, and observe CI**

```powershell
git add tools package.json .github/workflows/build.yml AGENTS.md ARCHITECTURE.md docs
git commit -m "chore(architecture): enforce semantic value contracts"
```

Fast-forward main only after review. Preserve the user's existing dirty main paths. Push `master`, wait for the GitHub Actions run to finish successfully, and do not switch the current Argo application or port 8081 deployment in this task.
