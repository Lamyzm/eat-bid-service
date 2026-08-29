# eatbid Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 source fixture를 archive-before-parse로 R2 호환 저장소에 보존하고, 실행 완전성을 검증해 새 PostgreSQL `core`의 Organization/AuctionAttempt revision으로 원자 발행한 뒤 동일 raw를 결정적으로 replay하는 첫 수직 슬라이스를 만든다.

**Architecture:** `apps/dataplane`의 단일 Python CLI가 discover/capture/normalize/validate/project/replay 단계를 제공하고, `packages/db`의 Drizzle migration만 `ingest/core/app/mart` DDL을 소유한다. Argo Workflows가 같은 CLI를 정기·백필·재처리 모드로 실행하며 Argo CD는 controller와 WorkflowTemplate만 배포한다.

**Tech Stack:** Node.js 24+ (server target 24.20.0 LTS), pnpm 10.12.1, Turborepo 2.5,
TypeScript 5.7+, NestJS 12 target, `effect@4.0.0-rc.112` compatibility lane, Zod 4/Standard Schema,
Drizzle ORM/Kit 1.0.0-rc.4, Python 3.12+, uv, Pydantic 2, psycopg 3, httpx, boto3, pytest,
Ruff, Pyright, PostgreSQL 16, R2 S3 API, Argo Workflows 4.0.8 via argo-workflows Helm chart
1.0.23, Argo CD.

**Spec:** `docs/superpowers/specs/2026-08-29-eatbid-greenfield-architecture-design.md`

## Global Constraints

- 원본 response body를 object storage에 성공적으로 기록하기 전에 parse하거나 `core`를 변경하지 않는다.
- 외부 식별자는 `(source_system, code_scheme, code text)`로만 유일하고 내부 PK/FK는 bigint다.
- eaT 공고지역, eaT 참가제한지역, 행정안전부 행정구역, NEIS 학교 코드를 직접 비교하지 않는다.
- `R2 raw`, PostgreSQL `core`, PostgreSQL `app`, PostgreSQL `mart`의 소유권을 섞지 않는다.
- `TOT_CNT` 불일치, 미지원 code, schema drift, parser failure가 있는 run은 publication을 활성화하지 않는다.
- DDL 작성자는 `packages/db` Drizzle schema 하나다. 운영 `db:push`와 수기 `schema.sql`을 추가하지 않는다.
- scheduler는 Argo Workflows 하나다. 새 Kubernetes CronJob이나 애플리케이션 scheduler를 추가하지 않는다.
- 추천 투찰가, 예정가 예측, 자동 NeaT 제출 기능을 추가하지 않는다.
- 기존 raw/source fixture/검증된 source identifier는 보존하고 이름 기반 legacy identity는 이관하지 않는다.
- 기존 작업 디렉터리가 dirty이므로 실행 시작 시 `superpowers:using-git-worktrees`로 별도 worktree를 만든다.

---

## Program Decomposition

전체 설계는 독립적으로 검토 가능한 여섯 하위 프로그램으로 나눈다.

1. **Data foundation — 이 계획:** monorepo dataplane, DDL ownership, raw observation, minimal canonical publication, replay, Argo 실행.
2. **Canonical domain expansion:** submission/award/auction relation, 전체 기관·업체·코드 mapping, backfill coverage.
3. **Server and intelligence:** NestJS 모듈 분해, ID 기반 API, versioned mart와 분석 query.
4. **Workspace product:** 다사업자 BidWorkItem, 권한, 사용자 기록/NeaT 확인/source reconciliation, Web 전환.
5. **Production hardening:** SOPS+age secret, DB role, backup/restore drill, freshness/완전성 관측.
6. **Cutover and retirement:** shadow 대조, 사용자 상태 dry-run 이관, read/write cutover, CronJob/Parquet/legacy schema 제거.

각 후속 프로그램은 앞 단계의 실제 schema와 성능 측정치를 입력으로 별도 구현 계획을 작성한다.
이 계획은 1번을 완성해 raw 한 건이 검증된 canonical revision까지 흐르는 작동 소프트웨어를 낸다.

## Target File Map

| 경로 | 책임 |
|---|---|
| `apps/dataplane/pyproject.toml` | Python 의존성, `eatbid` CLI, Ruff/Pyright/pytest 설정 |
| `apps/dataplane/src/eatbid/cli.py` | 여섯 command의 composition root와 typed exit mapping |
| `apps/dataplane/src/eatbid/object_store.py` | raw object store port와 content-addressed key 규칙 |
| `apps/dataplane/src/eatbid/r2_store.py` | R2 S3 adapter |
| `apps/dataplane/src/eatbid/ingest/*_repository.py` | focused run/observation/normalization/publication/replay ports와 psycopg adapters |
| `apps/dataplane/src/eatbid/core/` | canonical projection records, port, psycopg adapter |
| `apps/dataplane/src/eatbid/source/eat/` | eaT transport, Pydantic payload, normalize adapter |
| `apps/dataplane/src/eatbid/pipeline/` | capture/validate/project/replay use cases |
| `apps/dataplane/tests/unit/` | network/DB 없는 결정적 단위 테스트 |
| `apps/dataplane/tests/integration/` | migration을 적용한 PostgreSQL 통합 테스트 |
| `apps/dataplane/tests/fixtures/eat/` | 민감정보를 제거한 실제 payload fixture |
| `packages/db/src/schema/` | `ingest/core/app/mart` Drizzle DDL source |
| `packages/db/drizzle/` | 리뷰·커밋된 generated SQL migration directory와 snapshot |
| `packages/db/src/migrate.ts` | migration CLI와 schema version 확인 |
| `infra/platform/argo-workflows.application.yaml` | Argo Workflows controller/CRD Helm application |
| `infra/product/workflows/` | WorkflowTemplate, semaphore, service account, schedules |
| `.github/workflows/build.yml` | TS/Python test, migration check, web/server/dataplane/migration 네 image build와 digest 갱신 |

---

### Task 1: Dataplane workspace와 CLI 계약

**Files:**
- Create: `apps/dataplane/pyproject.toml`
- Create: `apps/dataplane/src/eatbid/__init__.py`
- Create: `apps/dataplane/src/eatbid/cli.py`
- Create: `apps/dataplane/tests/unit/test_cli.py`
- Create: `apps/dataplane/Dockerfile`
- Create: `apps/dataplane/uv.lock`
- Modify: `package.json`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: 없음.
- Produces: `eatbid.cli.build_parser() -> argparse.ArgumentParser`, `eatbid.cli.main(argv: Sequence[str] | None = None) -> int`, console script `eatbid`.

- [ ] **Step 1: CLI 계약의 실패 테스트 작성**

```python
# apps/dataplane/tests/unit/test_cli.py
from eatbid.cli import build_parser


def test_cli_exposes_pipeline_commands() -> None:
    parser = build_parser()
    action = next(a for a in parser._actions if a.dest == "command")
    assert set(action.choices) == {
        "discover", "capture", "normalize", "validate", "project", "replay"
    }
```

- [ ] **Step 2: 테스트가 import failure로 실패하는지 확인**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_cli.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'eatbid'`.

- [ ] **Step 3: Python package와 여섯 command parser 구현**

`pyproject.toml`에는 Python `>=3.12`, runtime dependency `pydantic>=2.11,<3`,
`pydantic-settings>=2.10,<3`, `psycopg[binary]>=3.2,<4`, `httpx>=0.28,<1`,
`boto3>=1.40,<2`, dev dependency `pytest>=8.4,<10`, `pytest-cov>=6,<8`,
`pyyaml>=6,<7`, `ruff>=0.12,<1`, `pyright>=1.1.400,<2`와 아래 entry point를 둔다.

```toml
[project.scripts]
eatbid = "eatbid.cli:main"
```

`cli.py`의 parser는 모든 subcommand에 `--run-id`, `--build-sha`, `--parser-version`을 받고
아직 wiring되지 않은 command는 parser 생성만 하며 실행 시 `CONFIGURATION` exit code 64를 반환한다.

```python
COMMANDS = ("discover", "capture", "normalize", "validate", "project", "replay")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eatbid")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        command = sub.add_parser(name)
        command.add_argument("--run-id", required=True)
        command.add_argument("--build-sha", required=True)
        command.add_argument("--parser-version", required=True)
    return parser
```

- [ ] **Step 4: lockfile과 root task 생성**

Run: `cd apps/dataplane && uv lock`

Root scripts에 `dataplane:test`, `dataplane:lint`, `dataplane:typecheck`를 추가하고 Turbo task가
각 명령을 cache 없이 실행하도록 구성한다. Dockerfile은 lockfile 기반 `uv sync --frozen --no-dev`를
사용하고 `ENTRYPOINT ["uv", "run", "eatbid"]`로 끝낸다.

- [ ] **Step 5: CLI와 정적 검사 통과 확인**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_cli.py -q && uv run ruff check src tests && uv run pyright src`

Expected: test 1개 PASS, Ruff/Pyright exit 0.

- [ ] **Step 6: 커밋**

```bash
git add apps/dataplane package.json turbo.json
git commit -m "build: add monorepo dataplane workspace"
```

---

### Task 2: Drizzle DB package와 namespace 소유권

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/namespaces.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/schema/namespaces.test.ts`
- Create: `packages/db/src/index.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: root pnpm/Turbo workspace.
- Produces: `ingestSchema`, `coreSchema`, `appSchema`, `martSchema` and package export `@eatbid/db/schema`.

- [ ] **Step 1: namespace export 실패 테스트 작성**

```typescript
import { describe, expect, test } from "bun:test";
import { appSchema, coreSchema, ingestSchema, martSchema } from "./namespaces";

describe("database namespaces", () => {
  test("uses one schema per authority owner", () => {
    expect(ingestSchema.schemaName).toBe("ingest");
    expect(coreSchema.schemaName).toBe("core");
    expect(appSchema.schemaName).toBe("app");
    expect(martSchema.schemaName).toBe("mart");
  });
});
```

- [ ] **Step 2: package가 없어서 실패하는지 확인**

Run: `bun test packages/db/src/schema/namespaces.test.ts`

Expected: FAIL with module resolution error for `./namespaces`.

- [ ] **Step 3: package와 namespace 구현**

```typescript
import { pgSchema } from "drizzle-orm/pg-core";

export const ingestSchema = pgSchema("ingest");
export const coreSchema = pgSchema("core");
export const appSchema = pgSchema("app");
export const martSchema = pgSchema("mart");
```

Package scripts는 `build`, `test`, `db:generate`, `db:migrate`, `db:check`만 제공한다.
Drizzle config는 `./src/schema/index.ts`를 읽고 migration을 `./drizzle`에 생성한다.

- [ ] **Step 4: export와 package build 확인**

Run: `pnpm --filter @eatbid/db build && bun test packages/db/src/schema/namespaces.test.ts`

Expected: build exit 0, test 1개 PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/db pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build: establish database schema ownership"
```

---

### Task 3: ingest run·raw observation·publication schema

**Files:**
- Create: `packages/db/src/schema/ingest.ts`
- Create: `packages/db/src/schema/ingest.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/20260829000000_ingest_foundation/migration.sql`
- Create: `packages/db/drizzle/20260829000000_ingest_foundation/snapshot.json`

**Interfaces:**
- Consumes: `ingestSchema` from Task 2.
- Produces: `ingestRun`, `requestUnit`, `rawBlob`, `rawObservation`, `normalizedRecord`, `publication` Drizzle tables.

- [ ] **Step 1: 테이블 grain과 unique constraint 실패 테스트 작성**

```typescript
import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { rawBlob, rawObservation } from "./ingest";

