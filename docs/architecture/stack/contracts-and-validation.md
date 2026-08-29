# Contracts and validation audit

Research was checked on 2026-08-29. This is a boundary policy, not a claim that all
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

| Boundary | Authority | Allowed derivation |
|---|---|---|
| PostgreSQL DDL | focused Drizzle modules in `packages/db` | generated SQL migration and Drizzle TypeScript inference |
| TypeScript DB rows/inserts | Drizzle table/view definitions | `drizzle-orm/zod` select/insert/update schemas refined at the repository boundary |
| HTTP request/response | bounded-context Zod 4 schemas in future `packages/contracts` | Nest DTO/OpenAPI projection and web runtime parsing/types |
| Python source/normalized records | Pydantic 2 models and validators | JSON Schema for inspection/testing only |
| Configuration | Zod on TypeScript and `pydantic-settings` on Python | typed immutable settings objects |

The direction is one-way at each boundary. DB row schemas are not public API DTOs;
DDL must not be generated from Zod or Pydantic; circular Zod-to-OpenAPI-to-code
generation is forbidden; and TypeScript response interfaces must not be maintained by
hand beside the validating schema/projection.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Zod 4 codecs | Decode wire/storage representations only inside a future bounded contract | [Zod codecs](https://zod.dev/codecs) | Deferred | Adopt when a concrete contract needs bidirectional representation conversion; do not use it to define DDL. |
| Zod 4 metadata and JSON Schema | Annotate bounded HTTP schemas and emit inspection/projection input | [Zod metadata](https://zod.dev/metadata), [JSON Schema](https://zod.dev/json-schema) | Required before production | Require when public server modules expose documented HTTP endpoints; review upon first external/client API. |
| `drizzle-orm/zod` | Generate select/insert/update validators at a real TypeScript repository/API boundary, then refine there | [Drizzle Zod integration](https://orm.drizzle.team/docs/zod) | Deferred | There is no such focused repository/API consumer yet; trigger on its introduction, never to expose rows as DTOs. |
| `nestjs-zod` | Keep request parsing/DTO projection while server contracts move out of `app.module.ts` | [nestjs-zod documentation](https://github.com/BenLorantfy/nestjs-zod) | Adopted | It is already declared and used for query DTOs; trigger when extracting the first bounded Nest module. |
| OpenAPI 3.1 | Generate from validated bounded server contracts after module split | [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.1.html) | Required before production | Test the emitted wire contract; trigger before exposing a supported API or generating a client. |
| `openapi-typescript` equivalent | Generate client types from the reviewed OpenAPI artifact | [openapi-typescript](https://openapi-ts.dev/introduction) | Required before production | Choose a projector only when a web/client consumes the published artifact; no duplicate response interfaces. |
| Pydantic `TypeAdapter` | Validate typed source fragments and normalized records at the Python boundary | [TypeAdapter API](https://docs.pydantic.dev/latest/concepts/type_adapter/) | Adopted | Pydantic 2 is the dataplane normalization authority; trigger when non-model source fragments are introduced. |
| Hypothesis | Property-test leading-zero codes, deterministic normalization/gzip/replay, and count/completeness gates | [Hypothesis documentation](https://hypothesis.readthedocs.io/) | Adopted | The dataplane now bounds arbitrary binary examples to prove deterministic content addressing/gzip, lossless round-trips, and namespace separation; extend it in the owning normalization and completeness tasks. |
| fast-check | Property-test TypeScript contract codecs/projections once they exist | [fast-check documentation](https://fast-check.dev/docs/introduction/) | Deferred | Trigger on a TypeScript codec or client projection with non-example invariants. |
| Schemathesis | Exercise generated public OpenAPI HTTP behavior | [Schemathesis documentation](https://schemathesis.readthedocs.io/) | Required before production | Trigger when OpenAPI is published and a staging server is available. |
| Testcontainers Python | Apply the compiled migration runner and validate capture transactions against a uniquely named disposable PostgreSQL 16 container | [Testcontainers Python PostgreSQL module](https://testcontainers-python.readthedocs.io/en/latest/modules/postgres/README.html) | Adopted | Task 7 owns and removes its container without fixed ports or shared volumes; review on a PostgreSQL major or Testcontainers major upgrade. |
| Structured logging | Emit JSON with `run_id`, `observation_id`, `publication_id`, Git SHA, parser/projector version | [OpenTelemetry log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) | Adopted | Required by ADR 0012; trigger whenever a new pipeline stage emits records. |
| Standard Schema | Consume a common schema interface only where a library demands it | [Standard Schema](https://standardschema.dev/) | Rejected for foundation | Zod/Pydantic boundary authorities are already explicit; trigger only if an adopted library requires interoperability. |
| Startup environment validation | Parse all TypeScript settings with Zod and Python settings with `pydantic-settings` before work begins | [Zod](https://zod.dev/), [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) | Required before production | Trigger before either deployable receives production secrets/configuration. |

## Rejected or deferred

Pydantic remains the dataplane source/normalization contract; it is not generated from
TypeScript. OpenAPI is a downstream projection after validated server contracts exist,
not an alternate authoring format. The remaining legacy shared schemas are neither a
license to share DB rows nor a reason to retain duplicate response interfaces.

## Review triggers

The first bounded Nest module, a real repository consumer, an external API, or a
dataplane normalization invariant starts the corresponding planned work. Each such
change must prove parse/serialization behavior at its boundary and preserve the
one-way derivation map above. Leading-zero source codes must remain text; gzip and
normalization/replay outputs must be deterministic; publication must gate on exact
counts before becoming current.
