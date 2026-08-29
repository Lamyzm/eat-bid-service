# Eatbid Stack Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Drizzle schema ownership into cohesive namespace/aggregate modules, move the shared Drizzle v1 toolchain to one compatible release-candidate pin, and publish an evidence-backed toolkit/method audit that future sessions can follow without creating a giant stack-spec file.

**Architecture:** `packages/db` is one DDL authority but not one source file: PostgreSQL namespaces contain cohesive aggregate modules and root indexes only compose exports. A pnpm catalog is the single authority for shared JavaScript dependency versions while each package declares only what it consumes. Architecture documentation is split into application runtime, contracts/validation, data platform, and delivery/operations views behind one small index; material release-lane decisions live in ADRs rather than mutable prose.

**Tech Stack:** pnpm 10 catalogs, Drizzle ORM/Kit 1.0.0-rc.4, Bun tests, Node.js documentation checks, C4/arc42/ADR documentation.

**Spec:** `docs/superpowers/specs/2026-08-29-eatbid-greenfield-architecture-design.md`

## Global Constraints

- A single source of truth means one authority and many focused modules, never one giant file.
- Drizzle schema files are grouped by PostgreSQL namespace and cohesive aggregate; `index.ts` files only compose exports and do not declare tables.
- `packages/db` remains the only Drizzle DDL owner; `apps/server` and `packages/shared` may consume Drizzle but may not define the new canonical schema.
- All explicit Drizzle consumers must resolve one ORM/Kit release lane atomically; mixed workspace versions are forbidden.
- Existing committed migration SQL and snapshots are append-only and must not be rewritten by a dependency upgrade.
- Use official project documentation, release registries, security advisories, and support policies as audit evidence; do not use secondary comparison blogs as authority.
- The audit classifies tools as `Adopted`, `Required before production`, `Deferred`, or `Rejected for foundation`; it does not install every recommended tool.
- No live deployment, production credential, push, merge, or destructive legacy removal is part of this plan.

---

### Task 1: Namespace/aggregate Drizzle schema layout

**Files:**
- Create: `packages/db/src/schema/ingest/run.ts`
- Create: `packages/db/src/schema/ingest/evidence.ts`
- Create: `packages/db/src/schema/ingest/publication.ts`
- Create: `packages/db/src/schema/ingest/index.ts`
- Create: `packages/db/src/schema/layout.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/ingest.test.ts`
- Delete: `packages/db/src/schema/ingest.ts`

**Interfaces:**
- Consumes: the data-foundation plan's completed Task 3 six-table ingest schema and existing public exports.
- Produces: the same `ingestRun`, `requestUnit`, `rawBlob`, `rawObservation`, `normalizedRecord`, and `publication` exports from `@eatbid/db/schema`; no DDL change.

- [ ] **Step 1: write the failing layout contract**

```typescript
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const schemaRoot = fileURLToPath(new URL("./", import.meta.url));

describe("schema module layout", () => {
  test("keeps ingest aggregates in focused modules", () => {
    for (const file of ["run.ts", "evidence.ts", "publication.ts", "index.ts"]) {
      expect(existsSync(path.join(schemaRoot, "ingest", file))).toBe(true);
    }
    expect(existsSync(path.join(schemaRoot, "ingest.ts"))).toBe(false);
  });
});
```

- [ ] **Step 2: verify the test fails on the monolithic ingest file**

Run: `bun test packages/db/src/schema/layout.test.ts`

Expected: FAIL because the aggregate modules do not exist and `ingest.ts` still exists.

- [ ] **Step 3: move declarations without changing their SQL model**

- `run.ts`: `ingestRun`, `requestUnit`, their statuses/checks/unique keys.
- `evidence.ts`: `rawBlob`, `rawObservation`, including the composite request/run FK.
- `publication.ts`: `normalizedRecord`, `publication`, and publication row-local checks.
- `ingest/index.ts`: re-export the three modules only.
- root `schema/index.ts`: re-export namespaces and `./ingest/index.js` only.