describe("ingest identity", () => {
  test("deduplicates blobs but never observations", () => {
    const blob = getTableConfig(rawBlob);
    const observation = getTableConfig(rawObservation);
    expect(blob.columns.find((c) => c.name === "content_sha256")?.primary).toBe(true);
    expect(observation.columns.find((c) => c.name === "observation_id")?.primary).toBe(true);
  });
});
```

- [ ] **Step 2: 테이블 미구현 실패 확인**

Run: `bun test packages/db/src/schema/ingest.test.ts`

Expected: FAIL because `./ingest` does not exist.

- [ ] **Step 3: 아래 exact grain으로 ingest tables 구현**

| Table | PK | Required columns and constraints |
|---|---|---|
| `ingest.run` | `run_id uuid` | mode, status, build_sha, parser_version, started_at, ended_at, failure_category, expected_count, captured_count, published_count |
| `ingest.request_unit` | `request_unit_id bigint identity` | run FK, source, endpoint, request_params jsonb, expected_count, observed_count, status; unique(run_id, source, endpoint, request_params_hash) |
| `ingest.raw_blob` | `content_sha256 char(64)` | object_key unique, byte_length, content_type, content_encoding, stored_at |
| `ingest.raw_observation` | `observation_id bigint identity` | run/request FK, source, endpoint, request_params jsonb, fetched_at, http_status, blob hash FK, source_entity_id, schema_fingerprint, parser_status, quarantine_reason |
| `ingest.normalized_record` | `normalized_record_id bigint identity` | observation FK, record_type, source_entity_id, normalized_payload jsonb, parser_version, normalized_at; unique(observation_id, record_type, source_entity_id, parser_version) |
| `ingest.publication` | `publication_id uuid` | run FK unique, status, validated_at, activated_at, expected_count, normalized_count, published_count |

모든 timestamp는 `timestamp with time zone`, count는 음수가 될 수 없도록 check constraint를 둔다.
`run.status`는 `planned|running|failed|validated|published`, parser status는
`pending|normalized|quarantined` enum으로 제한한다.

- [ ] **Step 4: generated migration 생성 후 수기 SQL이 없는지 검토**

Run: `pnpm --filter @eatbid/db db:generate`

Expected: migration에 `CREATE SCHEMA "ingest"`와 여섯 table/unique/check/FK가 생성된다.
생성 directory 이름을 `20260829000000_ingest_foundation`으로 고정하고 `migration.sql`과
`snapshot.json`을 함께 커밋한다.

- [ ] **Step 5: schema test와 migration diff 검사**

Run: `bun test packages/db/src/schema/ingest.test.ts && git diff --check -- packages/db`

Expected: PASS and no whitespace errors.

- [ ] **Step 6: 커밋**

```bash
git add packages/db
git commit -m "feat: add immutable ingestion ledger schema"
```

---

### Task 4: 코드 registry와 최소 canonical 도메인

**Files:**
- Create: `packages/db/src/schema/core/codes.ts`
- Create: `packages/db/src/schema/core/organizations.ts`
- Create: `packages/db/src/schema/core/procurement.ts`
- Create: `packages/db/src/schema/core/index.ts`
- Create: `packages/db/src/schema/core/canonical.test.ts`
- Create: `packages/db/src/seeds/code-schemes.ts`
- Create: `packages/db/src/seeds/code-schemes.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/schema/layout.test.ts`
- Create: `packages/db/drizzle/20260829001000_core_identity/migration.sql`
- Create: `packages/db/drizzle/20260829001000_core_identity/snapshot.json`

**Interfaces:**
- Consumes: `coreSchema`, `rawObservation.observationId`.
- Produces: aggregate-split `core` exports, bigint domain IDs, and source-scoped external identifiers resolved through the `CodeValue` authority used by projector Task 9.

- [ ] **Step 1: 분리된 core layout와 문자열 identity가 거부되는 schema test 작성**

```typescript
import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { auctionAttempt, organization } from "./index";

describe("canonical identities", () => {
  test("uses generated bigint primary keys", () => {
    expect(getTableConfig(organization).columns.find((c) => c.name === "organization_id")?.primary).toBe(true);
    expect(getTableConfig(auctionAttempt).columns.find((c) => c.name === "auction_attempt_id")?.primary).toBe(true);
  });
});
```

기존 `layout.test.ts`도 `core/codes.ts`, `core/organizations.ts`,
`core/procurement.ts`, `core/index.ts`가 존재하고 root `schema/codes.ts`,
`schema/organizations.ts`, `schema/procurement.ts`가 존재하지 않음을 검증한다. root와
namespace의 `index.ts`는 table을 선언하지 않고 export만 조립한다.

- [ ] **Step 2: 새 exports가 없어 실패하는지 확인**

Run: `bun test packages/db/src/schema/core/canonical.test.ts packages/db/src/schema/layout.test.ts`

Expected: FAIL because the `core` aggregate modules and their exports do not exist.

- [ ] **Step 3: 코드 registry를 exact grain으로 구현**

| Table | Identity and required fields |
|---|---|
| `core.code_scheme` | bigint PK; namespace unique, owner, version_policy, valid_time_policy |
| `core.code_value` | bigint PK; scheme FK, code text, valid_from/to, active; unique(scheme_id, code) |
| `core.code_label_observation` | bigint PK; code value FK, label, language, observed_at, observation FK |
| `core.code_mapping` | bigint PK; from/to code value FK, relation, valid_from/to, evidence observation FK, status |

`builtinCodeSchemes`와 idempotent `seedCodeSchemes(db)`에는 namespace만 넣는다:
`eat:auction-location-sido`,
`eat:auction-location-sigungu`, `eat:eligibility-area`, `mois:administrative-region`, `neis:school`,
`eat:organization`, `eat:supplier-account`. code value와 mapping은 seed하지 않는다.

`codes.ts`는 registry aggregate 전체를 소유하고 `organizations.ts`와
`procurement.ts`는 `CodeValue`의 내부 bigint identity만 참조한다. scheme/code text를
도메인 table에 복제해 두 번째 authority를 만들지 않는다.

- [ ] **Step 4: 최소 canonical tables 구현**

| Table | Identity and required fields |
|---|---|
| `core.organization` | `organization_id bigint identity`; type, canonical_name, created_at |
| `core.organization_identifier` | bigint PK; organization FK, code value FK, observation FK; unique(code_value_id) |
| `core.auction_attempt` | `auction_attempt_id bigint identity`; source_system, external_bid_id, display_bid_no; unique(source_system, external_bid_id) |
| `core.auction_revision` | bigint PK; attempt FK, observation FK, content_sha256, source_status, title, announced/deadline/opened timestamps, base/planned amounts, currency, source_payload jsonb; unique(attempt_id, content_sha256) |
| `core.auction_organization` | attempt FK, organization FK, role; composite PK(attempt_id, organization_id, role) |

`source_payload`는 감사용 normalized snapshot이며 분석 결과를 담지 않는다. `canonical_name`과
`display_bid_no`에는 unique constraint를 두지 않는다.

- [ ] **Step 5: migration과 constraint 테스트 통과**

Run: `pnpm --filter @eatbid/db db:generate && bun test packages/db/src/schema/core/canonical.test.ts packages/db/src/schema/layout.test.ts packages/db/src/seeds/code-schemes.test.ts`

Expected: generated migration contains nine code/domain tables, bigint PKs, source-scoped unique keys,
and `organization_identifier.code_value_id` references the one code-value authority.

- [ ] **Step 6: 커밋**

```bash
git add packages/db
git commit -m "feat: add source-scoped canonical identity schema"
```

---

### Task 5: DDL 실행기와 운영 `db:push` 제거

**Files:**
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/migrate.test.ts`
- Create: `packages/db/src/version.ts`
- Create: `packages/db/src/version.test.ts`
- Create: `packages/db/src/ddl-authority.test.ts`
- Create: `packages/db/Dockerfile`
- Modify: `packages/db/package.json`
- Modify: `package.json`
- Modify: `packages/shared/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `infra/k8s/base/kustomization.yaml`
- Modify: `infra/k8s/base/app.yaml`

**Interfaces:**
- Consumes: committed migrations from Tasks 3–4 and `DATABASE_URL`.
- Produces: `migrate(): Promise<void>`, `assertSchemaVersion(db, expected): Promise<void>`, migration image.

- [ ] **Step 1: expected migration version 실패 테스트 작성**

```typescript
import { describe, expect, test } from "bun:test";
import { expectedMigration } from "./version";

describe("schema version", () => {
  test("is pinned to the committed foundation migration", () => {
    expect(expectedMigration).toBe("20260829001500_core_validity_constraints");
  });
});
```

- [ ] **Step 2: version export가 없어 실패하는지 확인**

Run: `bun test packages/db/src/version.test.ts`

Expected: FAIL because `./version` does not exist.

- [ ] **Step 3: migration/version 구현**

```typescript
export const expectedMigration = "20260829001500_core_validity_constraints" as const;
```

`migrate.ts`는 `postgres` client와 `drizzle-orm/postgres-js/migrator`의 `migrate`를 사용하고
`packages/db/drizzle`만 읽은 뒤 `seedCodeSchemes(db)`를 실행한다. 성공 시 적용된 migration ID를
출력하고 실패 시 nonzero exit한다. migration directory는 현재 작업 디렉터리가 아니라 module
위치에서 해소하고, `DATABASE_URL`이 없거나 PostgreSQL URL이 아니면 연결 전에 실패한다.
`assertSchemaVersion`은 Drizzle journal의 최신 `created_at`을 expected migration timestamp와
대조하며 뒤처진 DB뿐 아니라 코드보다 앞선 DB도 거부한다.

- [ ] **Step 4: 중복 DDL 경로 제거**

Root의 `db:generate`를 `@eatbid/db`로 전환하고 `db:migrate`를 노출하며 `db:push`를 제거한다.
`packages/shared`에서는 `db:generate`, `db:push`, `drizzle-kit`을 모두 제거해 DDL authoring
권한을 없앤다. 두 TypeScript 런타임이 쓰는 `postgres` version은 pnpm default catalog 한 곳에
두고 `packages/db`와 `apps/server`가 `catalog:`으로 소비한다. root test에는 `packages/db/src`를
포함해 schema/migration guard가 기본 CI에서 빠지지 않게 한다.

`infra/k8s/base/kustomization.yaml`의 `db-schema` ConfigMap generator와
`infra/k8s/base/app.yaml`의 legacy `postgres:16`/`schema.sql` PreSync migration Job 전체를 함께
제거한다. `schema.sql` 파일 자체의 삭제는 cutover plan까지 미루되 어떤 active manifest나
script에서도 참조되지 않게 한다. `ddl-authority.test.ts`가 manifest/package script를 검사해
이 상태와 `packages/db`의 sole owner를 고정한다.

- [ ] **Step 5: 빈 PostgreSQL에 migration chain 적용**

Run: `docker compose -f docker-compose.dev.yml up -d postgres && pnpm --filter @eatbid/db db:migrate && pnpm --filter @eatbid/db db:check && pnpm test && pnpm build`

Expected: `ingest`, `core`, `app`, `mart` schema와 15 canonical/ingest tables가 빈 PostgreSQL에
생성되고 version check와 DDL-authority guards가 exit 0. migration image는 committed
migration directory만 포함하며 non-root runtime으로 실행된다.

- [ ] **Step 6: 커밋**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps/server/package.json packages/shared/package.json packages/db infra/k8s/base
git commit -m "build: make committed migrations the only DDL path"
```

---

### Task 6: content-addressed raw object store

**Files:**
- Create: `apps/dataplane/src/eatbid/object_store.py`
- Create: `apps/dataplane/src/eatbid/r2_store.py`
- Create: `apps/dataplane/tests/unit/test_object_store.py`
- Create: `apps/dataplane/tests/unit/test_r2_store.py`
- Create: `apps/dataplane/tests/unit/fakes.py`
- Modify: `apps/dataplane/pyproject.toml`
- Modify: `apps/dataplane/uv.lock`
- Modify: `docs/architecture/stack/contracts-and-validation.md`

**Interfaces:**
- Consumes: raw `bytes`, validated source/endpoint slugs, and startup-validated R2 settings.
- Produces: `StoredRawObject(content_sha256: str, object_key: str, byte_length: int, stored_at: datetime)`, `RawObjectStore.put(...)`, and `RawObjectStore.read(object_key) -> bytes` for replay.

- [ ] **Step 1: content key와 deterministic gzip 실패 테스트 작성**

```python
from .fakes import MemoryRawObjectStore


def test_same_body_has_one_content_address() -> None:
    store = MemoryRawObjectStore()
    first = store.put(source="eat", endpoint="bid-list", body=b"<x>1</x>")
    second = store.put(source="eat", endpoint="bid-list", body=b"<x>1</x>")
    assert first.object_key == second.object_key
    assert first.object_key == (
        "raw/eat/bid-list/a4753d7f1f568904517dcd1a4051192fe968de97095123e29756b6d645e7d6cf.xml.gz"
    )
    assert store.read(first.object_key) == b"<x>1</x>"
```

