# Contracts and validation audit

Research was checked on 2026-08-30. This is a boundary policy, not a claim that all
future packages or projections already exist.

## Current baseline

Current Zod 4 use is real but not yet a bounded HTTP-contract layer: web resolves
Zod `^4.3.6`; server declares Zod `^4.0.0` and `nestjs-zod ^5.0.0`, installs
`ZodValidationPipe`, and uses `createZodDto` only for two shared query DTOs. The
single server `app.module.ts` also creates request schemas inline for mutations.
`packages/shared/src/domain/*.ts` contains legacy Zod response/query shapes, including
an `auction.ts` comment claiming a Drizzle-to-Zod-to-web flow, while
`packages/shared/src/db/schema` retains an older DB schema. Those overlapping shapes
are not a future public-contract authority and must be retired or deliberately mapped
when its consumer is replaced. Do not treat them as evidence of a live generated API.

ADR 0016 supersedes this current Nest 11 integration direction for the target server:
Nest 12 native Standard Schema becomes the request/response/OpenAPI bridge and
`nestjs-zod` is removed. The first truthful artifact is OpenAPI 3.0.3 because the
official Nest Zod converter currently targets OpenAPI 3.0; a 3.1 header must not be
written onto 3.0-shaped output. OpenAPI 3.1 remains a later conformance upgrade.

| Boundary | Authority | Allowed derivation |
|---|---|---|
| PostgreSQL DDL | focused Drizzle modules in `packages/db` | generated SQL migration and Drizzle TypeScript inference |
| TypeScript DB rows/inserts | Drizzle table/view definitions | `drizzle-orm/zod` select/insert/update schemas refined at the repository boundary |
| HTTP request/response | bounded-context Zod 4 schemas in future `packages/contracts` | Nest 12 Standard Schema request/response validation, OpenAPI projection, and web runtime parsing/types |
| Python eaT source shape | reviewed `(source, endpoint, parser_version)` dataset/column contracts | canonical SHA-256 fingerprint used by publication validation |
| Python source/normalized records | Pydantic 2 models and validators | JSON Schema for inspection/testing only |
| Configuration | Zod on TypeScript and `pydantic-settings` on Python | typed immutable settings objects |

