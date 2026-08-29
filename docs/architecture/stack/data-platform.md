# Data platform audit

Research was checked on 2026-08-29. This audit preserves the authority chain in
ADR 0004 rather than adding a second canonical store or DDL owner.

## Current baseline

PostgreSQL 16 is the selected canonical relational store in the target architecture.
Task 2 established one pnpm catalog release lane: exact `drizzle-orm` and
`drizzle-kit` `1.0.0-rc.4`, consumed by the DB, shared, and server manifests through
`catalog:` and resolved in `pnpm-lock.yaml`. It retained the existing migrations with
a no-change generation probe; the RC is deliberately not called GA. Server declares
`postgres ^3.4.5`; dataplane declares `psycopg[binary] >=3.2,<4` and resolves 3.3.4.
Pydantic 2 is the Python normalization contract. Dataplane declares `boto3 >=1.40,<2`
and resolves 1.43.83 for R2's S3-compatible API.

Authority is `R2 raw` (immutable evidence) to PostgreSQL `ingest` (run/observation/
quarantine) to PostgreSQL `core` (validated canonical facts), with `app`
(user-authored state) and `mart` (versioned, reproducible analytics) downstream.

## Decision table

| Tool or platform | Concrete Eatbid use | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| PostgreSQL 16 | Transactional `ingest`, `core`, `app`, and `mart` authority | [PostgreSQL 16 release notes](https://www.postgresql.org/docs/16/release-16.html) | Adopted | ADRs 0004/0005 select it; review on observed query/retention limits or a supported-major upgrade proposal. |
| Drizzle v1 RC4 | Only `packages/db` authors DDL and generated, committed SQL migrations | [RC4 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4), [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) | Adopted | Task 2 chose the no-op compatible RC lane; review only through ADR 0013's GA gate. |
| postgres-js | Server-side TypeScript PostgreSQL driver | [postgres.js releases](https://github.com/porsager/postgres/releases) | Adopted | It is declared by server; review for a driver security advisory or server repository extraction. |
| psycopg 3 | Dataplane PostgreSQL access | [psycopg releases](https://github.com/psycopg/psycopg/releases) | Adopted | It is the resolved Python driver; review when pool/retry semantics are implemented or an advisory affects 3.3.4. |
| Pydantic contracts | Source capture/normalization validation in Python | [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/) | Adopted | Keep it language-local; review when a normalized record schema changes. |
| Cloudflare R2 S3 API | Immutable content-addressed raw evidence | [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/) | Adopted | Review on retention, object lock, or API-compatibility requirement changes. |
| boto3 | Dataplane R2 S3 client | [Boto3 S3 documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html) | Adopted | It is the declared/resolved client; review for an S3 API feature or security update. |
| Flyway/Liquibase | Additional migration system | [Flyway documentation](https://documentation.red-gate.com/flyway), [Liquibase documentation](https://docs.liquibase.com/) | Rejected for foundation | Drizzle is the sole DDL owner and an additional migration history would violate ADR 0009; reconsider only after a replacement-ownership ADR. |
| Prisma | Alternative ORM/schema authority | [Prisma ORM documentation](https://www.prisma.io/docs/orm) | Rejected for foundation | It would create another schema/DDL authority beside focused Drizzle modules; trigger only with an ADR replacing Drizzle. |
| dbt | Downstream analytical transforms | [dbt documentation](https://docs.getdbt.com/docs/introduction) | Deferred | PostgreSQL mart is sufficient now; reconsider after measured multi-team SQL-transform lineage needs. |
| Great Expectations | Dataset assertion suite | [Great Expectations documentation](https://docs.greatexpectations.io/) | Deferred | Exact `TOT_CNT` and invariants belong in dataplane tests/gates first; reconsider if many independently managed expectation suites emerge. |
| Kafka | Durable event backbone | [Apache Kafka documentation](https://kafka.apache.org/documentation/) | Rejected for foundation | The single workflow/replay path and PostgreSQL publication do not need stream fan-out; reconsider for measured independent consumers/throughput. |
| Airflow | Alternate scheduler/orchestrator | [Airflow documentation](https://airflow.apache.org/docs/) | Rejected for foundation | Argo Workflows owns poll/reconcile/backfill/replay under ADR 0007; duplicate scheduling would split recovery paths. |
| Dagster | Alternate orchestrator/assets platform | [Dagster documentation](https://docs.dagster.io/) | Rejected for foundation | It duplicates Argo Workflows at the present Kubernetes task scale; reconsider only with an ADR and workload evidence. |

## Rejected or deferred

No canonical Parquet lake, second migration tool, stream platform, or second scheduler
is added. dbt and Great Expectations are deferred because their value depends on
measured transform ownership and assertion-suite scale, not generic tool popularity.

## Review triggers

Before any Drizzle lane change, execute ADR 0013's frozen-install, single-lane,
migration, empty-PostgreSQL, and workspace verification gates. Add property tests in
the owning foundation tasks for leading-zero codes, deterministic gzip/normalization/
replay, and exact completeness counts. Revisit deferred platforms only with observed
workload data and an ADR that preserves raw/ingest/core/app/mart authority.