- [ ] **Step 2: object store module이 없어 실패하는지 확인**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_object_store.py -q`

Expected: FAIL on import.

- [ ] **Step 3: port와 in-memory fake 구현**

```python
from datetime import UTC, datetime
from hashlib import sha256

from eatbid.object_store import StoredRawObject


class MemoryRawObjectStore:
    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}

    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject:
        digest = sha256(body).hexdigest()
        key = f"raw/{source}/{endpoint}/{digest}.xml.gz"
        self._objects.setdefault(key, body)
        return StoredRawObject(digest, key, len(body), datetime.now(UTC))

    def read(self, object_key: str) -> bytes:
        return self._objects[object_key]
```

```python
@dataclass(frozen=True)
class StoredRawObject:
    content_sha256: str
    object_key: str
    byte_length: int
    stored_at: datetime


class RawObjectStore(Protocol):
    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject: ...

    def read(self, object_key: str) -> bytes: ...
```

SHA-256은 HTTP response body 원본 bytes에 계산한다. gzip은 `mtime=0`으로 만들고 key는
`raw/{source}/{endpoint}/{sha256}.xml.gz`다. source/endpoint는 `[a-z0-9-]+`만 허용한다.
Hypothesis property test는 임의 raw bytes에 대해 같은 입력의 key/gzip bytes가 항상 같고,
압축 round-trip과 SHA-256가 보존되며 다른 source/endpoint가 key namespace를 분리함을 검증한다.

- [ ] **Step 4: R2 adapter 구현**

`R2RawObjectStore`는 `R2_ENDPOINT_URL`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`를 `pydantic-settings`의 frozen settings로 process 시작 시 검증하고
secret은 `SecretStr`로 유지한다. boto3 S3 client로 deterministic gzip body를 put한다. 동일
key가 있으면 HEAD의 compressed length, `source-sha256`, raw byte length, content encoding을
모두 확인하고 같은 object만 성공으로 취급한다. 하나라도 다르면 `ObjectCollisionError`를
발생시킨다. `read`는 gzip을 해제한 뒤 key/metadata의 hash와 raw length를 다시 검증하고
불일치 시 `ObjectCorruptionError`를 발생시킨다. 자격증명/endpoint는 error나 repr에 노출하지 않는다.

`test_r2_store.py`는 상태가 있는 fake S3 boundary로 missing HEAD→PUT, 동일 object 재사용,
metadata/length collision, read round-trip/corruption, startup setting validation을 검증한다.
실제 R2 자격증명이나 네트워크는 사용하지 않는다.

- [ ] **Step 5: 단위 테스트와 type/lint 통과**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_object_store.py tests/unit/test_r2_store.py -q && uv run ruff check src tests && uv run pyright src`

Expected: PASS, no lint/type errors. Hypothesis는 dev dependency로 lock되고 stack audit의 해당 행은
실제 deterministic archive property suite를 근거로 `Adopted`로 바뀐다.

- [ ] **Step 6: 커밋**

```bash
git add apps/dataplane docs/architecture/stack/contracts-and-validation.md
git commit -m "feat: archive raw responses by content hash"
```

---

### Task 7: run ledger와 archive-before-parse capture

**Files:**
- Create: `apps/dataplane/src/eatbid/ingest/models.py`
- Create: `apps/dataplane/src/eatbid/ingest/repository.py`
- Create: `apps/dataplane/src/eatbid/ingest/postgres_repository.py`
- Create: `apps/dataplane/src/eatbid/source/client.py`
- Create: `apps/dataplane/src/eatbid/pipeline/capture.py`
- Create: `apps/dataplane/tests/unit/test_capture.py`
- Create: `apps/dataplane/tests/integration/conftest.py`
- Create: `apps/dataplane/tests/integration/test_capture.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`
- Modify: `apps/dataplane/pyproject.toml`
- Modify: `apps/dataplane/uv.lock`
- Modify: `docs/architecture/stack/contracts-and-validation.md`

**Interfaces:**
- Consumes: `RawObjectStore`, PostgreSQL migration, `SourceClient.fetch(request) -> SourceResponse`.
- Produces: `capture(request: CaptureRequest, store, repository, client) -> CapturedObservation`, a psycopg adapter, canonical request-parameter hashing, and Testcontainers fixtures `migrated_db`, `pipeline_services`.

- [ ] **Step 1: 저장 순서를 증명하는 실패 테스트 작성**

```python
from datetime import UTC, datetime
from uuid import UUID

from eatbid.ingest.models import CaptureRequest
from eatbid.object_store import StoredRawObject
from eatbid.pipeline.capture import capture
from eatbid.source.client import SourceResponse


def test_capture_archives_before_recording_observation() -> None:
    events: list[str] = []
    store = RecordingStore(events)
    repo = RecordingRepository(events)
    client = StaticSourceClient(SourceResponse(200, b"<result><TOT_CNT>1</TOT_CNT></result>", datetime.now(UTC)))
    request = CaptureRequest(1, UUID("00000000-0000-0000-0000-000000000001"), "eat", "bid-list", {})
    capture(request, store, repo, client)
    assert events == ["object_stored", "observation_recorded"]
```

- [ ] **Step 2: pipeline module이 없어 실패하는지 확인**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_capture.py tests/integration/test_capture.py -q`

Expected: FAIL on import.

- [ ] **Step 3: exact ports와 models 구현**

```python
@dataclass(frozen=True)
class CaptureRequest:
    request_unit_id: int
    run_id: UUID
    source: str
    endpoint: str
    params: Mapping[str, str]


@dataclass(frozen=True)
class SourceResponse:
    status_code: int
    body: bytes
    fetched_at: datetime


@dataclass(frozen=True)
class CapturedObservation:
    observation_id: int
    content_sha256: str
    object_key: str
    fetched_at: datetime
```

`repository.py`는 `IngestRepository` port만, `postgres_repository.py`는 psycopg DML adapter만
소유한다. Repository는 `start_run`, `plan_request_unit -> PlannedRequestUnit`,
`record_observation`, `fail_run`을 제공한다. `CaptureRequest`는 미리 발급된 bigint
`request_unit_id`와 `run_id`를 함께 들고 DB의 composite FK 경계를 그대로 지킨다.
request params는 key 정렬 canonical JSON으로 저장하고 SHA-256을 unique key에 쓴다.
Hypothesis는 서로 다른 mapping insertion order와 Unicode/빈 값을 포함해 같은 논리 params가
같은 canonical bytes/hash를 만들고 다른 값은 다른 hash를 만듦을 검증한다.

- [ ] **Step 4: capture use case와 CLI wiring 구현**

`capture`는 미리 plan된 request unit을 소비하며 source 응답을 받은 뒤 `store.put` 성공 전에는
repository를 호출하지 않는다. R2 성공 후 한 DB transaction에서 raw blob을 exact metadata로
insert-or-verify하고 append-only observation을 insert하며 request/run count를 갱신한다. HTTP
403/429 body도 먼저 archive/record하고 run failure를 같은 transaction에 기록한 뒤
`SOURCE_THROTTLED=75`로 매핑한다. 그 외 non-2xx source contract는
`SOURCE_CONTRACT=76`, configuration은 64로 매핑한다. client/store/repository concrete fakes로
archive 실패 시 DB write 0, source error body 보존, 동일 body 관측 2건을 검증한다.

- [ ] **Step 5: PostgreSQL integration test와 재실행 테스트**

`testcontainers[postgres]`로 task-scoped PostgreSQL 16을 만들고 Task 5의 committed migration runner를
적용한다. 로컬 5434 DB, 고정 container name, 공유 volume은 사용하지 않는다.

Run: `cd apps/dataplane && uv run pytest tests/integration/test_capture.py -q`

Expected: 동일 body 두 번 capture 시 raw_blob 1행, raw_observation 2행, request/run count 2,
canonical params/hash 동일, event order test PASS. Testcontainers와 migration runner가 종료된 뒤
container/network는 남지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add apps/dataplane docs/architecture/stack/contracts-and-validation.md
git commit -m "feat: record append-only source observations"
```

---

### Task 8: eaT payload normalization과 완전성 gate

**Files:**
- Create: `packages/db/src/schema/ingest/lineage.ts`
- Create: `packages/db/src/schema/ingest/lineage.test.ts`
- Modify: `packages/db/src/schema/ingest/evidence.ts`
- Modify: `packages/db/src/schema/ingest/index.ts`
- Modify: `packages/db/src/schema/ingest.test.ts`
- Modify: `packages/db/src/version.ts`
- Modify: `packages/db/src/version.test.ts`
- Modify: `packages/db/src/migrate.test.ts`
- Create: `packages/db/drizzle/20260829002000_ingest_lineage_manifests/migration.sql` (generated)
- Create: `packages/db/drizzle/20260829002000_ingest_lineage_manifests/snapshot.json` (generated)
- Create: `apps/dataplane/src/eatbid/source/eat/__init__.py`
- Create: `apps/dataplane/src/eatbid/errors.py`
- Create: `apps/dataplane/src/eatbid/source/eat/models.py`
- Create: `apps/dataplane/src/eatbid/source/eat/schema_contract.py`
- Create: `apps/dataplane/src/eatbid/source/eat/xml.py`
- Create: `apps/dataplane/src/eatbid/source/eat/normalize.py`
- Create: `apps/dataplane/src/eatbid/ingest/normalization_repository.py`
- Create: `apps/dataplane/src/eatbid/ingest/postgres_normalization_repository.py`
- Create: `apps/dataplane/src/eatbid/ingest/publication_repository.py`
- Create: `apps/dataplane/src/eatbid/ingest/postgres_publication_repository.py`
- Create: `apps/dataplane/src/eatbid/pipeline/normalize.py`
- Create: `apps/dataplane/src/eatbid/pipeline/validate.py`
- Create: `apps/dataplane/tests/fixtures/eat/bid-list-one.xml`
- Create: `apps/dataplane/tests/fixtures/eat/bid-detail-one.xml`
- Create: `apps/dataplane/tests/unit/test_eat_xml.py`
- Create: `apps/dataplane/tests/unit/test_eat_normalize.py`
- Create: `apps/dataplane/tests/unit/test_completeness.py`
- Modify: `apps/dataplane/tests/unit/test_cli.py`
- Create: `apps/dataplane/tests/integration/test_normalize_validate.py`
- Modify: `apps/dataplane/tests/integration/conftest.py`
- Modify: `apps/dataplane/tests/integration/test_capture.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`
- Modify: `apps/dataplane/src/eatbid/pipeline/capture.py`
- Modify: `apps/dataplane/src/eatbid/ingest/postgres_repository.py`
- Modify: `apps/dataplane/pyproject.toml`
- Modify: `apps/dataplane/uv.lock`
- Create: `docs/adr/0014-normalization-attempt-lineage.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/architecture/domain-and-data.md`
- Modify: `docs/architecture/stack/application-runtime.md`
- Modify: `docs/architecture/stack/contracts-and-validation.md`

**Interfaces:**
- Consumes: a committed raw observation, its content-addressed object, planned request identity,
  and parser version. Detail `external_bid_id` comes from the planned `ELCTRN_BID_ID`
  request parameter (the list response's internal `ETN_BID_ID`), never from the display
  `ELCTRN_BID_NO` field.
- Produces: `NormalizedAuction`, `CompletenessReport`, idempotent `normalized_record`
  rows, a run-scoped normalization-attempt transition, a `validated` publication, and pytest
  fixtures `validated_publication`, `observation_id`; never `core` domain IDs or inferred
  eaT→MOIS/NEIS mappings.
- Persists exact lineage manifests: `ingest.publication_record(publication_id,
  normalized_record_id)` freezes the validated output set; `ingest.replay_input(run_id,
  observation_id)` lets a later replay run consume existing evidence without fabricating a
  new HTTP observation or mutating its capture provenance.
- Persists parser interpretation separately from HTTP evidence:
  `normalization_attempt(run_id, observation_id, parser_version)` owns final
  `normalized|quarantined` state, schema fingerprint, bounded reason and attempted time;
  `normalization_attempt_record` links one attempt to one or more reusable normalized records.
  The target `raw_observation` drops `source_entity_id`, `schema_fingerprint`, `parser_status`,
  and `quarantine_reason` rather than serving as a mutable parser-state row.
- Owns one reviewed eaT schema contract per `(source, endpoint, parser_version)`. The
  contract lists the accepted dataset/column shape and derives its fingerprint from that
  shape; an unknown parser contract or observed fingerprint is a publication-blocking
  `SOURCE_CONTRACT`, not an implicitly accepted payload.

- [ ] **Step 1: lineage manifest와 source contract 실패 테스트 작성**

먼저 Drizzle metadata test로 attempt와 세 join table의 keys, checks, non-null FK와
bigint/UUID identity boundary를 고정한다. `publication_record`는 같은 normalized record가 서로 다른
publication의 검증된 입력이 될 수 있으므로 `normalized_record_id` 단독 unique를 두지 않는다.
`replay_input`도 원본 `raw_observation.run_id`를 바꾸지 않고 여러 명시적 replay run에서
같은 evidence를 재사용할 수 있어야 한다. `normalization_attempt_record`도 같은 deterministic
normalized record를 여러 run/parser attempt가 재사용할 수 있어 `normalized_record_id` 단독
unique를 두지 않는다. attempt는 `(run_id, observation_id, parser_version)` unique이고 상태별
metadata check를 가진다. generated migration 외 handwritten DDL은 금지한다.

새 generated migration은 기존 immutable migration을 수정하지 않고 다음 최종 상태를 만든다.

- `raw_observation`은 HTTP 요청/응답·raw content address만 보존하며 parser 결과 column이 없다.
- `normalization_attempt.status='normalized'`는 schema fingerprint가 있고 quarantine reason이 없다.
- `status='quarantined'`는 normalized member 없이 reason이 있다; fingerprint는 parse 단계에
  도달하지 못한 payload를 위해 nullable이다.
- 성공 attempt는 `normalization_attempt_record`를 하나 이상 가져야 한다는 cross-row invariant를
  repository transaction/test가 강제한다.

그 다음 source identity, 안전한 XML, leading-zero 보존 테스트를 작성한다.

```python
from pathlib import Path