Preserve constraint names, column order, table names, public symbol names, and cross-module FK callbacks exactly. Do not move tests into production modules.

- [ ] **Step 4: prove the refactor is DDL-neutral**

Run:

```text
bun test packages/db/src/schema/layout.test.ts packages/db/src/schema/ingest.test.ts packages/db/src/schema/namespaces.test.ts
pnpm --filter @eatbid/db build
pnpm --filter @eatbid/db db:check
pnpm --filter @eatbid/db db:generate --name schema_layout_probe
git status --short
```

Expected: all tests/build/check PASS; generate reports `No schema changes, nothing to migrate`; no new migration directory exists.

- [ ] **Step 5: commit**

```bash
git add packages/db/src/schema
git commit -m "refactor: split ingest schema by aggregate"
```

---

### Task 2: Atomic Drizzle v1 RC release lane

**Files:**
- Create: `packages/db/src/toolchain.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/db/package.json`
- Modify: `packages/shared/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/adr/0013-drizzle-v1-release-lane.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/superpowers/plans/2026-08-29-eatbid-data-foundation.md`

**Interfaces:**
- Consumes: the data-foundation plan's completed Task 3 migration chain and all explicit workspace Drizzle consumers.
- Produces: default pnpm catalog entries `drizzle-orm: 1.0.0-rc.4` and `drizzle-kit: 1.0.0-rc.4`; every direct consumer uses `catalog:`.

- [ ] **Step 1: write a failing single-release-lane test**

```typescript
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));

async function packageJson(relativePath: string) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

describe("Drizzle toolchain authority", () => {
  test("all direct consumers use the one pnpm catalog release lane", async () => {
    const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("drizzle-orm: 1.0.0-rc.4");
    expect(workspace).toContain("drizzle-kit: 1.0.0-rc.4");

    for (const manifest of [
      await packageJson("packages/db/package.json"),
      await packageJson("packages/shared/package.json"),
      await packageJson("apps/server/package.json"),
    ]) {
      expect(manifest.dependencies?.["drizzle-orm"] ?? manifest.devDependencies?.["drizzle-orm"])
        .toBe("catalog:");
    }

    for (const manifest of [
      await packageJson("packages/db/package.json"),
      await packageJson("packages/shared/package.json"),
    ]) {
      expect(manifest.devDependencies?.["drizzle-kit"]).toBe("catalog:");
    }
  });
});
```

- [ ] **Step 2: verify the test fails on mixed manifest pins**

Run: `bun test packages/db/src/toolchain.test.ts`

Expected: FAIL because `pnpm-workspace.yaml` has no Drizzle catalog and the three manifests still contain `1.0.0-beta.22`.

- [ ] **Step 3: move the release lane to the pnpm catalog**

Add the exact default catalog:

```yaml
catalog:
  drizzle-orm: 1.0.0-rc.4
  drizzle-kit: 1.0.0-rc.4
```

Replace every direct Drizzle version in the three package manifests with `catalog:` and run `pnpm install --no-frozen-lockfile`. Do not add an override or a second version constant.

- [ ] **Step 4: record the decision and compatibility exit gate**

Create ADR 0013 with `Status: Accepted`, `Date: 2026-08-29`, and no superseded ADR. Record:

- the spike evidence: stable ORM `0.45.2`/Kit `0.31.10` regenerated a new `0000` migration from the v1 snapshot, while `1.0.0-rc.4` produced no schema changes;
- why a prerelease is accepted for the greenfield branch;
- the security floor of `1.0.0-beta.20` from GHSA-gpj5-g38j-94v9;
- the v1 GA upgrade gate: frozen install, one resolved Drizzle lane, DB tests/build, `db:check`, no-op `db:generate`, empty-PostgreSQL migration, and full workspace tests/build;
- rejected alternatives: mixed workspace pins, stable 0.45.x with regenerated history, floating `beta`/`rc` tags, and `db:push`.

