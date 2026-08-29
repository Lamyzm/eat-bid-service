# Product Secret contract

This target composition declares only Secret names and keys. Values are never stored in
this repository. The environment owner injects and rotates each Secret before an explicit
product cutover; Argo CD and Argo Workflows only consume them.

| Secret | Required keys | Owner / injector | Consumers |
|---|---|---|---|
| `eatbid-database` | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | database operator / environment bootstrap | PostgreSQL, server, migration, dataplane |
| `eatbid-r2` | `R2_ENDPOINT_URL`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | storage operator / environment bootstrap | dataplane |
| `eatbid-auth` | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | product operator / environment bootstrap | server |
| `eatbid-share` | `EATBID_SHARE_SECRET` | product operator / environment bootstrap | server |
| `cloudflared-creds` | `credentials.json` | network operator / environment bootstrap | cloudflared |
| `ghcr-pull` | `.dockerconfigjson` | delivery operator / environment bootstrap | namespace default and dataplane ServiceAccounts |

Secret readiness, access scope, and connectivity must be verified before the dormant
product composition is wired to the live Argo CD Application or any schedule is resumed.
