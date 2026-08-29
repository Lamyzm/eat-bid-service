# Application runtime audit

Research was checked on 2026-08-30. Repository declarations are the authority for
intent; lockfiles are the authority for a resolved JavaScript/Python dependency.
An executable available on a developer machine is not a repository pin.

## Current baseline

The root declares `node >=24`, `pnpm >=10`, and `packageManager: pnpm@10.12.1`.
CI pins Bun 1.2.22 and uv 0.12.6; the setup-uv action itself is pinned to an immutable
commit. Dockerfiles pin every base image by digest, including the Node 24, CPython 3.12,
and uv builder images. CI still selects Node `24` and Python `3.12` by family rather
than exact patch binary, so those setup steps are not exact executable pins. Root
`turbo ^2.5.0` resolves 2.10.12. TypeScript resolves 5.7.2 for web and db, and 5.9.3
for server and shared; web declares an exact `5.7.2`, while the others declare
`^5.7.0`. Server Nest `^11.0.0` resolves core 11.2.3 (along with its common/platform
packages). The dataplane requires Python `>=3.12`; `pyproject.toml` ranges and
`uv.lock` resolve Pydantic
2.13.5, defusedxml 0.7.1, httpx 0.28.1, psycopg 3.3.4, pytest 9.1.1,
Ruff 0.16.5, and Pyright 1.1.411.

The root `test` script still assumes Bun is installed for a developer shell, while CI
declares the exact Bun executable version. Lockfiles pin dependencies, Dockerfile base
digests pin build inputs, and the product manifest records final registry digests; none
of those declarations alone proves that this branch's CI images were published or
verified in production.

The accepted backend target is not yet the current package state. ADR 0016 requires
NestJS 12, an exact supported Node 24 LTS patch, and exactly pinned
`effect@4.0.0-rc.112` after a compatibility spike. The current developer Node 24.2.0 is
below the Nest 12 CLI's Node 24.15 minimum; the target patch is Node 24.20.0 LTS.
This upgrade must be one frozen-lock change with build, test, CLI schematic, Effect,
Drizzle, Better Auth, and OpenAPI checks rather than independent range bumps.

## Decision table