Update `docs/adr/README.md` and the data-foundation plan's Tech Stack line to the RC4 pin.

- [ ] **Step 5: verify migration compatibility and the whole workspace**

Run:

```text
pnpm install --frozen-lockfile
bun test packages/db/src/toolchain.test.ts packages/db/src/schema/namespaces.test.ts packages/db/src/schema/ingest.test.ts
pnpm --filter @eatbid/db build
pnpm --filter @eatbid/db db:check
pnpm --filter @eatbid/db db:generate --name compatibility_probe
pnpm test
pnpm build
git status --short
```

Expected: toolchain/schema tests PASS; DB build/check PASS; generate reports `No schema changes, nothing to migrate`; workspace tests/build PASS; no migration or source file is generated; status contains only the planned Task 2 files before commit.

- [ ] **Step 6: commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/db packages/shared/package.json apps/server/package.json docs/adr docs/superpowers/plans/2026-08-29-eatbid-data-foundation.md
git commit -m "build: unify the Drizzle v1 release lane"
```

---

### Task 3: Split technology, contract, and method audit

**Files:**
- Create: `docs/architecture/stack/README.md`
- Create: `docs/architecture/stack/application-runtime.md`
- Create: `docs/architecture/stack/contracts-and-validation.md`
- Create: `docs/architecture/stack/data-platform.md`
- Create: `docs/architecture/stack/delivery-and-operations.md`
- Create: `tools/architecture/check-stack-docs.mjs`
- Modify: `docs/architecture/README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: current manifests/lockfiles, Accepted ADRs, the greenfield spec, the data-foundation plan, and official upstream release/support/security sources checked on 2026-08-29.
- Produces: a small stack index, four responsibility-focused audits, and `pnpm architecture:check` as the structural documentation gate.

- [ ] **Step 1: create a failing documentation-structure checker**

Create `tools/architecture/check-stack-docs.mjs` that exits nonzero until all four stack documents exist. Once they exist, it must verify:

- the index links to each of the four audit documents;
- every audit contains the headings `Current baseline`, `Decision table`, `Rejected or deferred`, and `Review triggers`;
- each decision table uses only `Adopted`, `Required before production`, `Deferred`, or `Rejected for foundation`;
- no stack document contains `TBD` or `TODO`;
- every relative Markdown link in the four stack documents resolves to an existing local file; HTTP links are exempt from local resolution.

Add root script:

```json
"architecture:check": "node tools/architecture/check-stack-docs.mjs"
```

- [ ] **Step 2: verify the checker fails before the documents exist**

Run: `pnpm architecture:check`

Expected: FAIL naming `docs/architecture/stack/README.md` as missing.

- [ ] **Step 3: write the application-runtime audit**

`application-runtime.md` covers Node.js, TypeScript, pnpm, Turborepo, Bun, Next.js, NestJS, Python, uv, Pydantic, httpx, pytest, Ruff, and Pyright. For every item record:

- repository declaration and resolved version or range;
- upstream support/release evidence URL and check date;
- disposition and reason;
- exact review trigger rather than a calendar-only promise.

Explicitly call out missing runtime pin enforcement separately from lockfile pinning. Do not introduce Volta, mise, or a second package manager in this audit task.

- [ ] **Step 4: write the contract and validation audit**

`contracts-and-validation.md` defines the authority and derivation direction for each boundary:

| Boundary | Authority | Allowed derivation |
|---|---|---|
| PostgreSQL DDL | focused Drizzle modules in `packages/db` | generated SQL migration and Drizzle TypeScript inference |
| TypeScript DB rows/inserts | Drizzle table/view definitions | `drizzle-orm/zod` select/insert/update schemas refined at the repository boundary |
| HTTP request/response | bounded-context Zod 4 schemas in a future `packages/contracts` | Nest DTO/OpenAPI projection and web runtime parsing/types |
| Python source/normalized records | Pydantic 2 models and validators | JSON Schema for inspection/testing only |
| Configuration | Zod on TypeScript and `pydantic-settings` on Python | typed immutable settings objects |

