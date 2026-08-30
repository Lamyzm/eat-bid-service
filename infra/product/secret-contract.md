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
must be `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
have no direct or transitive role memberships, and receive only `CONNECT` at database scope.
Because PostgreSQL grants `TEMPORARY` to `PUBLIC` by default, provisioning must revoke it from
`PUBLIC`; the API role must have neither `TEMPORARY` nor `CREATE` on the database.

At schema/object scope it receives `USAGE` on `core`, `mart`, `app`, and `drizzle`; `SELECT`
on every `core`/`mart` table; `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on every module-owned
`app` table; and `SELECT` only on `drizzle.__drizzle_migrations`. It receives no `ingest`
access, no table privilege in `public`, and no `CREATE` on `core`, `mart`, `app`, `ingest`,
`drizzle`, or `public`. `TRUNCATE`, `REFERENCES`, and `TRIGGER` are forbidden everywhere, as
are protected-table writes and every non-`SELECT` migration-journal privilege. The role owns
no relevant database, relation, sequence, view, routine, or type.

The current `app` keys are PostgreSQL 16 `GENERATED ALWAYS AS IDENTITY`: inserting default
identity values needs no sequence ACL. Provisioning therefore grants the API role none of
`USAGE`, `SELECT`, or `UPDATE` on any sequence; direct `nextval`, sequence reads, and `setval`
remain denied. The migrator is the only runtime consumer permitted to apply committed Drizzle
migrations. No Secret value is committed.