| Item | Repository declaration / resolved state | Official evidence checked 2026-08-30 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Node.js | `>=24`; image digest pinned but local/CI setup patch not unified; developer runtime observed at 24.2.0 | [Node release policy](https://nodejs.org/en/about/previous-releases), [latest Node 24 release directory](https://nodejs.org/download/release/latest-v24.x/) | Required before production | Pin Node 24.20.0 LTS across dev declaration, CI and container for the Nest 12 change. Review when Node 24 leaves LTS or the digest/runtime patch changes. |
| TypeScript | web/db resolve 5.7.2; server/shared resolve 5.9.3; web declares `5.7.2`, server/db/shared `^5.7.0` | [TypeScript 5.7 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html), [TypeScript 5.9 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) | Adopted | The lock presently has two resolved minors; review on a compiler-major proposal, a strict build failure, or a decision to converge them. |
| pnpm | `packageManager` exact `10.12.1`, `engines >=10`; frozen `pnpm-lock.yaml` | [pnpm package manager field](https://pnpm.io/package_json#packagemanager) | Adopted | It is the single JavaScript package manager; review if a frozen install differs from the committed lock. |
| Turborepo | root dev range `^2.5.0`; `pnpm-lock.yaml` resolves 2.10.12 | [Turborepo releases](https://github.com/vercel/turborepo/releases) | Adopted | It coordinates workspace tasks; review on a task-cache correctness failure or a major upgrade. |
| Bun | root tests invoke Bun; CI pins setup-bun to 1.2.22 | [Bun releases](https://github.com/oven-sh/bun/releases) | Adopted | The CI executable is exact while developer shells remain externally provisioned; review on a Bun version change or test-runtime divergence. |
| Next.js | web exact `16.2.12`; pnpm lock resolution | [Next.js releases](https://github.com/vercel/next.js/releases) | Adopted | Web deployable uses it; review for a security advisory affecting the resolved version or an App Router major migration. |
| NestJS | current server range `^11.0.0`, lock resolves 11.2.3; accepted target is exact Nest 12 release lane | [Nest migration guide](https://docs.nestjs.com/migration-guide) | Required before production | Upgrade the common/core/platform/CLI/config/swagger/testing family together and prove Standard Schema, logger, Better Auth raw transport and schematics on Node 24.20.0. No mixed Nest major. |
| Effect | not currently declared; candidate `effect@4.0.0-rc.112`, while registry stable is 3.22.1 | [Effect repository](https://github.com/Effect-TS/effect), [Effect migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md), [Effect runtime](https://effect.website/docs/runtime/) | Required before production | Drizzle v1 RC4's optional Effect peer requires Effect 4 beta or later. Initial use is typed application errors/retry/timeout behind one Nest-owned `EffectRunner`; no request-scoped runtime or second global Layer container. Replace the exact RC only through frozen-lock compatibility gates, and prefer stable 4 once released and proven. |
| Python | dataplane `requires-python >=3.12`; runtime image is digest-pinned, CI selects the 3.12 family | [Python status](https://devguide.python.org/versions/) | Required before production | The container bits are immutable but the CI setup request is not an exact patch binary; review when selecting an exact CI interpreter, when 3.12 reaches security-only/EOL, or when the base digest changes. |
| uv | CI pins 0.12.6 through an immutable setup action; builder image is digest-pinned; `uv.lock` is frozen | [uv releases](https://github.com/astral-sh/uv/releases) | Adopted | This is a repository-declared reproducibility control; review whenever the executable/action/image digest changes or a new version rewrites the lock format or dependency result. |
| Pydantic | `>=2.11,<3`; `uv.lock` 2.13.5 | [Pydantic releases](https://github.com/pydantic/pydantic/releases) | Adopted | Dataplane normalization contract; review before any 3.x proposal or a validator/JSON Schema compatibility failure. |
| defusedxml | `>=0.7.1,<1`; `uv.lock` 0.7.1 (stable) | [Python XML security guidance](https://docs.python.org/3.12/library/xml.html#xml-vulnerabilities), [defusedxml 0.7.1 release](https://pypi.org/project/defusedxml/0.7.1/) | Adopted | Python recommends defusedxml for server code parsing untrusted XML. The eaT boundary forbids DTDs, entities, and external references and tests each class. Review on the next stable major release, a security advisory, or a parser-behavior change; prereleases alone do not change the pin. |
| httpx | `>=0.28,<1`; `uv.lock` 0.28.1 | [httpx releases](https://github.com/encode/httpx/releases) | Adopted | Source HTTP client; review for a transport/TLS advisory or retry/capture semantics change. |
| pytest | `>=8.4,<10`; `uv.lock` 9.1.1 | [pytest releases](https://github.com/pytest-dev/pytest/releases) | Adopted | Dataplane test runner; review before 10.x or plugin incompatibility. |
| Ruff | `>=0.12,<1`; `uv.lock` 0.16.5 | [Ruff releases](https://github.com/astral-sh/ruff/releases) | Adopted | Dataplane lint gate; review before 1.x or a rule-set change that alters CI output. |
| Pyright | `>=1.1.400,<2`; `uv.lock` 1.1.411 | [Pyright releases](https://github.com/microsoft/pyright/releases) | Adopted | Dataplane static checking; review before 2.x or when a type-check failure follows a Python/Pydantic change. |

## Rejected or deferred

No second workspace package manager, Volta, or mise is introduced by this audit. Bun
remains the existing test runner rather than a dependency/install authority. Nest's
default Jest scaffold is not a reason to introduce a second TypeScript test runner.
Effect Layer/ManagedRuntime as a second application container, community adapters with
no Nest 12 peer support, `@nestjs/observe`, and a Fastify migration are rejected or
deferred until a measured need and compatibility proof exist.

## Review triggers

Run a frozen install and the applicable build/test chain whenever `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `pyproject.toml`, or `uv.lock` changes.
Open an ADR before changing the runtime family/pinning policy or adding a package
manager. Treat a security advisory for a resolved version, an upstream EOL notice, or
a reproducibility failure between CI and container execution as an immediate review
trigger. A committed pin is not production evidence until the protected-branch run and
published digest/signature verification are retained.