from eatbid.source.eat.normalize import normalize_bid_detail


def test_normalize_separates_internal_identity_from_display_number() -> None:
    fixture = Path(__file__).parents[1] / "fixtures/eat/bid-detail-one.xml"
    record = normalize_bid_detail(
        fixture.read_bytes(),
        external_bid_id="5610615",
        parser_version="eat-v1",
    )
    assert record.external_bid_id == "5610615"
    assert record.display_bid_no == "E250617-472599-1"
    assert record.organization_code == "153347"
    assert record.sido_code == "15"
    assert record.sigungu_code == "653"
    assert record.eligibility_codes == ("15653",)
```

`bid-detail-one.xml`은 검증된 레거시 fixture/`SOURCE-FIELDS.md`의 필드명과
관계를 사용해 비식별화한다. 임의의 정부 코드나 실제 기관명을 발명하지 않는다.
Hypothesis는 `0`으로 시작하는 임의의 Unicode-safe digit code를 생성해
Pydantic validation, normalization, canonical JSON round-trip 어디에서도 값이
정수로 바뀌거나 앞자리 `0`이 사라지지 않음을 증명한다.

`schema_contract.py`는 `eat/bid-detail/eat-v1`이 검토한 dataset/column shape를 사람이
리뷰 가능한 구조로 한 번만 선언하고 parser와 같은 canonical fingerprint 함수로 digest를
계산한다. fixture에 선언·관측된 미검토 column을 하나 추가하면 normalization evidence는
보존되지만 publication은 `SOURCE_CONTRACT`로 실패해야 한다. parser version이나 endpoint에
등록된 contract가 없어도 fail closed 한다.

같은 모듈의 `parse_bid_list_page`는 `bid-list-one.xml`에서 source `TOT_CNT`와
`ETN_BID_ID` 목록을 typed `BidListPage(total_count, external_bid_ids)`로 만든다.
`TOT_CNT`는 nonnegative decimal text만 받고, page 안의 빈/중복 ID와
`len(external_bid_ids) > total_count`를 contract error로 처리한다. 이 task는
list parser 계약까지만 소유하며 pagination/network planning은 production eaT adapter를
조립하는 Task 14에서 이 계약을 소비한다.

`xml.py`는 외부 응답을 untrusted input으로 취급한다. Python 문서가 권고하는
`defusedxml.ElementTree` stable `>=0.7.1,<1`을 사용하고 DTD, entity, external
reference를 금지한다. namespace가 있는 Nexacro `Dataset/Row/Col`만 파싱하며,
중복 dataset ID, 중복 column ID, column ID 없는 값, 필수 `ds_info` 1행 위반을
조용히 덮어쓰지 않고 typed parse error로 만든다. dataset/column 이름의 정렬된
canonical JSON에서 SHA-256 `schema_fingerprint`를 계산한다. 원본 column 순서가
달라도 같은 구조면 같은 fingerprint여야 한다.

- [ ] **Step 2: TOT_CNT 불일치 실패 테스트 작성**

```python
from eatbid.pipeline.validate import validate_completeness


def test_publication_is_rejected_when_tot_count_differs() -> None:
    report = validate_completeness(
        request_counts=((2, 1),),
        normalized=1,
        quarantined=0,
        duplicate_source_entities=0,
        missing_code_schemes=(),
        schema_contract_violations=0,
    )
    assert report.publishable is False
    assert report.failure_category == "SOURCE_CONTRACT"
```

Hypothesis로 nonnegative count 조합을 생성해 다음 식과 구현이 동치임을 검증한다.

```text
publishable =
  every request.expected_count == request.observed_count
  and sum(request.observed_count) == normalized
  and quarantined == 0
  and duplicate_source_entities == 0
  and missing_code_schemes == empty
  and schema_contract_violations == 0
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm --filter @eatbid/db exec bun test src/schema/ingest/lineage.test.ts`

Expected: FAIL because lineage tables do not exist.

Run: `cd apps/dataplane && uv run pytest tests/unit/test_cli.py tests/unit/test_eat_xml.py tests/unit/test_eat_normalize.py tests/unit/test_completeness.py tests/integration/test_normalize_validate.py -q`

Expected: FAIL because normalizer and validator do not exist.

- [ ] **Step 4: bounded XML parser, Pydantic models, deterministic normalizer 구현**

```python
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


class NormalizedAuction(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True)
    external_bid_id: str
    display_bid_no: str | None
    title: str
    source_status: str
    organization_code: str
    organization_name: str
    sido_code: str | None
    sigungu_code: str | None
    eligibility_codes: tuple[str, ...]
    announced_at: datetime | None
    deadline_at: datetime | None
    opened_at: datetime | None
    base_amount: Decimal | None
    planned_amount: Decimal | None
    currency: Literal["KRW"] = "KRW"
    source_category_label: str | None
    category_source: Literal["source_field", "inferred_from_title", "unknown"]