The document must explicitly forbid treating DB row schemas as public API DTOs, generating DDL from Zod/Pydantic, circular Zod↔OpenAPI↔code generation, and hand-maintaining duplicate TypeScript response interfaces.

Evaluate Zod 4 codecs/metadata/JSON Schema, `drizzle-orm/zod`, `nestjs-zod`, OpenAPI 3.1, `openapi-typescript` or an equivalent client projection, Pydantic `TypeAdapter`, Hypothesis, fast-check, Schemathesis, Testcontainers, structured logging, and Standard Schema. For each, classify a concrete use as `Adopted`, `Required before production`, `Deferred`, or `Rejected for foundation`. High-value recommendations must include:

- use `drizzle-orm/zod` only when a real TypeScript repository/API consumer exists;
- keep Pydantic as the dataplane normalization contract instead of generating it from TypeScript;
- add Hypothesis properties for leading-zero code preservation, deterministic normalization/gzip/replay, and count gates during their owning data-foundation tasks;
- generate OpenAPI from validated server contracts after the server is split into bounded modules, then test the wire contract rather than sharing DB row types;
- validate environment variables at process startup on both runtimes.

- [ ] **Step 5: write the data-platform audit**

`data-platform.md` covers PostgreSQL 16, Drizzle RC4, postgres-js, psycopg 3, Pydantic contracts, R2's S3 API, boto3, and the raw/ingest/core/app/mart authority chain. It must record the Task 2 release-lane result and classify Flyway/Liquibase, Prisma, dbt, Great Expectations, Kafka, Airflow, and Dagster as rejected or deferred with workload-specific reasons—not generic preference.

- [ ] **Step 6: write the delivery-and-operations audit**

`delivery-and-operations.md` covers Docker/BuildKit/buildx, GitHub Actions, Argo CD, Argo Workflows, Helm-as-an-Argo-source, Kustomize, Kubernetes version compatibility, dependency automation, vulnerability scanning, SBOM/provenance/signing, OpenTelemetry, secret delivery, and backup/restore testing.

Classify the current foundation baseline separately from production gates. At minimum, dependency automation, Trivy-compatible image scanning, SBOM/provenance, OpenTelemetry correlation by `run_id`/`observation_id`/`publication_id`, encrypted or external secret delivery, and a restore drill must be `Required before production` unless an existing Accepted ADR proves a stronger implemented control.

- [ ] **Step 7: write the index and wire architecture entry points**

`docs/architecture/stack/README.md` explains the four dispositions, links only to the four focused audits and relevant ADRs, and states that version truth lives in manifests/catalogs/lockfiles while docs record rationale and gates. Add a row to `docs/architecture/README.md` and a link in root `ARCHITECTURE.md`; do not duplicate the decision tables in either entry point.

- [ ] **Step 8: verify structure and existing build contracts**

Run:

```text
pnpm architecture:check
rg -n "TBD|TODO" docs/architecture/stack
pnpm test
pnpm build
git diff --check
```

Expected: architecture check PASS; the `rg` command returns no matches; existing tests/build PASS; no whitespace errors.

- [ ] **Step 9: commit**

```bash
git add ARCHITECTURE.md package.json tools/architecture docs/architecture
git commit -m "docs: audit stack adoption and production gates"
```

---

## Plan self-review

- Spec coverage: aggregate schema layout, dependency SSOT, DDL ownership, contract derivation boundaries, split documentation, current-vs-production boundaries, and official-source evidence each map to a concrete task.
- Placeholder scan: the plan contains no implementation placeholders; audit rows have an explicit required field set and disposition vocabulary.
- Interface consistency: Task 1 preserves all public schema exports and DDL; Task 3 consumes Task 2's RC4 catalog/ADR and does not create a second version or contract authority.