The direction is one-way at each boundary. DB row schemas are not public API DTOs;
DDL must not be generated from Zod or Pydantic; circular Zod-to-OpenAPI-to-code
generation is forbidden; and TypeScript response interfaces must not be maintained by
hand beside the validating schema/projection.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-30 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Zod 4 codecs | Keep the serializable wire schema authoritative while explicitly decoding/encoding Temporal and semantic domain values | [Zod codecs](https://zod.dev/codecs) | Adopted | Use codecs only at semantic-value boundaries. OpenAPI consumes the adjacent wire schema, not a runtime object schema. Add a codec only when both directions have tests and never derive DDL from it. |
| Zod 4 metadata and JSON Schema | Annotate bounded HTTP schemas and emit inspection/projection input | [Zod metadata](https://zod.dev/metadata), [JSON Schema](https://zod.dev/json-schema) | Required before production | Require when public server modules expose documented HTTP endpoints; review upon first external/client API. |
| `drizzle-orm/zod` | Generate select/insert/update validators at a real TypeScript repository/API boundary, then refine there | [Drizzle Zod integration](https://orm.drizzle.team/docs/zod) | Deferred | There is no such focused repository/API consumer yet; trigger on its introduction, never to expose rows as DTOs. |
| Nest 12 Standard Schema | Validate route input and output from bounded Zod schemas and project the same route schemas into Swagger | [Nest migration guide](https://docs.nestjs.com/migration-guide), [Nest OpenAPI introduction](https://docs.nestjs.com/openapi/introduction), [Standard Schema](https://standardschema.dev/) | Required before production | Replace the current global `nestjs-zod` pipe during the Nest 12 vertical slice. Verify input/output distinction and forbid DB schemas at this boundary. |
| `nestjs-zod` | Current Nest 11 compatibility bridge only | [nestjs-zod documentation](https://github.com/BenLorantfy/nestjs-zod) | Rejected for foundation | Remove with Nest 12 native Standard Schema; do not carry a duplicate DTO/cleanup layer without a proven missing capability. |
| OpenAPI 3.0.3 | Deterministically generate from validated bounded server contracts after module split | [Nest OpenAPI introduction](https://docs.nestjs.com/openapi/introduction), [OpenAPI 3.0.3 specification](https://spec.openapis.org/oas/v3.0.3.html) | Required before production | Commit or publish the generated artifact, assert stable operation IDs and request/response/problem schemas, and fail on unexplained diff. Swagger UI is dev-only by default. |
| OpenAPI 3.1 | Upgrade the actual emitted schema dialect, not only the document version | [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.1.html) | Deferred | Trigger when Nest's native Zod path emits 3.1 correctly or an explicit converter is justified; require nullable/union/dialect and client-generator conformance first. |
| `openapi-typescript` equivalent | Generate client types from the reviewed OpenAPI artifact | [openapi-typescript](https://openapi-ts.dev/introduction) | Required before production | Choose a projector only when a web/client consumes the published artifact; no duplicate response interfaces. |
| Pydantic `TypeAdapter` | Validate each Nexacro `Dataset/Row/Col` source row as `dict[str, StrictStr]` before normalization; `NormalizedAuction` and `BidListPage` are strict, extra-forbid normalized authorities | [TypeAdapter API](https://docs.pydantic.dev/latest/concepts/type_adapter/) | Adopted | Source-row unknown columns remain observable for fingerprint gating, while normalized model unknown fields fail instead of being discarded. Review on Pydantic major change or source-fragment drift. |
| Hypothesis | Property-test leading-zero codes, deterministic normalization/gzip/replay, and count/completeness gates | [Hypothesis documentation](https://hypothesis.readthedocs.io/) | Adopted | The dataplane bounds arbitrary binary examples for deterministic content addressing/gzip and arbitrary leading-zero code/count examples for lossless normalization and the exact completeness equation. Extend it with each new source-owned invariant. |
| fast-check | Property-test TypeScript contract codecs/projections once they exist | [fast-check documentation](https://fast-check.dev/docs/introduction/) | Deferred | Trigger on a TypeScript codec or client projection with non-example invariants. |
| Schemathesis | Exercise generated public OpenAPI HTTP behavior | [Schemathesis documentation](https://schemathesis.readthedocs.io/) | Required before production | Trigger when OpenAPI is published and a staging server is available. |
| Testcontainers Python | Apply the compiled migration runner and validate capture, normalization, lineage-manifest, and publication transactions against a uniquely named disposable PostgreSQL 16 container | [Testcontainers Python PostgreSQL module](https://testcontainers-python.readthedocs.io/en/latest/modules/postgres/README.html) | Adopted | The integration fixture owns and removes its container without fixed ports or shared volumes; Task 8 proves immutable raw evidence, run-scoped attempt/member lineage, exact publication membership, and replay-input provenance. Review on a PostgreSQL major or Testcontainers major upgrade. |
| Structured logging | Emit JSON with `run_id`, `observation_id`, `publication_id`, Git SHA, parser/projector version | [OpenTelemetry log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) | Adopted | Required by ADR 0012; trigger whenever a new pipeline stage emits records. |
| Startup environment validation | Parse all TypeScript settings with Zod and Python settings with `pydantic-settings` before work begins | [Zod](https://zod.dev/), [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) | Required before production | Trigger before either deployable receives production secrets/configuration. |
| `temporal-polyfill` | Provide a side-effect-free Stage-4 Temporal compatibility facade on pinned Node 24/browser runtimes | [Temporal proposal](https://github.com/tc39/proposal-temporal), [polyfill documentation](https://github.com/fullcalendar/temporal-polyfill) | Adopted | Pin exact `1.0.4`; import only from `packages/domain/src/time/temporal.ts`; do not patch globals. Remove only after every supported runtime has native Temporal and conformance tests pass. |
| Branded semantic values | Prevent implicit exchange of milliseconds, percentage-points, ratios, money, byte lengths, and coordinates | [ADR 0020](../../adr/0020-semantic-values-temporal-zod-contracts.md) | Adopted | Use focused domain types/factories, not a generic units framework. Extend only when a real source or use case introduces a new unit. |

## Rejected or deferred

Pydantic remains the dataplane source/normalization contract; it is not generated from
TypeScript. Standard Schema is a Nest interoperability interface, not a new schema
authority. OpenAPI is a downstream projection after validated server contracts exist,
not an alternate authoring format. The remaining legacy shared schemas are neither a
license to share DB rows nor a reason to retain duplicate response interfaces.

## Review triggers

The first bounded Nest module, a real repository consumer, an external API, or a
dataplane normalization invariant starts the corresponding planned work. Each such
change must prove parse/serialization behavior at its boundary and preserve the
one-way derivation map above. Leading-zero source codes must remain text; gzip and
normalization/replay outputs must be deterministic; publication must gate on exact
counts before becoming current.