```

XML dataset row는 `TypeAdapter(dict[str, StrictStr])`로 source fragment 경계에서
검증한다. `NormalizedAuction`은 Pydantic model validation을 한 번만 통과한 뒤
`model_dump(mode="json")` 결과를 key-sorted compact UTF-8 JSON으로 canonicalize한다.
Decimal은 float를 거치지 않고 source string에서 변환하며 datetime은 명시한 eaT format만
받는다. 빈 문자열은 optional field에서만 `None`으로 바꾸고 code/label은 text로 보존한다.
주소, 기관명, 공고명에서 code를 추론하지 않는다. `MAIN_ITEMS`가 있으면 그 원본 label만
`source_category_label`/`source_field`로 보존하고, 없으면 `unknown`이다. 내부 taxonomy term을
만들거나 제목에서 품목을 추론하지 않는다.

- [ ] **Step 5: normalization port/adapter와 quarantine transaction 구현**

`normalization_repository.py`는 immutable input/result와 port만 소유하고,
`postgres_normalization_repository.py`는 psycopg DML만 소유한다. `pipeline/normalize.py`는
`processing_run_id`와 `observation_id`를 받아 DB에서 input을 읽고 object-store `read`로 raw를
복원한 뒤 parse/normalize한다. capture/backfill은 processing run이 observation의 원래 run과
같아야 하고, replay는 running replay run + exact `replay_input` membership가 있어야 한다.
호출 parser version은 processing run의 version과 일치해야 하며 원래 capture run의 version으로
고정하지 않는다.

성공 transaction은 다음을 원자적으로 수행한다.

1. processing run, observation, request identity와 replay membership를 lock/revalidate한다.
2. `(observation_id, record_type, source_entity_id, parser_version)`로 insert-or-verify한다.
3. 기존 key가 있으면 normalized payload 전체가 같아야 하며 다르면 nondeterminism 오류다.
4. final `normalization_attempt`를 insert-or-verify하고 `normalization_attempt_record`로 exact
   output record를 연결한다. `raw_observation`은 update하지 않는다.

safe XML/Pydantic/source invariant 실패는 raw를 지우지 않고 별도 transaction에서
해당 processing run의 final `normalization_attempt='quarantined'`, bounded reason,
`schema_fingerprint`(계산된 경우)를 남긴 뒤 `DATA_QUARANTINED=65` typed error를 낸다.
동일 attempt 재실행은 같은 결과를 반환/보고하고 normalized↔quarantined로 회귀하지 않는다.
다른 replay run/parser attempt는 과거 결과를 덮어쓰지 않고 독립적으로 성공/격리될 수 있다.
run-level `TOT_CNT`/schema/invariant
위반은 `SOURCE_CONTRACT=76`으로 구분한다. DB/R2 장애를 source quarantine으로
오분류하지 않는다. normalize/replay 재실행은 같은 parser version에서 동일 payload를 만들며
normalized row와 count를 늘리지 않는다.

- [ ] **Step 6: publication port/adapter와 완전성 transaction 구현**

`publication_repository.py`와 `postgres_publication_repository.py`를 normalization DML에서
분리한다. `pipeline/validate.py`는 pure `validate_completeness`와 transaction orchestration만
소유한다. publication UUID와 `validated_at`은 외부에서 주입해 테스트를 결정적으로 만든다.

capture/backfill run의 candidate input은 원래 capture provenance인
`raw_observation.run_id = run_id`로 정한다. `mode='replay'` run은 오직
`replay_input(run_id, observation_id)` manifest로 input을 정하며 request unit이나 새 HTTP
observation을 발명하지 않는다. validation은 candidate마다 현재 run/parser version의 final
`normalization_attempt`를 요구하고 quarantined/missing attempt를 센다. normalized attempt의
`normalization_attempt_record`만 candidate normalized record ID가 된다. 그 집합을
`publication_record`에 동결하며 이후 projector는 run join을 다시 계산하지 않고 이 manifest만
소비한다. 각 attempt의 source/endpoint/parser version/schema fingerprint는
`schema_contract.py`의 reviewed contract와 일치해야 하며 adapter가 eaT 상수를 직접 소유하지
않도록 source-contract validator를 port로 주입한다.

검증 transaction은 run과 모든 request unit/observation을 lock하고 DB에서 다음을 다시 센다.

- run은 `running`; failed request가 없어야 한다.
- 모든 request unit의 `expected_count == observed_count`.
- observation 수, normalized row 수, distinct source entity 수가 정확히 일치.
- quarantine 0, duplicate source entity 0.
- parser version은 run과 일치.
- `eat:auction-location-sido`, `eat:auction-location-sigungu`,
  `eat:eligibility-area`, `eat:organization` scheme가 존재.

모두 통과할 때만 unique `publication(run_id)`을 insert-or-verify하고 status를 `validated`로,
run status를 `validated`로 전환한다. Task 8은 `activated_at`, `published_count`, core/mart를
건드리지 않는다. 실패하면 `validated`를 만들지 않고 기존 active publication도 바꾸지 않으며,
해당 run의 publication은 `failed`와 관측 count를, run은 최초 failure category/ended_at을
단조 상태 전이로 남긴다. 성공/멱등 재검증은 exact `publication_record` set을 검증하고,
validation 뒤 staging에 추가된 normalized row를 기존 publication에 암묵적으로 편입하지 않는다.
terminal run의 빠른 반환은 금지한다. 재검증도 locked candidate observation → current
run/parser attempt → attempt-record를 다시 계산해 frozen member ID의 **정렬된 정확한 집합**,
run/publication status, expected/normalized count와 비교한다. 같은 cardinality의 다른 normalized
record로 member를 치환하거나 publication status를 바꾼 경우 integrity error로 거부한다.

- [ ] **Step 7: 실제 PostgreSQL behavior와 method audit 검증**

기존 Task 7의 uniquely named PostgreSQL 16 Testcontainer와 compiled migration runner를
재사용한다. integration test는 최소한 다음을 증명한다.

- 동일 observation/parser normalize 두 번 → normalized row 1개, byte-equivalent payload.
- malformed/entity XML → raw 보존, normalized row 0, run-scoped attempt quarantined.
- 같은 raw를 새 replay run/parser version으로 normalize → 별도 attempt; 원래 attempt와
  `raw_observation` 불변, 같은 parser면 existing normalized record 재사용, 새 parser면 새 key.
- normalized/quarantined attempt 재호출은 idempotent하며 반대 상태로 덮어쓰지 않는다.
- `TOT_CNT`/request count mismatch, quarantine, duplicate source entity, missing scheme 각각
  publication validated 0, 기존 active state 변경 0.
- complete run → publication 1개 `validated`, run `validated`, core row 0.
- validate 재실행은 같은 publication identity/metadata/member set을 검증하고 중복을 만들지 않는다.
- validation 뒤 별도 normalized row를 만들어도 기존 `publication_record` set은 불변이다.
- validated publication의 member를 같은 개수의 unrelated normalized record로 치환하거나
  publication status를 run과 어긋나게 바꾸면 terminal 재검증이 integrity error를 낸다.
- 검토한 fixture schema는 발행되지만 declared+observed 미검토 column, unknown endpoint/parser
  contract는 raw/attempt를 보존한 채 `SOURCE_CONTRACT` publication failure가 된다.
- replay input은 새 run에서 기존 observation을 명시적으로 참조하며 원본 observation의 capture
  `run_id`를 변경하거나 복제하지 않는다.
- 실제 eaT list parser의 `SourceContractError`가 CLI exit 76으로 매핑된다.

`defusedxml`은 runtime dependency로 lock하고 stack audit에 stable 0.7.1, Python 공식
untrusted-XML 권고, DTD/entity tests, 다음 stable major 검토 trigger를 기록한다. Pydantic
`TypeAdapter`/Hypothesis audit은 이 task의 실제 source-fragment/count 사용을 반영한다.
ADR 0014와 `domain-and-data.md`는 immutable raw evidence → run-scoped interpretation attempt →
frozen publication member의 one-way lineage를 문서화한다.

`SourceContractError`는 `eatbid/errors.py`의 공통 typed error 하나만 사용한다. capture와 eaT list
parser가 이 타입을 공유하고 CLI는 실제 `TOT_CNT`/schema contract error를 exit 76으로 매핑한다.
동명 비호환 exception을 layer별로 다시 만들지 않는다.

Run: `cd apps/dataplane && uv run pytest tests/unit/test_cli.py tests/unit/test_eat_xml.py tests/unit/test_eat_normalize.py tests/unit/test_completeness.py tests/integration/test_normalize_validate.py -q`

Expected: PASS; source identity/display number가 분리되고 code text/unknown/quarantine가
보존되며 불완전 run은 발행되지 않는다.

- [ ] **Step 8: 전체 gate와 커밋**

Run: `cd apps/dataplane && uv lock --check && uv sync --frozen && uv run pytest -q && uv run ruff check src tests && uv run pyright src`

Run: `pnpm architecture:check && pnpm test && pnpm build`

```bash
git add packages/db apps/dataplane docs/adr/0014-normalization-attempt-lineage.md docs/adr/README.md docs/architecture/domain-and-data.md docs/architecture/stack/application-runtime.md docs/architecture/stack/contracts-and-validation.md
git commit -m "feat: validate typed eaT observations"
```

---

### Task 9: canonical projection schema와 atomic projector

**Files:**
- Modify: `packages/db/src/schema/core/codes.ts`
- Modify: `packages/db/src/schema/core/organizations.ts`
- Modify: `packages/db/src/schema/core/procurement.ts`
- Modify: `packages/db/src/schema/core/index.ts`
- Modify: `packages/db/src/schema/core/canonical.test.ts`
- Modify: `packages/db/src/schema/ingest/publication.ts`
- Modify: `packages/db/src/schema/ingest/run.ts`
- Modify: `packages/db/src/schema/ingest.test.ts`
- Modify: `packages/db/src/version.ts`
- Modify: `packages/db/src/version.test.ts`
- Modify: `packages/db/src/migrate.test.ts`
- Create: `packages/db/drizzle/20260829002500_core_projection_lineage/migration.sql` (generated)
- Create: `packages/db/drizzle/20260829002500_core_projection_lineage/snapshot.json` (generated)
- Create: `apps/dataplane/src/eatbid/core/__init__.py`
- Create: `apps/dataplane/src/eatbid/core/models.py`
- Create: `apps/dataplane/src/eatbid/core/repository.py`
- Create: `apps/dataplane/src/eatbid/core/postgres_repository.py`
- Create: `apps/dataplane/src/eatbid/pipeline/project.py`
- Modify: `apps/dataplane/src/eatbid/ingest/postgres_publication_repository.py`
- Create: `apps/dataplane/tests/unit/test_project.py`
- Create: `apps/dataplane/tests/integration/test_project.py`
- Modify: `apps/dataplane/tests/integration/test_normalize_validate.py`
- Modify: `apps/dataplane/tests/integration/conftest.py`
- Create: `docs/adr/0015-canonical-projection-lineage.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/architecture/domain-and-data.md`

**Interfaces:**
- Consumes: one locked `publication.status='validated'`; only its frozen
  `publication_record` members; strict `NormalizedAuction` payloads; reviewed code schemes.
- Produces: append-only canonical revisions with direct `normalized_record_id` lineage,
  revision-scoped bigint organization/code relations, and an atomic published marker with a
  persisted deterministic fingerprint.
- `core/repository.py` owns ports and immutable records only. `core/postgres_repository.py` owns
  psycopg SQL. Source/Pydantic decoding stays in `pipeline/project.py` and is injected as a pure
  `ProjectionFactory`; the PostgreSQL adapter does not import eaT payload models.

- [ ] **Step 1: canonical projection DDL의 실패 테스트 작성**

Drizzle metadata tests first require the following exact target.

- `core.auction_attempt` identity is only `(source_system, external_bid_id)`; display number is
  not stored on the identity row.
- `core.auction_revision` adds nullable `display_bid_no` and non-null
  `normalized_record_id → ingest.normalized_record`; one normalized record can create at most one
  revision. The old `(auction_attempt_id, content_sha256)` uniqueness is replaced so a new parser
  interpretation of the same raw bytes can be an independent canonical revision.
- `core.auction_organization` is revision-scoped: composite PK
  `(auction_revision_id, organization_id, role)`, not an unversioned attempt relation.
- new `core.auction_revision_code_value(auction_revision_id, code_value_id, role)` has a composite
  PK and roles `location_sido|location_sigungu|eligibility_area`.
- `organization.canonical_name` is nullable and `type='unknown'` is allowed. Source `PURR_NM` is
  evidence in `code_label_observation`, not an unreviewed canonical identity/name decision.
- `code_label_observation` is idempotent at
  `(code_value_id, label, language, observation_id)`.
- `ingest.publication` adds nullable lowercase-SHA-256 `canonical_fingerprint` and non-empty
  `projector_version`; they are required only for `published`. Non-published rows keep activation,
  published count, fingerprint and projector version empty/zero.
- `ingest.run` DB checks require failed/published terminal metadata and make published count equal
  expected count.

Run: `pnpm --filter @eatbid/db exec bun test src/schema/core/canonical.test.ts src/schema/ingest.test.ts src/version.test.ts src/migrate.test.ts`

Expected: FAIL because projection lineage columns/table and migration version do not exist.

- [ ] **Step 2: focused Drizzle modules와 generated migration 구현**

DDL은 위 네 focused modules에서만 작성한다. `20260829002000_ingest_lineage_manifests`와 그 이전
migration은 수정하지 않는다. Drizzle Kit으로 새 migration/snapshot을 생성하고 exact directory를
`20260829002500_core_projection_lineage`로 고정한다. generated SQL은 old auction uniqueness/columns를
명시적으로 전환하고 새 FK/check/unique를 만들어야 한다. handwritten DDL과 Python DDL은 금지한다.

Run: `pnpm --filter @eatbid/db db:generate && pnpm --filter @eatbid/db db:check`

Expected: reviewed migration 생성 후 두 번째 generate는 `No schema changes, nothing to migrate`.

- [ ] **Step 3: projector API와 결정적 fingerprint 실패 테스트 작성**

```python
from eatbid.pipeline.project import ProjectionFingerprintItem, canonical_projection_fingerprint, project_publication


def test_projection_fingerprint_is_order_independent() -> None:
    items = (
        ProjectionFingerprintItem("eat", "01", "a" * 64, "eat-v1", "b" * 64),
        ProjectionFingerprintItem("eat", "02", "c" * 64, "eat-v1", "d" * 64),
    )
    assert canonical_projection_fingerprint(items) == (
        "1875975d824d5ed54a1740ca089219e8712e5eb8fc9cc12a4c616c73f78e7041"
    )


def test_projecting_same_publication_twice_is_idempotent(
    pipeline_services, validated_publication
) -> None:
    first = project_publication(
        publication_id=validated_publication,
        projector_version="a" * 64,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )
    second = project_publication(
        publication_id=validated_publication,
        projector_version="a" * 64,
        activated_at=ACTIVATED_AT + timedelta(hours=1),
        repository=pipeline_services.projection_repository,
    )
    assert first.canonical_fingerprint == second.canonical_fingerprint
    assert first.auction_revisions_inserted == 1
    assert second.auction_revisions_inserted == 0
```

Hypothesis permutes two or more hand-built projection items and proves that sorted canonical JSON
produces the same fingerprint. The tuple hashed for each member is exactly
`(source_system, external_bid_id, raw_content_sha256, parser_version,
normalized_payload_sha256)`; bigint IDs and row order never enter the digest.

Run: `cd apps/dataplane && uv run pytest tests/unit/test_project.py tests/integration/test_project.py -q`

Expected: FAIL on missing core/project modules, not fixture wiring.

- [ ] **Step 4: strict projection factory와 focused port 구현**

```python
@dataclass(frozen=True, slots=True)
class ProjectionFingerprintItem:
    source_system: str
    external_bid_id: str
    raw_content_sha256: str
    parser_version: str
    normalized_payload_sha256: str


@dataclass(frozen=True, slots=True)
class ExternalCodeRef:
    namespace: str
    code: str
    role: str


@dataclass(frozen=True, slots=True)
class AuctionProjection:
    normalized_record_id: int
    observation_id: int
    source_system: str
    endpoint: str
    parser_version: str
    raw_content_sha256: str
    normalized_payload_sha256: str
    external_bid_id: str
    display_bid_no: str | None
    organization_code: str
    organization_label: str
    code_refs: tuple[ExternalCodeRef, ...]


@dataclass(frozen=True, slots=True)
class ProjectResult:
    publication_id: UUID
    members_projected: int
    auction_attempts_inserted: int
    auction_revisions_inserted: int
    organizations_inserted: int
    code_values_inserted: int
    code_labels_inserted: int
    relationships_inserted: int
    canonical_fingerprint: str
