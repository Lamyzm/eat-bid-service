# Contracts and validation audit

Research was checked on 2026-08-30. This is a boundary policy, not a claim that all
future packages or projections already exist.

## Current baseline

The bounded contract layer is now `packages/contracts`: Zod 4 `ingestion/v1` owns
canonical process JSON and `api/v1` owns public HTTP wire JSON. Nest 12 consumes those
schemas through Standard Schema request/response boundaries and emits the reviewed
OpenAPI 3.0.3 artifact. `packages/shared/src/domain` and its older Drizzle schema remain
frontend/shared legacy debt only; their exact AST fingerprints may be deleted but do
not become future contract or DDL authority.

`packages/domain` owns semantic values and invariants, while `packages/db` owns exact
Drizzle DDL. A source Pydantic model is hand-written only for the eaT source shape;
generated normalized Pydantic is derived from the versioned Zod-emitted JSON Schema.
OpenAPI 3.1 remains a later conformance upgrade and must not be claimed by changing
only the document header.

| Boundary | Authority | Allowed derivation |
|---|---|---|
| PostgreSQL DDL | focused Drizzle modules in `packages/db` | generated SQL migration and Drizzle TypeScript inference |
| TypeScript DB rows/inserts | Drizzle table/view definitions | `drizzle-orm/zod` select/insert/update schemas refined at the repository boundary |
| Canonical interchange JSON | Zod 4 `ingestion/v1` schemas in `packages/contracts` | versioned JSON Schema and generated Pydantic v2 models |
| HTTP request/response | Zod 4 `api/v1` schemas in `packages/contracts` | Nest 12 Standard Schema request/response validation, OpenAPI projection, and web runtime parsing/types |
| Python eaT source shape | reviewed `(source, endpoint, parser_version)` dataset/column contracts | canonical SHA-256 fingerprint used by publication validation |
| Python source records | hand-written Pydantic 2 models and validators | normalized adapter input only |
| Python normalized records | generated Pydantic v2 models | Zod-emitted JSON Schema; generated files are never edited |
| Configuration | Zod on TypeScript and `pydantic-settings` on Python | typed immutable settings objects |

The direction is one-way at each boundary. DB row schemas are not public API DTOs;
DDL must not be generated from Zod or Pydantic; circular Zod-to-OpenAPI-to-code
generation is forbidden; and TypeScript response interfaces must not be maintained by
hand beside the validating schema/projection.

