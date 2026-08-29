# Application runtime audit

Research was checked on 2026-08-29. Repository declarations are the authority for
intent; lockfiles are the authority for a resolved JavaScript/Python dependency.
An executable available on a developer machine is not a repository pin.

## Current baseline

The root declares `node >=24`, `pnpm >=10`, and `packageManager: pnpm@10.12.1`.
It does not enforce an exact Node binary, Bun binary, Python binary, or uv binary in
CI/container metadata; the pnpm lock pins package resolution but cannot pin those
executables. Root `turbo ^2.5.0` resolves 2.10.12. TypeScript resolves 5.7.2 for web
and db, and 5.9.3 for server and shared; web declares an exact `5.7.2`, while the
others declare `^5.7.0`. Server Nest `^11.0.0` resolves core 11.2.3 (along with its
common/platform packages). The dataplane requires Python `>=3.12`; `pyproject.toml`
ranges and `uv.lock` resolve Pydantic
2.13.5, defusedxml 0.7.1, httpx 0.28.1, psycopg 3.3.4, pytest 9.1.1,
Ruff 0.16.5, and Pyright 1.1.411.

The root `test` script runs Bun without a repository declaration or lock entry for
the Bun executable. The present lockfiles also do not establish a deployment runtime
image digest. These are separate from ordinary dependency lockfile pinning.

## Decision table

| Item | Repository declaration / resolved state | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Node.js | `>=24`; no exact runtime binary pin | [Node release policy](https://nodejs.org/en/about/previous-releases) | Required before production | Use a supported LTS image/version; review when a CI or production image is introduced, when Node 24 leaves LTS, or when `engines` changes. |
| TypeScript | web/db resolve 5.7.2; server/shared resolve 5.9.3; web declares `5.7.2`, server/db/shared `^5.7.0` | [TypeScript 5.7 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html), [TypeScript 5.9 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) | Adopted | The lock presently has two resolved minors; review on a compiler-major proposal, a strict build failure, or a decision to converge them. |
| pnpm | `packageManager` exact `10.12.1`, `engines >=10`; frozen `pnpm-lock.yaml` | [pnpm package manager field](https://pnpm.io/package_json#packagemanager) | Adopted | It is the single JavaScript package manager; review if a frozen install differs from the committed lock. |
| Turborepo | root dev range `^2.5.0`; `pnpm-lock.yaml` resolves 2.10.12 | [Turborepo releases](https://github.com/vercel/turborepo/releases) | Adopted | It coordinates workspace tasks; review on a task-cache correctness failure or a major upgrade. |
| Bun | invoked by root test and db tests; no manifest/lock executable pin | [Bun releases](https://github.com/oven-sh/bun/releases) | Required before production | Pin the CI test runner and verify its supported Node/TypeScript behavior before a release pipeline runs it. |
| Next.js | web exact `16.2.12`; pnpm lock resolution | [Next.js releases](https://github.com/vercel/next.js/releases) | Adopted | Web deployable uses it; review for a security advisory affecting the resolved version or an App Router major migration. |
| NestJS | server range `^11.0.0`; `@nestjs/core` resolves 11.2.3 | [Nest 11.2.3 release](https://github.com/nestjs/nest/releases/tag/v11.2.3) | Adopted | Server modular-monolith framework from ADR 0008; review when bounded server modules are introduced or a Nest major is proposed. |
| Python | dataplane `requires-python >=3.12`; no exact interpreter pin | [Python status](https://devguide.python.org/versions/) | Required before production | Select and test one supported CPython image; review when that minor reaches security-only/EOL or a base image changes. |
| uv | `uv.lock` format is committed but no tool version declaration | [uv releases](https://github.com/astral-sh/uv/releases) | Required before production | Pin the resolver executable in CI/image metadata; review whenever it rewrites the lockfile or changes lock format. |
| Pydantic | `>=2.11,<3`; `uv.lock` 2.13.5 | [Pydantic releases](https://github.com/pydantic/pydantic/releases) | Adopted | Dataplane normalization contract; review before any 3.x proposal or a validator/JSON Schema compatibility failure. |
| defusedxml | `>=0.7.1,<1`; `uv.lock` 0.7.1 (stable) | [Python XML security guidance](https://docs.python.org/3.12/library/xml.html#xml-vulnerabilities), [defusedxml 0.7.1 release](https://pypi.org/project/defusedxml/0.7.1/) | Adopted | Python recommends defusedxml for server code parsing untrusted XML. The eaT boundary forbids DTDs, entities, and external references and tests each class. Review on the next stable major release, a security advisory, or a parser-behavior change; prereleases alone do not change the pin. |
| httpx | `>=0.28,<1`; `uv.lock` 0.28.1 | [httpx releases](https://github.com/encode/httpx/releases) | Adopted | Source HTTP client; review for a transport/TLS advisory or retry/capture semantics change. |
| pytest | `>=8.4,<10`; `uv.lock` 9.1.1 | [pytest releases](https://github.com/pytest-dev/pytest/releases) | Adopted | Dataplane test runner; review before 10.x or plugin incompatibility. |
| Ruff | `>=0.12,<1`; `uv.lock` 0.16.5 | [Ruff releases](https://github.com/astral-sh/ruff/releases) | Adopted | Dataplane lint gate; review before 1.x or a rule-set change that alters CI output. |
| Pyright | `>=1.1.400,<2`; `uv.lock` 1.1.411 | [Pyright releases](https://github.com/microsoft/pyright/releases) | Adopted | Dataplane static checking; review before 2.x or when a type-check failure follows a Python/Pydantic change. |

## Rejected or deferred

No second JavaScript package manager, Volta, or mise is introduced by this audit.
Their installation would be a separate reproducible-runtime decision, not evidence
that the current lockfiles pin Node, Bun, Python, or uv. Package ranges remain where
they already exist; changing them is out of scope for this documentation-only change.

## Review triggers

Run a frozen install and the applicable build/test chain whenever `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `pyproject.toml`, or `uv.lock` changes.
Open an ADR before selecting a runtime image pin or adding a package manager. Treat a
security advisory for a resolved version, an upstream EOL notice, or a reproducibility
failure between CI and container execution as an immediate review trigger.