```

`pipeline/project.py` recanonicalizes PostgreSQL JSONB, validates it through strict
`NormalizedAuction` without ignoring extras, and verifies source=`eat`, endpoint=`bid-detail`,
record type=`auction`, payload external ID=`normalized_record.source_entity_id`, parser version/run
version, and raw content hash. It emits these explicit code refs only:

```text
eat:auction-location-sido   <- sido_code          role=location_sido
eat:auction-location-sigungu <- sigungu_code      role=location_sigungu
eat:eligibility-area       <- eligibility_codes  role=eligibility_area
eat:organization           <- organization_code  organization identifier
```

It never creates `mois:*`, `neis:*`, `code_mapping`, school type, or taxonomy from names/title.
`PURR_NM` becomes `code_label_observation(language='und')`; Organization is created with
`type='unknown'`, `canonical_name=NULL` until a separate reconciliation policy exists.

- [ ] **Step 5: serialized atomic projection transaction 구현**

`PsycopgCanonicalProjectionRepository` locks publication/run and requires both `validated`, exact
manifest cardinality, activation fields empty, and every member to still match its Task 8
candidate→attempt→record lineage. The supplied lowercase 64-hex `projector_version` must equal the
locked run `build_sha`. It processes only `publication_record`; it never reselects a run's arbitrary
staging rows.

In one transaction it:

1. calls the injected `ProjectionFactory` for every locked member and computes the fingerprint;
2. resolves existing seeded scheme by namespace, insert-or-verifies text `code_value`, and locks the
   code value before resolving an Organization so concurrent creation cannot orphan duplicates;
3. insert-or-verifies Organization/identifier and observation-scoped label evidence;
4. insert-or-verifies AuctionAttempt by `(source_system, external_bid_id)`;
5. insert-or-verifies AuctionRevision by `normalized_record_id`, verifying the full persisted row;
6. inserts revision-scoped purchaser/code-value relations with bigint FKs;
7. only after exact member count succeeds, updates publication/run to `published`, sets the first
   `activated_at`/`ended_at`, exact published counts, projector version and canonical fingerprint.

A second/concurrent call serializes on the publication row, verifies the exact persisted projection
and returns zero inserts with the original activation metadata/fingerprint. A deterministic payload,
scheme, lineage, or persisted-row conflict raises `ProjectionContractError`; the core transaction
rolls back and a separate transaction monotonically marks the still-validated run/publication failed
with `PROJECTION_CONTRACT`. Transient connection/provider errors roll back and propagate while leaving
the publication validated for Argo retry; they are not mislabeled as bad source data. Published state
never regresses. The existing publication revalidation adapter is widened without weakening Task 8:
`SOURCE_CONTRACT` failures still require no validation timestamp, while a `PROJECTION_CONTRACT`
failure requires the prior validation timestamp, preserves the exact frozen member manifest for
diagnosis/replay, and keeps activation/fingerprint/published count empty.

- [ ] **Step 6: 실제 PostgreSQL projector 불변식 검증**

Disposable PostgreSQL 16 integration tests prove at least:

- one validated fixture → one Organization, one identifier, one Attempt, one Revision, purchaser
  relation, and bigint revision-code relations for sido/sigungu/eligibility;
- no `code_mapping`, MOIS/NEIS scheme/value, school type, or string relation is invented;
- same name with different organization codes makes two organizations; same code with later label
  reuses one organization and appends idempotent label evidence;
- missing display number projects as a nullable revision attribute;
- projecting the same publication twice and concurrently adds no rows and preserves first metadata;
- a replay publication reusing the same normalized record reuses the canonical revision but still
  publishes its exact member count;
- the DB grain permits a second normalized-record/parser interpretation of the same raw to create a
  separate revision; this task does not register a fictitious `eat-v2` source contract;
- corrupt payload/member/scheme or conflicting existing canonical row causes zero partial core writes
  and a deterministic failed publication; an injected transient DB failure leaves it retryable;
- publication fingerprint equals a hand-checked natural-key/payload-hash digest and is order independent.

ADR 0015 documents normalized interpretation → canonical revision lineage, revision-scoped code and
organization facts, nullable unreviewed canonical name, deterministic failure versus retryable
infrastructure failure, and why display numbers/names are not identity.

- [ ] **Step 7: 전체 gate와 커밋**

Run: `cd apps/dataplane && uv run pytest -q && uv run ruff check src tests && uv run pyright src`

Run: `pnpm --filter @eatbid/db db:check && pnpm architecture:check && pnpm test && pnpm build`

```bash
git add packages/db apps/dataplane docs/adr docs/architecture/domain-and-data.md
git commit -m "feat: project validated auction facts"
```

---

### Task 10: resumable deterministic replay orchestration

**Files:**
- Create: `apps/dataplane/src/eatbid/ingest/replay_repository.py`
- Create: `apps/dataplane/src/eatbid/ingest/postgres_replay_repository.py`
- Modify: `apps/dataplane/src/eatbid/ingest/publication_repository.py`
- Modify: `apps/dataplane/src/eatbid/ingest/postgres_publication_repository.py`
- Create: `apps/dataplane/src/eatbid/pipeline/replay.py`
- Create: `apps/dataplane/tests/unit/test_replay.py`
- Create: `apps/dataplane/tests/integration/test_replay.py`
- Modify: `apps/dataplane/tests/integration/test_normalize_validate.py`
- Modify: `apps/dataplane/tests/integration/conftest.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`
- Modify: `docs/adr/0014-normalization-attempt-lineage.md`
- Modify: `docs/adr/0015-canonical-projection-lineage.md`
- Modify: `docs/architecture/domain-and-data.md`

**Interfaces:**
- Consumes: an externally supplied replay run/publication UUID, exact unique raw observation IDs,
  build/projector SHA, registered parser version, and explicit stage timestamps.
- Produces: idempotent `running → validated → published` resume behavior and
  `ReplayResult(run_id, publication_id, status, canonical_fingerprint)`.
- `ReplayRunRepository` exclusively owns replay-run creation and frozen `replay_input` membership;
  remove `add_replay_input` from `PublicationRepository` so manifest ownership is not split.

- [ ] **Step 1: replay manifest/resume 실패 테스트 작성**

```python
def test_same_replay_run_resumes_without_duplicate_state(replay_harness, observation_id) -> None:
    first = replay_harness.run(run_id=RUN_ID, observation_ids=(observation_id,))
    second = replay_harness.run(run_id=RUN_ID, observation_ids=(observation_id,))
    assert second == first
    assert second.status == "published"


def test_replay_run_rejects_manifest_drift(replay_harness, two_observation_ids) -> None:
    replay_harness.start(run_id=RUN_ID, observation_ids=two_observation_ids)
    with pytest.raises(ReplayIntegrityError):
        replay_harness.start(run_id=RUN_ID, observation_ids=two_observation_ids[:1])
```

Unit tests reject empty, duplicate, boolean/nonpositive IDs before DB writes. Hypothesis permutes the
same unique observation set and proves manifest/fingerprint order independence while a changed set is
not equivalent.

Run: `cd apps/dataplane && uv run pytest tests/unit/test_replay.py tests/integration/test_replay.py -q`

Expected: FAIL on missing replay repository/pipeline.

- [ ] **Step 2: atomic start-or-verify replay manifest 구현**

```python
@dataclass(frozen=True, slots=True)
class ReplayRunState:
    run_id: UUID
    status: Literal["running", "validated", "published", "failed"]
    parser_version: str
    build_sha: str
    observation_ids: tuple[int, ...]
    publication_id: UUID


class ReplayRunRepository(Protocol):
    def start_or_load(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        observation_ids: tuple[int, ...],
        build_sha: str,
        parser_version: str,
        started_at: datetime,
    ) -> ReplayRunState: ...
```

The PostgreSQL adapter locks/inserts the `mode='replay'` run, its supplied `publication_id` as an
`ingest.publication.status='pending'` row, and its entire sorted `replay_input` manifest in one
transaction. New run metadata/count and all observations must exist before commit. Task 8 validation
is refactored to insert-or-transition this exact pending publication (normal capture may still create
one at validation). Existing run must be replay mode and match publication ID, build/parser/start
time/expected count/exact member set; it returns its terminal/current state without mutation. A
different publication ID, manifest, or metadata under the same run ID is an integrity error. This
replaces row-at-a-time manifest mutation and freezes every replay identity before work begins.

- [ ] **Step 3: stage-resumable replay use case 구현**

```python
@dataclass(frozen=True, slots=True)
class ReplayResult:
    run_id: UUID
    publication_id: UUID
    status: str
    canonical_fingerprint: str
```

`replay_observations` resumes by state:

1. `running`: normalize each exact manifest observation under the replay run/parser. Existing final
   attempts are insert-or-verified; transient R2/DB errors propagate and keep the run retryable.
2. still `running`: validate exact attempts. Quarantine/schema/count failure creates the monotonic
   failed publication, then raises the typed workflow error (`65` or `76`); no projection runs.
3. `validated`: project the supplied publication with the same pinned build/projector version.
4. `published`: verify/load the persisted projection fingerprint and return it without new writes.
5. `failed`: return/raise the stored typed failure without adding attempts, members, or core rows.

All UUIDs/timestamps are caller supplied. The orchestrator does not generate hidden identities or use
wall-clock time. Operational failures are not quarantined and do not fabricate HTTP observations.

- [ ] **Step 4: deterministic replay와 partial-resume behavior 검증**

Disposable PostgreSQL/R2-fake integration tests prove:

- two different replay run IDs over the same raw/parser/build create two attempts/publications but
  reuse the normalized record and canonical revision and return the same persisted fingerprint;
- same run retried after manifest-only, one normalized member, validated, and published checkpoints
  resumes without duplicates or metadata drift;
- raw observation capture `run_id` never changes and replay creates zero raw observations/blobs;
- input order does not change manifest order or fingerprint; duplicate/unknown IDs make no run;
- same run ID with changed publication ID/manifest/parser/build/start time is rejected;
- R2 read/transient DB failure leaves running state for retry and creates no quarantine/publication;
- quarantined or unreviewed-schema replay becomes failed with no core writes and correct exit category;
- published replay re-entry verifies exact publication/core lineage rather than trusting only counts.

- [ ] **Step 5: full gates, docs, commit**

Run: `cd apps/dataplane && uv run pytest -q && uv run ruff check src tests && uv run pyright src`

Run: `pnpm architecture:check && pnpm test && pnpm build`

```bash
git add apps/dataplane docs/adr/0014-normalization-attempt-lineage.md docs/adr/0015-canonical-projection-lineage.md docs/architecture/domain-and-data.md
git commit -m "feat: replay frozen observations deterministically"
```

---

### Task 11: CI에서 migration·dataplane·네 이미지 검증

**Files:**
- Modify: `.github/workflows/build.yml`
- Create: `infra/update_image_digest.py`
- Create: `infra/tests/test_update_image_digest.py`
- Modify: `Dockerfile.server`
- Modify: `Dockerfile.web`
- Modify: `packages/db/Dockerfile`
- Modify: `package.json`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: pnpm/uv lockfiles, four image Dockerfiles, committed migrations.
- Produces: GHCR web/server/dataplane images from one Git SHA and exact digest updates.

- [ ] **Step 1: digest updater 실패 테스트 작성**

```python
from infra.update_image_digest import update_digest


def test_replaces_only_named_image_digest(tmp_path) -> None:
    manifest = tmp_path / "kustomization.yaml"
    manifest.write_text("images:\n  - name: eatbid-dataplane\n    digest: sha256:old\n")
    update_digest(manifest, "eatbid-dataplane", "sha256:" + "a" * 64)
    assert "digest: sha256:" + "a" * 64 in manifest.read_text()