`AuctionRecord` is the internal application read port, not a public wire response.
`AuctionV1Response` is inferred from the Zod `api/v1` schema; the removed TypeScript-only
`AuctionResponse` has a compile-time consumer fixture that must keep failing to import.
The exact PostgreSQL bridge is
`apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts`:
`AuctionRow` accepts driver `Date | string`, `postgresInstant` closes it into Temporal,
and `mapAuctionRow` creates the internal record. Ambient current time is restricted to
`packages/domain/src/time/clock.ts` `systemClock`.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-30 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Zod 4 codecs | Keep the serializable wire schema authoritative while explicitly decoding/encoding Temporal and semantic domain values | [Zod codecs](https://zod.dev/codecs) | Adopted | Use codecs only at semantic-value boundaries. OpenAPI consumes the adjacent wire schema, not a runtime object schema. Add a codec only when both directions have tests and never derive DDL from it. |
| Zod 4 metadata, registry and JSON Schema | Annotate versioned ingestion/API schemas and emit portable Python input | [Zod metadata](https://zod.dev/metadata), [JSON Schema](https://zod.dev/json-schema) | Adopted | Stable IDs own generated references. Portable registry rejects codec/transform/overwrite/runtime custom predicates; CI requires deterministic artifact diff. |
| `drizzle-orm/zod` | Generate select/insert/update validators at a real TypeScript repository/API boundary, then refine there | [Drizzle Zod integration](https://orm.drizzle.team/docs/zod) | Deferred | There is no such focused repository/API consumer yet; trigger on its introduction, never to expose rows as DTOs. |
| Nest 12 Standard Schema | Validate route input and output from bounded Zod schemas and project the same route schemas into Swagger | [Nest migration guide](https://docs.nestjs.com/migration-guide), [Nest OpenAPI introduction](https://docs.nestjs.com/openapi/introduction), [Standard Schema](https://standardschema.dev/) | Adopted | Keep input/output distinction explicit and forbid DB schemas at this boundary. Review on a Nest/Standard Schema major change. |
| `nestjs-zod` | Current Nest 11 compatibility bridge only | [nestjs-zod documentation](https://github.com/BenLorantfy/nestjs-zod) | Rejected for foundation | Remove with Nest 12 native Standard Schema; do not carry a duplicate DTO/cleanup layer without a proven missing capability. |
| OpenAPI 3.0.3 | Deterministically generate from validated bounded server contracts after module split | [Nest OpenAPI introduction](https://docs.nestjs.com/openapi/introduction), [OpenAPI 3.0.3 specification](https://spec.openapis.org/oas/v3.0.3.html) | Adopted | Keep the committed artifact, stable operation IDs and request/response/problem schemas under drift checks. Swagger UI is dev-only by default. |
| OpenAPI 3.1 | Upgrade the actual emitted schema dialect, not only the document version | [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.1.html) | Deferred | Trigger when Nest's native Zod path emits 3.1 correctly or an explicit converter is justified; require nullable/union/dialect and client-generator conformance first. |
| `openapi-typescript` equivalent | Generate an external client from the reviewed OpenAPI artifact | [openapi-typescript](https://openapi-ts.dev/introduction) | Deferred | Monorepo Next.js imports the Zod API schema and inferred type directly. Trigger only for a client that cannot consume the workspace package. |
| `datamodel-code-generator` | Generate deterministic strict Pydantic v2 normalized models from the versioned ingestion JSON Schema | [Pydantic integration](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/datamodel_code_generator/), [generator JSON Schema guide](https://datamodel-code-generator.koxudaxi.dev/jsonschema/) | Adopted | Pin through `uv.lock`, disable timestamps, commit generated output, and fail CI when regeneration changes files. Source Pydantic models remain hand-written. |
| Pydantic `TypeAdapter` | Validate each Nexacro `Dataset/Row/Col` source row as `dict[str, StrictStr]` before normalization and validate generated normalized models | [TypeAdapter API](https://docs.pydantic.dev/latest/concepts/type_adapter/) | Adopted | Source-row unknown columns remain observable for fingerprint gating; generated normalized models reject unknown fields. Review on Pydantic major change, generator change, or source-fragment drift. |
| Hypothesis | Property-test leading-zero codes, deterministic normalization/gzip/replay, and count/completeness gates | [Hypothesis documentation](https://hypothesis.readthedocs.io/) | Adopted | The dataplane bounds arbitrary binary examples for deterministic content addressing/gzip and arbitrary leading-zero code/count examples for lossless normalization and the exact completeness equation. Extend it with each new source-owned invariant. |
| fast-check | Property-test TypeScript contract codecs/projections once they exist | [fast-check documentation](https://fast-check.dev/docs/introduction/) | Deferred | Trigger on a TypeScript codec or client projection with non-example invariants. |
| Schemathesis | Exercise generated public OpenAPI HTTP behavior | [Schemathesis documentation](https://schemathesis.readthedocs.io/) | Required before production | Trigger when OpenAPI is published and a staging server is available. |
| Testcontainers Python | Apply the compiled migration runner and validate capture, normalization, lineage-manifest, and publication transactions against a uniquely named disposable PostgreSQL 16 container | [Testcontainers Python PostgreSQL module](https://testcontainers-python.readthedocs.io/en/latest/modules/postgres/README.html) | Adopted | The integration fixture owns and removes its container without fixed ports or shared volumes; Task 8 proves immutable raw evidence, run-scoped attempt/member lineage, exact publication membership, and replay-input provenance. Review on a PostgreSQL major or Testcontainers major upgrade. |
| Structured logging | Emit JSON with `run_id`, `observation_id`, `publication_id`, Git SHA, parser/projector version | [OpenTelemetry log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) | Adopted | Required by ADR 0012; trigger whenever a new pipeline stage emits records. |
| Startup environment validation | Parse all TypeScript settings with Zod and Python settings with `pydantic-settings` before work begins | [Zod](https://zod.dev/), [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) | Required before production | Trigger before either deployable receives production secrets/configuration. |
| `temporal-polyfill` | Provide a side-effect-free Stage-4 Temporal compatibility facade on pinned Node 24/browser runtimes | [Temporal proposal](https://github.com/tc39/proposal-temporal), [polyfill documentation](https://github.com/fullcalendar/temporal-polyfill) | Adopted | Pin exact `1.0.4`; import only from `packages/domain/src/time/temporal.ts`; do not patch globals. Remove only after every supported runtime has native Temporal and conformance tests pass. |
| Branded semantic values | Prevent implicit exchange of milliseconds, percentage-points, ratios, money, byte lengths, and coordinates | [ADR 0021](../../adr/0021-zod-portable-contract-hub.md) | Adopted | Use focused domain types/factories, not a generic units framework. Extend only when a real source or use case introduces a new unit. |

## Rejected or deferred

Hand-written Pydantic remains the dataplane source contract; normalized Pydantic is generated from the Zod
portable registry. Standard Schema is a Nest interoperability interface, not a new schema authority. OpenAPI is
a downstream projection after validated server contracts exist, not an alternate authoring format. Immer is not
a schema/domain composition layer, and a separate contract framework is not introduced while Zod native object
composition and Nest Standard Schema cover the required boundary. The remaining legacy shared schemas are neither
a license to share DB rows nor a reason to retain duplicate response interfaces.

## Enforced contract evidence

After `pnpm install --frozen-lockfile` and `uv sync --frozen`, CI runs these check-only gates before tests/builds:

```text
pnpm architecture:check
pnpm contracts:check
pnpm contracts:python:check
```

`pnpm architecture:check` includes `tools/architecture/check-semantic-values.mjs` and
`tools/quality/check-python-semantic-values.py`, Korean test-name quality, JSON Schema drift, and Python model
drift. Check mode never rewrites tracked outputs and normalizes CRLF/LF only for logical drift comparison. The
TypeScript checker uses compiler symbols and use-site assignments; the Python checker uses lexical-scope,
use-site-aware `ast` import/re-export resolution. Only `apps/web`/`packages/shared` exact path + node kind +
normalized-text hash fingerprints may remain in the deletion-only ledger. The portable registry file and exactly
one exported const top-level `portableContracts` root are mandatory. Its reachable graph includes called factory
bodies/returns. A `z.custom` guarded codec output outside the graph and a non-Zod helper named `transform` are not
globally forbidden; only Zod/schema-origin codec, transform/overwrite, or runtime custom predicates in the graph fail.

The publication gate runs on hosted Ubuntu, and a second hosted `windows-latest` portability job repeats frozen
pnpm/uv install, architecture drift, and semantic mutation tests. Image build waits for both; no self-hosted runner
is introduced.

Argo Workflows runs the dataplane, which validates the generated ingestion model and writes through restricted
roles directly to PostgreSQL rather than posting normalized rows to Nest HTTP. Frontend cutover and coordinate
name-lookup enrichment are separate, explicitly deferred product/data work.

## Review triggers

The first bounded Nest module, a real repository consumer, an external API, or a
dataplane normalization invariant starts the corresponding planned work. Each such
change must prove parse/serialization behavior at its boundary and preserve the
one-way derivation map above. Leading-zero source codes must remain text; gzip and
normalization/replay outputs must be deterministic; publication must gate on exact
counts before becoming current.
