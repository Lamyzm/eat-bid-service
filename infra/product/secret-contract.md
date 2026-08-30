# Product Secret contract

This target composition declares only Secret names and keys. Values are never stored in
this repository. The environment owner injects and rotates each Secret before an explicit
product cutover; Argo CD and Argo Workflows only consume them.

| Secret | Required keys | Owner / injector | Consumers |
|---|---|---|---|
| `eatbid-postgres-bootstrap` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | database operator / environment bootstrap | PostgreSQL bootstrap container only |
| `eatbid-database-migrator` | `DATABASE_URL` (owner-scoped migrator role) | database operator / environment bootstrap | PreSync migration job only |
| `eatbid-database-api` | `DATABASE_URL` (non-owner API role) | database operator / environment bootstrap | Nest server only |
| `eatbid-database-dataplane` | `DATABASE_URL` (dormant; split into narrower roles before activation) | database operator / environment bootstrap | dormant dataplane WorkflowTemplate only |
| `eatbid-r2` | `R2_ENDPOINT_URL`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | storage operator / environment bootstrap | dataplane |
| `eatbid-auth` | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | product operator / environment bootstrap | server |
| `eatbid-share` | `EATBID_SHARE_SECRET` | product operator / environment bootstrap | server |
| `cloudflared-creds` | `credentials.json` | network operator / environment bootstrap | cloudflared |
| `ghcr-pull` | `.dockerconfigjson` | delivery operator / environment bootstrap | namespace default and dataplane ServiceAccounts |

Secret readiness, access scope, and connectivity must be verified before the dormant
product composition is wired to the live Argo CD Application or any schedule is resumed.

The API role may read `core`/`mart` and read/write only application-owned `app` tables. It
must not own the database or schemas, create roles/databases/objects, write `core`/`mart`,
access `ingest`, or modify `drizzle.__drizzle_migrations`. The migrator is the only runtime
consumer permitted to apply committed Drizzle migrations. No Secret value is committed.