```

- [ ] **Step 2: updater module이 없어 실패하는지 확인**

Run: `python -m pytest infra/tests/test_update_image_digest.py -q`

Expected: FAIL on import.

- [ ] **Step 3: strict digest updater 구현**

Updater는 image name이 정확히 한 번 존재하고 digest가 `sha256:[0-9a-f]{64}`일 때만 파일을
변경한다. 0개/2개 이상 match나 tag 입력은 exit 2로 거부한다.

- [ ] **Step 4: CI test job 통합**

CI PostgreSQL service를 `postgres:16-alpine`로 띄우고 순서대로 `pnpm install --frozen-lockfile`,
TS tests/build, `uv sync --frozen`, Python pytest/Ruff/Pyright, 빈 DB migration을 실행한다.

- [ ] **Step 5: build matrix에 dataplane/migration 추가**

web/server/dataplane/migration 네 artifact를 동일 full Git SHA label로 build한다. product manifest에는
tag가 아니라 `docker/build-push-action` output digest를 `update_image_digest.py`로 기록한다.
현재 CI의 short-SHA tag bump 방식은 digest 갱신으로 교체한다.

- [ ] **Step 6: 로컬 동등 검증**

Run: `pnpm test && pnpm build && cd apps/dataplane && uv run pytest -q && uv run ruff check src tests && uv run pyright src`

Expected: all commands exit 0.

- [ ] **Step 7: 커밋**

```bash
git add .github/workflows/build.yml Dockerfile.server Dockerfile.web infra apps/dataplane/Dockerfile packages/db/Dockerfile
git commit -m "ci: verify and build one-sha product images"
```

---

### Task 12: Argo Workflows platform과 product template

**Files:**
- Create: `infra/platform/argo-workflows.application.yaml`
- Create: `infra/product/migration.yaml`
- Create: `infra/product/workflows/serviceaccount.yaml`
- Create: `infra/product/workflows/semaphore.yaml`
- Create: `infra/product/workflows/workflow-template.yaml`
- Create: `infra/product/workflows/poll-open.yaml`
- Create: `infra/product/workflows/daily-reconcile.yaml`
- Create: `infra/product/workflows/kustomization.yaml`
- Create: `infra/product/patches/legacy-cronjobs.delete.yaml`
- Create: `infra/product/patches/postgres-secret-env.patch.yaml`
- Create: `infra/product/patches/server-secret-env.patch.yaml`
- Create: `infra/product/secret-contract.md`
- Create: `infra/tests/test_workflow_contract.py`
- Modify: `infra/product/kustomization.yaml`
- Modify: `infra/tests/conftest.py`
- Modify: `.github/workflows/build.yml`
- Modify: `infra/tests/test_build_contract.py`
- Do not modify: `infra/argocd/application.yaml`

**Interfaces:**
- Consumes: digest-pinned dataplane/migration images, current `eatbid` CLI commands, PostgreSQL/R2 Secret contracts.
- Produces: a **dormant, renderable target composition** with one migration PreSync Job,
  `WorkflowTemplate/eatbid-dataplane`, and two suspended CronWorkflows.
- Does not switch the live Argo CD Application from `infra/k8s/base`, install CRDs, create Secrets,
  unsuspend schedules, submit workflows, or mutate the user-owned local cluster.

- [ ] **Step 1: workflow contract 실패 테스트 작성**

`infra/tests/conftest.py`에서 `kubectl kustomize infra/product` 출력을 `yaml.safe_load_all`로 읽어
기존 fixture를 확장한다. `ManifestSet.workflow_template(name)`, `ManifestSet.kinds`, workload image,
Secret ref, hook, CronWorkflow suspend/timezone/template-ref를 구조적으로 조회한다. source YAML grep가
아니라 최종 render를 검증해야 `../k8s/base`의 transitive CronJob과 delete patch를 모두 본다.

```python
def test_target_composition_is_dormant_and_uses_current_cli(manifests) -> None:
    template = manifests.workflow_template("eatbid-dataplane")
    assert template.semaphore_key == "eatbid-source-limit"
    assert template.project_mutex == "eatbid-core-publication"
    assert template.entrypoint_steps == [
        "discover", "capture", "normalize", "validate", "project"
    ]
    assert "CronJob" not in manifests.kinds
    assert all(workflow.suspend is True for workflow in manifests.cron_workflows)
```

추가 계약은 다음을 고정한다.

- product render에는 WorkflowTemplate 1, CronWorkflow 2, migration Job 1이 있고 native CronJob/hostPath는 0이다.
- base render에는 기존 CronJob 4개가 그대로 남는다. 즉 이 Task가 live base를 몰래 바꾸지 않는다.
- 두 CronWorkflow는 `Asia/Seoul`, `suspend: true`, 같은 WorkflowTemplate을 참조한다.
- DAG command는 `apps/dataplane/src/eatbid/cli.py::COMMANDS`에 실제 존재하는 다섯 단계와 정확히 같다.
- `build-marts`, `verify`, 자동 retry exit `74`는 구현 전이므로 manifest에 없다.
- replay/backfill은 schedule 없이 별도 manual template entrypoint다.
- source semaphore capacity는 1, project mutex는 `eatbid-core-publication`이다.
- 모든 dataplane step은 같은 digest를 쓰며 dedicated ServiceAccount와 Secret refs만 사용한다.
- migration Job은 exact migration digest, Argo CD `PreSync`, finite deadline/backoff, Secret `DATABASE_URL`을 쓴다.
- product image 선언/소비/CI promotion 대상은 web/server/dataplane/migration 정확히 네 개다.
- product render에는 literal PostgreSQL URL/password가 없다.
- 기존 `infra/argocd/application.yaml`은 계속 `infra/k8s/base`를 가리킨다.

- [ ] **Step 2: manifests가 없어 실패하는지 확인**

Run: `python -m pytest infra/tests/test_workflow_contract.py -q`

Expected: FAIL because product WorkflowTemplate is absent.

- [ ] **Step 3: platform Argo CD Application 구현**

Helm repository `https://argoproj.github.io/argo-helm`, chart `argo-workflows`, chart version `1.0.23`을
pin한다. controller는 `eatbid` namespace workflow만 실행하고 server/UI는 disabled, workflow archive,
Argo Events, bundled MinIO는 disabled다. CRD는 full validation과 keep policy를 사용한다. 이 파일은
platform 설치 선언일 뿐 기존 product Application의 resource/path에 연결하지 않는다.

- [ ] **Step 4: Secret 계약과 migration hook 구현**

`infra/product/secret-contract.md`에는 실제 값이 아니라 필요한 Secret 이름/key/소비자/주입 책임만
기록한다. DB, R2, auth/share/tunnel, GHCR pull 계약을 포함한다. base의 literal PostgreSQL password와
server `DATABASE_URL`은 product overlay에서 Secret ref로 patch한다.

`infra/product/migration.yaml`은 `eatbid-migration` 이미지를 쓰는 Argo CD `PreSync` Job이다.
`DATABASE_URL`은 Secret ref, `restartPolicy: Never`, finite `activeDeadlineSeconds`/`backoffLimit`을 갖는다.
Task 11 CI promotion이 네 번째 migration digest도 product kustomization에서 실제 pin하도록 수정한다.

- [ ] **Step 5: dormant WorkflowTemplate 구현**

모든 step은 같은 digest-pinned dataplane image를 쓰고 대용량 artifact payload가 아니라 run/observation
ID만 parameter로 전달한다. durable state는 PostgreSQL/R2다. source semaphore ConfigMap 값은 `1`,
project step mutex는 `eatbid-core-publication`이다. scheduled DAG는 정확히
`discover → capture → normalize → validate → project`다. `replay`는 자체 normalize/validate/project
흐름을 소유하는 별도 수동 entrypoint다.

현 CLI가 정의한 exit code는 64/65/75/76뿐이고 모든 command가 현재 64를 반환하는 placeholder다.
따라서 이 Task는 거짓 transient `74` retry 정책을 추가하지 않는다. transient category가 Task 14 이후
구현되고 동작 테스트가 생긴 뒤에만 bounded retry를 도입한다.

- [ ] **Step 6: suspended CronWorkflow와 legacy delete overlay 구현**

`poll-open`은 평일 `Asia/Seoul` 08:00–19:59에 30분 간격, `daily-reconcile`은 매일 07:00에
실행한다. 두 schedule은 동일 template을 `mode` parameter만 달리 호출한다. backfill/replay에는
schedule을 만들지 않고 운영자가 WorkflowTemplate을 제출한다. 두 CronWorkflow는 반드시
`spec.suspend: true`로 커밋한다. Task 14가 production composition root를 완성하고 manual run evidence를
만들기 전에는 활성화하지 않는다.

product overlay는 기존 `../k8s/base`를 임시로 포함하되 `daily-refresh`, `poll-open-day`,
`poll-open-off`, `poll-open-weekend` 네 CronJob을 delete patch로 제거한다. live base 파일은 변경하지 않는다.

- [ ] **Step 7: 렌더·정책 테스트**

Run: `kubectl kustomize infra/product > $null; python -m pytest infra/tests/test_workflow_contract.py -q`

Expected: Kustomize exit 0; exact WorkflowTemplate/CronWorkflow/migration/Secret/image contracts PASS;
product native CronJob/hostPath/literal credential 0; base legacy CronJob 4.

- [ ] **Step 8: 커밋**

```bash
git add .github/workflows/build.yml infra/platform infra/product infra/tests
git commit -m "ops: run dataplane with Argo Workflows"
```

---

### Task 13: 첫 수직 슬라이스 검증과 foundation gate

**Files:**
- Create: `apps/dataplane/tests/integration/test_foundation_slice.py`
- Modify: `apps/dataplane/tests/integration/conftest.py`
- Create: `docs/operations/data-foundation-runbook.md`
- Create: `docs/operations/data-foundation-gate.md`
- Modify: `docs/architecture/runtime-and-deployment.md`

**Interfaces:**
- Consumes: Tasks 1–12 전체.
- Produces: 한 fixture의 raw→observation→normalized→publication→core→replay 증거와 운영 runbook.

- [ ] **Step 1: end-to-end acceptance test 작성**

```python
def test_raw_to_core_and_replay_foundation_slice(foundation) -> None:
    result = foundation.run_fixture("eat/bid-detail-one.xml", expected_count=1)
    assert result.raw_blob_count == 1
    assert result.observation_count == 1
    assert result.publication_status == "published"
    assert result.organization_count == 1
    assert result.auction_attempt_count == 1
    assert result.auction_revision_count == 1
    replay = foundation.replay(result.observation_ids, parser_version="eat-v1")
    assert replay.canonical_fingerprint == result.canonical_fingerprint
```

- [ ] **Step 2: 전체 wiring 전 실패 확인**

Run: `cd apps/dataplane && uv run pytest tests/integration/test_foundation_slice.py -q`

Expected: FAIL with `fixture 'foundation' not found`.

- [ ] **Step 3: adapter-injected foundation composition 완성**

이 Task는 아직 존재하지 않는 eaT production transport를 꾸며내지 않는다. production과 test가 같은
pipeline orchestration을 쓰도록 `foundation.py`가 raw store, source client, clock, PostgreSQL repository를
명시적으로 주입받아 한 detail fixture의 start/plan/capture/normalize/validate/project/replay를 조립한다.
Test는 `MemoryRawObjectStore`와 fake source client를 사용하지만 pipeline/repository/projector를 복제하지
않는다. 실제 R2/httpx/CLI/Argo composition은 Task 14가 소유한다.

같은 step에서 integration `conftest.py`에 다음 contract의 `FoundationHarness`와 `foundation` fixture를
추가한다.

```python
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from eatbid.pipeline.replay import ReplayResult


@dataclass(frozen=True)
class FoundationResult:
    raw_blob_count: int
    observation_count: int
    publication_status: str
    organization_count: int
    auction_attempt_count: int
    auction_revision_count: int
    observation_ids: Sequence[int]
    canonical_fingerprint: str


class FoundationHarness(Protocol):
    def run_fixture(self, relative_path: str, *, expected_count: int) -> FoundationResult: ...

    def replay(self, observation_ids: Sequence[int], *, parser_version: str) -> ReplayResult: ...
```

- [ ] **Step 4: runbook과 gate 작성**

Runbook에는 uniquely owned local PostgreSQL 시작, migration, fixture capture, replay, quarantine 확인,
publication count 확인, rollback 없이 active publication을 유지하는 실패 복구 명령을 exact command로
기록한다. Task 14 전에는 Argo/source 명령이 dormant라는 사실과 절대 활성화하지 않는 명령을 명시한다.
Gate에는 raw key/hash, `TOT_CNT`, row counts, replay fingerprint, migration version, image digest와
Task 14 이후 붙일 Workflow/source evidence 칸을 구분한다.

- [ ] **Step 5: 전체 검증 실행**

Run: `pnpm test && pnpm build`

Run: `cd apps/dataplane && uv run pytest --cov=eatbid --cov-fail-under=90 -q && uv run ruff check src tests && uv run pyright src`

Run: render `kubectl kustomize infra/product` once, parse every YAML document, and assert the rendered
kind set contains no `CronJob` and no pod spec contains `hostPath` or literal PostgreSQL credentials.

Expected: TS/Python build/tests PASS, dataplane coverage at least 90%, Kustomize exit 0, rendered policy
assertions PASS. Source grep is not evidence because `infra/product` imports `../k8s/base` transitively and
relies on delete patches.

- [ ] **Step 6: architecture conformance 확인**

Run: `git grep -nE "db:push|configMapGenerator:.*schema|split_part\(.*school_id|hostPath:" -- package.json packages apps/dataplane infra/product`

Expected: no matches.

- [ ] **Step 7: 커밋**

