# Product Secret contract

This target composition declares only Secret names and keys. Values are never stored in
this repository. The environment owner injects and rotates each Secret before an explicit
product cutover; Argo CD and Argo Workflows only consume them.

| Secret | Required keys | Owner / injector | Consumers |
|---|---|---|---|
| `eatbid-postgres-bootstrap` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | database operator / environment bootstrap | PostgreSQL bootstrap container, `eatbid-db-provisioning` hook Job |
| `eatbid-database-migrator` | `DATABASE_URL` (owner-scoped migrator role) | database operator / environment bootstrap | Sync migration job, `eatbid-db-backup` CronWorkflow의 `pg_dump`(모든 schema 읽기가 필요해 소유자 역할을 빌린다. 백업 전용 읽기 역할은 후속) |
| `eatbid-database-api` | `DATABASE_URL` (non-owner API role) | database operator / environment bootstrap | Nest server only |
| `eatbid-database-dataplane` | `DATABASE_URL` (`eatbid_dataplane` role; `ingest`/`core` 쓰기), `EATBID_CACHE_REVALIDATE_TOKEN` | database operator / environment bootstrap | dataplane WorkflowTemplate only |
| `eatbid-cache-revalidate` | `EATBID_CACHE_REVALIDATE_TOKEN` | product operator / environment bootstrap | web (`POST /internal/cache/revalidate`) |
| `eatbid-r2` | `R2_ENDPOINT_URL`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | storage operator / environment bootstrap | dataplane, `eatbid-db-backup` CronWorkflow(`backup/postgres/` prefix에 쓰기) |
| `eatbid-auth` | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | product operator / environment bootstrap | server |
| `eatbid-alerting` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HEARTBEAT_URL` | product operator / Infisical `/runtime/alerting` | `eatbid-expectation-check` CronWorkflow. 봇 토큰은 환경 사이 공유, 대상 방과 심장박동 URL은 환경별로 다르다. `HEARTBEAT_URL`은 클러스터 밖 dead man's switch의 핑 주소이며 경로에 토큰이 들어 있어 값 자체가 자격이다(EAT-171) |
| `cloudflared-creds` | `credentials.json` | network operator / environment bootstrap | cloudflared |
| `ghcr-pull` | `.dockerconfigjson` | delivery operator / environment bootstrap | namespace default and dataplane ServiceAccounts |

Secret readiness, access scope, and connectivity must be verified before the dormant
product composition is wired to the live Argo CD Application or any schedule is resumed.

## 캐시 무효화 토큰의 두 경로와 회전

`EATBID_CACHE_REVALIDATE_TOKEN`은 부르는 쪽(dataplane)과 받는 쪽(web)이 같은 값을 봐야 하는
유일한 비밀이다. Infisical `prod:/runtime/web`과 `prod:/runtime/dataplane` 두 경로에 같은 이름으로
같은 값을 둔다. web은 새 InfisicalSecret `eatbid-cache-revalidate`가, dataplane은 이미
`/runtime/dataplane` 전체를 당겨 오는 `eatbid-database-dataplane`이 실어 온다.

회전은 두 경로를 함께 바꾼다. 한쪽만 바꾸면 무효화가 401로 실패하지만 발행·빌드는 계속 성공하고
화면만 `cacheLife` 상한(최대 1시간) 안에서 늙는다 — 조용한 실패라 로그에서 먼저 드러난다
(`event: "cache-revalidate-failed"`). 토큰이 유출됐을 때 가능한 행위는 캐시를 비우는 것뿐이며
데이터 노출도 쓰기도 아니다(ADR 0036).

## 역할 provisioning의 소유자와 순서

권한의 진실 원천은 `infra/product/db-provisioning.sql` 하나이며, `eatbid-db-provisioning` hook Job이
매 sync마다 sync-wave 2에서 실행한다(0 postgres·Secret·ConfigMap → 1 migration → 2 provisioning →
3 server·web). 서버 readiness 계약과 통합 테스트가 같은 파일을 읽으므로 psql로 손수 넣은 GRANT는
다음 sync에 이 파일의 상태로 되돌아간다. 권한을 바꾸려면 이 파일을 바꿔라.

역할 자체와 비밀번호 생성은 사람 단계다. 저장소 파일이 비밀번호를 알 수 없으므로 SQL은 역할이
이미 있다고 전제하고 없으면 `RAISE EXCEPTION`으로 멈춘다. 빈 클러스터나 새 데이터베이스에서는
Argo CD를 연결하기 전에 superuser로 다음을 한 번 수행한다.

1. Infisical `prod:/runtime/migrator`·`/runtime/server`·`/runtime/dataplane`의 `DATABASE_URL`에
   담긴 비밀번호를 정한다. 값은 저장소에 들어가지 않는다.
2. superuser(`prod:/runtime/postgres`의 `POSTGRES_USER`)로 접속해 세 역할을 만든다.
   `CREATE ROLE eatbid_migrator LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;`
   를 `eatbid_api`, `eatbid_dataplane`까지 세 번 반복한다. 역할 이름은 SQL이 고정하고 있으므로
   바꾸지 않는다.
3. Argo CD를 sync한다. migration이 schema를 세우고 provisioning Job이 권한을 세운다.

`eatbid_api`가 얻는 정확한 권한과 금지 항목은 아래 절이 계속 권위를 가지며,
`apps/server/src/platform/database/database-readiness.ts`가 런타임에 같은 계약을 강제한다.

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
are protected-table writes and every non-`SELECT` migration-journal privilege. These denials
apply to effective table and column ACLs, including grants inherited from `PUBLIC` or any role;
provisioning must not use a column grant to bypass the table policy. The role owns no relevant
database, relation, sequence, view, routine, or type.

The current `app` keys are PostgreSQL 16 `GENERATED ALWAYS AS IDENTITY`: inserting default
identity values needs no sequence ACL. Provisioning therefore grants the API role none of
`USAGE`, `SELECT`, or `UPDATE` on any sequence; direct `nextval`, sequence reads, and `setval`
remain denied. The migrator is the only runtime consumer permitted to apply committed Drizzle
migrations. No Secret value is committed.

`eatbid_dataplane`은 수집 workload가 실제로 만지는 `ingest`·`core`에 대해서만 `USAGE`와 테이블
CRUD, 시퀀스 `USAGE`/`SELECT`/`UPDATE`를 받고 `drizzle`은 읽기만 받는다. `mart`와 `app`은 이
workload가 접근하지 않으므로 부여하지 않는다. 두 grantor(`eatbid_migrator`와 database 소유자)에
대해 `ALTER DEFAULT PRIVILEGES`를 걸어 두므로 다음 migration이 만든 표나 덤프 복원이 만든 표에도
같은 권한이 따라붙는다.

## 감시 알림 대상의 환경 분리

`eatbid-alerting`의 `TELEGRAM_BOT_TOKEN`은 환경 사이에 같은 값이고 `TELEGRAM_CHAT_ID`만 다르다. 봇을 둘로
나누면 토큰이 둘이 되고 회전을 두 번 해야 하는데, 얻는 것이 없다. 방을 나누는 이유는 다르다. dev의 잦은 배포
잡음이 운영 사고와 같은 자리에 오면 진짜 사고가 묻힌다(ADR 0046 결정 6).

이 토큰이 유출돼도 할 수 있는 일은 그 방에 글을 쓰는 것뿐이다. 클러스터나 DB에 닿지 않는다. 그래서 회전
절차는 다른 비밀보다 가볍다. 텔레그램에서 토큰을 재발급하고 `prod:/runtime/alerting`과
`dev:/runtime/alerting` 두 경로의 `TELEGRAM_BOT_TOKEN`을 바꾸면 끝이다. 방 번호는 그대로 둔다.

봇이 방 번호를 얻으려면 그 방에서 봇에게 닿는 메시지가 한 번은 있어야 한다. 봇의 개인정보 모드가 켜져 있으면
일반 대화는 봇에게 가지 않으므로 `/start@<봇>`처럼 명령으로 보낸다. 개인정보 모드는 켠 채로 둔다. 감시는
보내기만 하고 읽을 이유가 없다.