```bash
git add apps/dataplane docs/operations docs/architecture/runtime-and-deployment.md
git commit -m "test: prove replayable data foundation slice"
```

---

### Task 14: 검증된 eaT transport·discovery·CLI·Argo 수동 실행 경계

Task 13의 fixture vertical slice가 통과한 뒤 별도 상세 TDD plan/리뷰로 실행한다. 현재 새 dataplane에는
parser, R2, PostgreSQL projection/replay가 있지만 `discover`와 실제 eaT HTTP transport는 placeholder다.
`F:\Project\eat_croll`의 legacy crawler와 `docs/audit-source`는 소스 접근 지식 조사 자료이지 복사할
architecture나 데이터 authority가 아니다.

**Required design:**

- `source/eat` 아래에 Pydantic 설정, deterministic Nexacro request builder, `httpx` transport,
  list discovery adapter를 분리한다. URL은 exact HTTPS host allowlist, connect/read/total timeout,
  payload size limit, bounded single-source concurrency를 가진다.
- hardcoded analytics/session cookies, browser version 위장, MongoDB write, legacy field cleanup/추측 mapping을
  이식하지 않는다. session bootstrap이 필요하면 transport가 fresh cookie jar를 얻고 secret/log에 cookie를
  남기지 않는다.
- list page도 raw evidence다. `discover`가 list response를 R2에 archive한 뒤에만 `TOT_CNT`, page count,
  `ETN_BID_ID`를 해석하고 detail request units를 plan한다. page 누락, count 불일치, duplicate ID,
  unreviewed dataset/column drift는 deterministic `SOURCE_CONTRACT`이며 detail/core를 부분 발행하지 않는다.
- `capture`는 DB에 동결된 detail request unit만 읽어 immutable R2 object+observation을 기록한다.
  normalize/validate/project는 같은 run ledger로 다음 상태만 선택하며 CLI 인수나 임시 파일로 payload를
  넘기지 않는다.
- run window/as-of/mode/source endpoint/pagination params를 명시적으로 저장한다. wall clock으로 같은 run의
  요청 범위를 다시 계산하지 않는다.
- 각 CLI command는 성공/실패 모두 stdout에 JSON 한 줄로 run_id, build_sha, parser_version, source,
  endpoint, counts, duration_ms, status/failure_category를 남긴다. stderr/log에도 raw body, cookie,
  credential, 전체 URL query를 기록하지 않는다.
- 403/429는 typed `SOURCE_THROTTLED` exit 75, schema/HTTP contract는 exit 76, quarantine은 65,
  config/usage는 64다. idempotent transient 분류와 bounded test가 생기기 전 blanket retry를 추가하지 않는다.
- WorkflowTemplate은 explicit as-of/window를 전달하고 source semaphore 하나를 공유한다. manual dry run
  evidence 전 CronWorkflow는 계속 suspend하며 live source/R2/Argo 실행은 별도 사용자 승인 gate다.

**Acceptance boundary:**

- `httpx.MockTransport` fixture로 session/list pagination/detail 요청과 archive-before-parse 순서를 증명한다.
- list/detail source contract와 schema fingerprint가 reviewed registry에 있고 leading-zero code/ID를 text로
  보존한다.
- same run 재실행은 planned unit/raw blob/core revision을 중복 생성하지 않고 lawful partial checkpoint만
  재개한다.
- 실제 source를 호출하지 않는 offline gate에서 CLI 6개와 Argo render 계약이 통과한다.
- 승인된 manual run이 있을 때만 source request budget, raw R2 key/hash, PostgreSQL counts, Workflow status를
  gate에 첨부한다. 승인 없이는 task capability와 external execution evidence를 구분해 보고한다.

---

### Task 15: canonical 행정구역·시간축·좌표·market mart foundation

이 Task는 Task 14의 production source boundary가 통과한 뒤 별도 상세 TDD plan/리뷰로 실행한다. 2026-08-29
legacy `/api/market?category=축산` 실측은 225행 중 66행이 좌표와 매칭되지 않았고, 그중 64행은
`시도 미상|시군구`, 2행은 인천 행정구역/2017 좌표 스냅샷의 시간축 불일치였다. 이는 프론트 좌표표
누락이 아니라 upstream identity 유실이다.

**Required design:**

- 내부 `administrative_area_id bigint`와 MOIS/source별 `CodeValue`를 연결한다.
- 부모/자식 행정구역 계층, 유효기간, 개편 전후 `successor/overlaps` 관계를 근거와 함께 보존한다.
- 중심좌표는 area의 영구 속성으로 덮어쓰지 않고 source, evidence, observed/effective time,
  coordinate reference system, derivation method, review status가 있는 observation으로 관리한다.
- market mart grain은 문자열 `(sido, sigungu, category)`가 아니라
  `(mart_build_id, administrative_area_id, taxonomy_term_id)`다.
- `시도 미상` legacy aggregate를 이름만 보고 추정하지 않는다. auction revision의 eaT location code,
  구매기관의 검증된 identifier, reviewed code mapping으로 재구축하며 근거가 없으면 quarantine한다.
- 현재 `apps/web/src/lib/region-coords.ts`는 새 API cutover 전까지 legacy adapter일 뿐 SSOT가 아니다.
- 중심점 반환만 필요한 단계에서는 numeric latitude/longitude로 시작한다. 경계 포함, 반경, 공간조인
  요구와 실행계획 증거가 생기기 전에는 PostGIS를 추가하지 않는다.

**Acceptance boundary:**

- canonical/mart 관계와 API payload에는 지역명 합성키가 없다.
- 행정구역 개편 전후 snapshot을 같은 현재 좌표로 덮어쓰지 않는다.
- ambiguous label-only input은 deterministic quarantine이고 `북구` 같은 값을 임의 시도에 배정하지 않는다.
- 같은 source release/evidence/computation version으로 mart rebuild 결과가 동일하다.
- legacy market의 66행은 근거 기반 canonical area로 복구되거나 명시적 unresolved evidence로 집계되며,
  UI에서 조용히 사라지지 않는다.

---

### Task 16: NestJS·Effect backend application foundation

Task 15까지의 canonical data/mart boundary가 고정된 후 별도 상세 TDD plan과 독립 리뷰로 실행한다.
지배 설계는 [ADR 0016](../../adr/0016-nest-effect-application-boundary.md)과
[backend-application-foundation.md](../../architecture/backend-application-foundation.md)다.

**Required design:**

- exact supported Node 24 LTS patch에서 Nest 12 common/core/platform/CLI/config/swagger/testing을 같은
  release lane으로 올리고 frozen lock/build/schematic compatibility를 증명한다.
- `effect@4.0.0-rc.112`를 exact pin한 compatibility spike를 먼저 수행한다. Nest가 DI/resource lifecycle을
  소유하고 singleton `EffectRunner`만 fully-provided use-case Effect를 실행한다. request마다 Runtime/Layer를
  만들거나 `runPromise`를 산재시키지 않는다.
- root `AppModule`은 import-only composition root로 줄인다. 새 canonical vertical slice를
  `presentation/http → application → domain/infrastructure`로 만들고 기존 controller는
  `LegacyApiModule`에 격리한다.
- `DatabaseModule`은 typed config로 Drizzle/postgres-js client를 만들고 shutdown에서 닫는다.
  `packages/db`만 DDL을 소유하며 purpose-specific repository와 명시적 `UnitOfWork`를 둔다.
- Nest 12 Standard Schema + bounded Zod 4 contracts로 request/response를 검증한다. `nestjs-zod`를 제거하고
  deterministic OpenAPI 3.0.3 artifact/stable operation ID/diff gate를 만든다.
- middleware=request context, pipe=validation, guard=authz, interceptor=timing/log/serialization,
  filter=RFC 9457 error mapping이라는 책임을 지킨다. business rule을 guard/interceptor에 숨기지 않는다.
- `@nestjs/config`+Zod로 production fallback 없는 fail-fast config를 만들고, built-in JSON logger,
  correlation ID, sensitive-field redaction, Helmet, exact CORS/trusted proxy/payload limit, selected endpoint
  throttling을 적용한다. 현재 Nest 12 peer가 없는 `@nestjs/terminus`, `@nestjs/throttler`,
  `nestjs-pino`는 override 설치하지 않고 각각 작은 health module, 배포 경계 rate-limit adapter,
  Nest built-in JSON logger를 사용한다.
- Better Auth raw handler를 body parser 전에 연결하고 global session guard + public/optional-auth metadata로
  인증 실패와 dependency 장애를 구분한다. Nest 12 peer support가 없는 community bridge는 쓰지 않는다.
- `/health/live`와 DB+expected migration `/health/ready`, shutdown hook과 inflight grace를 구현한다.
  Swagger UI는 dev-only, production은 off/authenticated다.

**Acceptance boundary:**

- architecture test에서 controller→Drizzle, domain→Nest/Drizzle, cross-module internal import, cycle이 0건이다.
- config missing/malformed/fallback, request/response schema, OpenAPI artifact, 400/401/403/404/409/429/503/500
  Problem Details, log redaction/correlation, auth raw transport, repository UoW, health/shutdown이 자동 검증된다.
- 새 endpoint는 DB row나 legacy shared schema를 public DTO로 노출하지 않고 string relational key를 쓰지 않는다.
- legacy와 canonical 경로 사이에 dual-write가 없고 local user service를 재시작/변경하지 않는다.

---

### Task 17: 사용자와 공동 프론트 코드스멜 감사·제품/UI 기획 gate

Task 16까지 완료된 후 시작한다. 이 Task는 자동 구현 단계가 아니다. 먼저 현재 frontend의 component,
state/data-fetching, route, contract duplication, accessibility/performance code smell을 근거와 함께 감사한다.
그 결과와 canonical API를 놓고 사용자와 함께 화면 목표,
입찰분석 의사결정 흐름, 정보 우선순위, canonical URL/API ID, 지역/학교/기관 탐색, 시장 지도,
source-observed 대 inferred 표기를 먼저 기획하고 승인된 spec을 만든다. **사용자 승인 전에는 프론트
코드, route, API response shape, 디자인 시스템을 변경하지 않는다.**

---

## Foundation Completion Gate

이 계획은 다음 증거가 모두 있을 때만 완료다.

- 한 실제 eaT fixture의 raw response가 parse 전에 R2-compatible object로 저장된다.
- 같은 bytes 재수집은 raw blob 1개와 observation N개를 만든다.
- `TOT_CNT` 불일치 run은 active publication과 `core`를 바꾸지 않는다.
- Organization/AuctionAttempt 내부 관계에 이름·주소·복합 문자열 FK가 없다.
- eaT 시도/시군구/참가제한은 서로 다른 `CodeValue` bigint 관계로 revision에 연결되고
  MOIS/NEIS mapping이나 학교 type을 추측해 만들지 않는다.
- canonical revision은 exact `normalized_record_id`로 해석 provenance를 가지며 publication은
  natural-key/payload-hash fingerprint를 저장한다.
- 동일 raw+parser version replay fingerprint가 동일하다.
- 빈 PostgreSQL이 committed Drizzle migration만으로 생성된다.
- web/server/dataplane/migration image가 한 Git SHA와 immutable digest를 가진다.
- Argo Workflows만 dataplane을 예약하며 product manifests에 native CronJob이 없다.
- eaT list/detail transport가 list raw archive-before-parse, frozen request plan, count/schema gate를 지키고
  CLI/Workflow가 DB run ID로 같은 stage를 재개한다. live source 실행 여부는 별도 evidence로 표시한다.
- market/geography 관계는 canonical 행정구역 bigint와 evidence-backed valid time을 쓰며 ambiguous
  label-only 입력을 임의 좌표에 붙이지 않는다.
- server는 Nest/Effect/Drizzle의 단일 lifecycle·의존 방향을 지키며 controller가 DB를 직접 호출하지
  않고, bounded Zod contract/OpenAPI artifact/RFC 9457/log redaction/guard/health/shutdown gate를 통과한다.
- 기존 legacy reader/writer는 아직 제거하지 않지만 새 foundation에 dual-write하지 않는다.

Foundation 완료 뒤 canonical domain expansion 계획은 실제 quarantine/code coverage 보고서를 입력으로
작성한다. 수치가 없는 추측으로 submission/award/region mapping 범위를 확장하지 않는다.
