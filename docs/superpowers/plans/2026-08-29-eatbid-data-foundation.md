# eatbid Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 source fixture를 archive-before-parse로 R2 호환 저장소에 보존하고, 실행 완전성을 검증해 새 PostgreSQL `core`의 Organization/AuctionAttempt revision으로 원자 발행한 뒤 동일 raw를 결정적으로 replay하는 첫 수직 슬라이스를 만든다.

**Architecture:** `apps/dataplane`의 단일 Python CLI가 discover/capture/normalize/validate/project/replay 단계를 제공하고, `packages/db`의 Drizzle migration만 `ingest/core/app/mart` DDL을 소유한다. Argo Workflows가 같은 CLI를 정기·백필·재처리 모드로 실행하며 Argo CD는 controller와 WorkflowTemplate만 배포한다.

**Tech Stack:** Node.js 24+, pnpm 10.12.1, Turborepo 2.5, TypeScript 5.7, Drizzle ORM/Kit 1.0.0-rc.4, Python 3.12+, uv, Pydantic 2, psycopg 3, httpx, boto3, pytest, Ruff, Pyright, PostgreSQL 16, R2 S3 API, Argo Workflows 4.0.8 via argo-workflows Helm chart 1.0.23, Argo CD.

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
| `apps/dataplane/src/eatbid/ingest/repository.py` | run/request/blob/observation/publication DB adapter |
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
| `.github/workflows/build.yml` | TS/Python test, migration check, 세 image build와 digest 갱신 |

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
- Create: `packages/db/src/schema/codes.ts`
- Create: `packages/db/src/schema/organizations.ts`
- Create: `packages/db/src/schema/procurement.ts`
- Create: `packages/db/src/schema/canonical.test.ts`
- Create: `packages/db/src/seeds/code-schemes.ts`
- Create: `packages/db/src/seeds/code-schemes.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/20260829001000_core_identity/migration.sql`
- Create: `packages/db/drizzle/20260829001000_core_identity/snapshot.json`

**Interfaces:**
- Consumes: `coreSchema`, `rawObservation.observationId`.
- Produces: bigint domain IDs and source-scoped external identifier constraints used by projector Task 9.

- [ ] **Step 1: 문자열 identity가 거부되는 schema test 작성**

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

- [ ] **Step 2: 새 exports가 없어 실패하는지 확인**

Run: `bun test packages/db/src/schema/canonical.test.ts`

Expected: FAIL because `organization` and `auctionAttempt` are not exported.

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

- [ ] **Step 4: 최소 canonical tables 구현**

| Table | Identity and required fields |
|---|---|
| `core.organization` | `organization_id bigint identity`; type, canonical_name, created_at |
| `core.organization_identifier` | bigint PK; organization FK, scheme FK, code text, observation FK; unique(scheme_id, code) |
| `core.auction_attempt` | `auction_attempt_id bigint identity`; source_system, external_bid_id, display_bid_no; unique(source_system, external_bid_id) |
| `core.auction_revision` | bigint PK; attempt FK, observation FK, content_sha256, source_status, title, announced/deadline/opened timestamps, base/planned amounts, currency, source_payload jsonb; unique(attempt_id, content_sha256) |
| `core.auction_organization` | attempt FK, organization FK, role; composite PK(attempt_id, organization_id, role) |

`source_payload`는 감사용 normalized snapshot이며 분석 결과를 담지 않는다. `canonical_name`과
`display_bid_no`에는 unique constraint를 두지 않는다.

- [ ] **Step 5: migration과 constraint 테스트 통과**

Run: `pnpm --filter @eatbid/db db:generate && bun test packages/db/src/schema/canonical.test.ts packages/db/src/seeds/code-schemes.test.ts`

Expected: generated migration contains seven code/domain tables, bigint PKs, source-scoped unique keys.

- [ ] **Step 6: 커밋**

```bash
git add packages/db
git commit -m "feat: add source-scoped canonical identity schema"
```

---

### Task 5: DDL 실행기와 운영 `db:push` 제거

**Files:**
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/version.ts`
- Create: `packages/db/src/version.test.ts`
- Create: `packages/db/Dockerfile`
- Modify: `packages/db/package.json`
- Modify: `package.json`
- Modify: `packages/shared/package.json`
- Modify: `infra/k8s/base/kustomization.yaml`

**Interfaces:**
- Consumes: committed migrations from Tasks 3–4 and `DATABASE_URL`.
- Produces: `migrate(): Promise<void>`, `assertSchemaVersion(db, expected): Promise<void>`, migration image.

- [ ] **Step 1: expected migration version 실패 테스트 작성**

```typescript
import { describe, expect, test } from "bun:test";
import { expectedMigration } from "./version";

describe("schema version", () => {
  test("is pinned to the committed foundation migration", () => {
    expect(expectedMigration).toBe("20260829001000_core_identity");
  });
});
```

- [ ] **Step 2: version export가 없어 실패하는지 확인**

Run: `bun test packages/db/src/version.test.ts`

Expected: FAIL because `./version` does not exist.

- [ ] **Step 3: migration/version 구현**

```typescript
export const expectedMigration = "20260829001000_core_identity" as const;
```

`migrate.ts`는 `postgres` client와 `drizzle-orm/postgres-js/migrator`의 `migrate`를 사용하고
`packages/db/drizzle`만 읽은 뒤 `seedCodeSchemes(db)`를 실행한다. 성공 시 적용된 migration ID를
출력하고 실패 시 nonzero exit한다.

- [ ] **Step 4: 중복 DDL 경로 제거**

Root와 `packages/shared`에서 `db:push` script를 제거한다. `infra/k8s/base/kustomization.yaml`에서
`db-schema` ConfigMap generator를 제거한다. `schema.sql` 파일 자체의 삭제는 cutover plan까지
미루되 어떤 active manifest에서도 참조되지 않게 한다.

- [ ] **Step 5: 빈 PostgreSQL에 migration chain 적용**

Run: `docker compose -f docker-compose.dev.yml up -d postgres && pnpm --filter @eatbid/db db:migrate && pnpm --filter @eatbid/db db:check`

Expected: `ingest`, `core`, `app`, `mart` schema가 생성되고 version check exit 0.

- [ ] **Step 6: 커밋**

```bash
git add package.json packages/shared/package.json packages/db infra/k8s/base/kustomization.yaml
git commit -m "build: make committed migrations the only DDL path"
```

---

### Task 6: content-addressed raw object store

**Files:**
- Create: `apps/dataplane/src/eatbid/object_store.py`
- Create: `apps/dataplane/src/eatbid/r2_store.py`
- Create: `apps/dataplane/tests/unit/test_object_store.py`
- Create: `apps/dataplane/tests/unit/fakes.py`

**Interfaces:**
- Consumes: raw `bytes`, source, endpoint.
- Produces: `StoredRawObject(content_sha256: str, object_key: str, byte_length: int, stored_at: datetime)` and `RawObjectStore.put(*, source: str, endpoint: str, body: bytes) -> StoredRawObject`.

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
    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject:
        raise NotImplementedError
```

SHA-256은 HTTP response body 원본 bytes에 계산한다. gzip은 `mtime=0`으로 만들고 key는
`raw/{source}/{endpoint}/{sha256}.xml.gz`다. source/endpoint는 `[a-z0-9-]+`만 허용한다.

- [ ] **Step 4: R2 adapter 구현**

`R2RawObjectStore`는 `R2_ENDPOINT_URL`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` 설정을 받고 boto3 S3 client로 gzip body를 put한다. 동일 key가 있으면
HEAD로 byte length/metadata hash를 확인하고 같은 object만 성공으로 취급한다. metadata
`source-sha256`가 다르면 `ObjectCollisionError`를 발생시킨다.

- [ ] **Step 5: 단위 테스트와 type/lint 통과**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_object_store.py -q && uv run ruff check src tests && uv run pyright src`

Expected: PASS, no lint/type errors.

- [ ] **Step 6: 커밋**

```bash
git add apps/dataplane
git commit -m "feat: archive raw responses by content hash"
```

---

### Task 7: run ledger와 archive-before-parse capture

**Files:**
- Create: `apps/dataplane/src/eatbid/ingest/models.py`
- Create: `apps/dataplane/src/eatbid/ingest/repository.py`
- Create: `apps/dataplane/src/eatbid/source/client.py`
- Create: `apps/dataplane/src/eatbid/pipeline/capture.py`
- Create: `apps/dataplane/tests/integration/conftest.py`
- Create: `apps/dataplane/tests/integration/test_capture.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`

**Interfaces:**
- Consumes: `RawObjectStore`, PostgreSQL migration, `SourceClient.fetch(request) -> SourceResponse`.
- Produces: `capture(request: CaptureRequest, store, repository, client) -> CapturedObservation` and pytest fixtures `migrated_db`, `pipeline_services`.

- [ ] **Step 1: 저장 순서를 증명하는 실패 테스트 작성**

```python
from datetime import UTC, datetime
from unittest.mock import Mock
from uuid import UUID

from eatbid.ingest.models import CaptureRequest
from eatbid.object_store import StoredRawObject
from eatbid.pipeline.capture import capture
from eatbid.source.client import SourceResponse


def test_capture_archives_before_recording_observation() -> None:
    events: list[str] = []
    store = Mock()
    store.put.side_effect = lambda **_: (
        events.append("object_stored")
        or StoredRawObject("a" * 64, "raw/eat/bid-list/" + "a" * 64 + ".xml.gz", 42, datetime.now(UTC))
    )
    repo = Mock()
    repo.record_observation.side_effect = lambda **_: events.append("observation_recorded")
    client = Mock()
    client.fetch.return_value = SourceResponse(200, b"<result><TOT_CNT>1</TOT_CNT></result>", datetime.now(UTC))
    request = CaptureRequest(UUID("00000000-0000-0000-0000-000000000001"), "eat", "bid-list", {})
    capture(request, store, repo, client)
    assert events == ["object_stored", "observation_recorded"]
```

- [ ] **Step 2: pipeline module이 없어 실패하는지 확인**

Run: `cd apps/dataplane && uv run pytest tests/integration/test_capture.py -q`

Expected: FAIL on import.

- [ ] **Step 3: exact ports와 models 구현**

```python
@dataclass(frozen=True)
class CaptureRequest:
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

Repository는 `start_run`, `plan_request_unit`, `record_observation`, `fail_run`을 제공한다.
request params는 key 정렬 canonical JSON으로 저장하고 SHA-256을 unique key에 쓴다.

- [ ] **Step 4: capture use case와 CLI wiring 구현**

`capture`는 source 응답을 받은 뒤 `store.put` 성공 전에는 repository를 호출하지 않는다.
R2 성공 후 한 DB transaction에서 raw blob upsert와 observation insert를 수행한다. HTTP 403/429는
`SOURCE_THROTTLED=75`, source contract는 `SOURCE_CONTRACT=76`, configuration은 64로 매핑한다.

- [ ] **Step 5: PostgreSQL integration test와 재실행 테스트**

Run: `cd apps/dataplane && $env:DATABASE_URL='postgres://eatbid:eatbid@localhost:5434/eatbid'; uv run pytest tests/integration/test_capture.py -q`

Expected: 동일 body 두 번 capture 시 raw_blob 1행, raw_observation 2행, event order test PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/dataplane
git commit -m "feat: record append-only source observations"
```

---

### Task 8: eaT payload normalization과 완전성 gate

**Files:**
- Create: `apps/dataplane/src/eatbid/source/eat/models.py`
- Create: `apps/dataplane/src/eatbid/source/eat/normalize.py`
- Create: `apps/dataplane/src/eatbid/pipeline/validate.py`
- Create: `apps/dataplane/tests/fixtures/eat/bid-list-one.xml`
- Create: `apps/dataplane/tests/fixtures/eat/bid-detail-one.xml`
- Create: `apps/dataplane/tests/unit/test_eat_normalize.py`
- Create: `apps/dataplane/tests/unit/test_completeness.py`
- Modify: `apps/dataplane/tests/integration/conftest.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`

**Interfaces:**
- Consumes: raw observation body and parser version.
- Produces: `NormalizedAuction`, `CompletenessReport`, normalized_record rows and pytest fixtures `validated_publication`, `observation_id`; never domain IDs.

- [ ] **Step 1: leading-zero code와 unknown 보존 실패 테스트 작성**

```python
from pathlib import Path

from eatbid.source.eat.normalize import normalize_bid_detail


def test_normalize_preserves_source_codes_as_text() -> None:
    fixture = Path(__file__).parents[1] / "fixtures/eat/bid-detail-one.xml"
    record = normalize_bid_detail(fixture.read_bytes(), parser_version="eat-v1")
    assert record.external_bid_id == "E230727-158202-0"
    assert record.organization_code == "00123456"
    assert record.sigungu_code == "00110"
    assert record.eligibility_codes == ("11000",)
    assert record.category_source == "unknown"
```

- [ ] **Step 2: TOT_CNT 불일치 실패 테스트 작성**

```python
from eatbid.pipeline.validate import validate_completeness


def test_publication_is_rejected_when_tot_count_differs() -> None:
    report = validate_completeness(expected=2, observed=1, quarantined=0)
    assert report.publishable is False
    assert report.failure_category == "SOURCE_CONTRACT"
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_eat_normalize.py tests/unit/test_completeness.py -q`

Expected: FAIL because normalizer and validator do not exist.

- [ ] **Step 4: Pydantic models와 normalizer 구현**

```python
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


class NormalizedAuction(BaseModel):
    model_config = ConfigDict(frozen=True)
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
    category_source: Literal["source_field", "inferred_from_title", "unknown"]


@dataclass(frozen=True)
class CompletenessReport:
    expected: int
    observed: int
    quarantined: int
    publishable: bool
    failure_category: str | None
```

빈 문자열은 `None`으로 정규화하지만 code의 leading zero와 source label은 보존한다.
주소/기관명/공고명에서 code를 추론하지 않는다. 이 foundation parser는 품목을 추론하지 않으므로
fixture의 `category_source`는 `unknown`이다.

- [ ] **Step 5: normalize/validate repository wiring 구현**

normalize는 `(observation_id, record_type, source_entity_id, parser_version)` 멱등 key로 staging에
쓴다. validate는 request unit별 `expected_count == observed_count`, quarantine 0,
source entity ID 중복 0, 필수 code scheme 존재를 모두 확인한 경우에만 publication을
`validated`로 전환한다.

- [ ] **Step 6: fixture/contract tests 통과**

Run: `cd apps/dataplane && uv run pytest tests/unit/test_eat_normalize.py tests/unit/test_completeness.py -q`

Expected: PASS; fixture에서 code는 text로 보존되고 category는 추측되지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add apps/dataplane
git commit -m "feat: validate typed eaT observations"
```

---

### Task 9: canonical projector와 deterministic replay

**Files:**
- Create: `apps/dataplane/src/eatbid/core/repository.py`
- Create: `apps/dataplane/src/eatbid/pipeline/project.py`
- Create: `apps/dataplane/src/eatbid/pipeline/replay.py`
- Create: `apps/dataplane/tests/integration/test_project.py`
- Create: `apps/dataplane/tests/integration/test_replay.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`

**Interfaces:**
- Consumes: validated `publication_id`, normalized records, code registry.
- Produces: `ProjectResult(publication_id, attempts_inserted, revisions_inserted, organizations_inserted)` and replay run.

- [ ] **Step 1: projector 멱등성 실패 테스트 작성**

```python
from eatbid.pipeline.project import project_publication


def test_projecting_same_observation_twice_adds_no_revision(migrated_db, validated_publication) -> None:
    first = project_publication(migrated_db, validated_publication)
    second = project_publication(migrated_db, validated_publication)
    assert first.attempts_inserted == 1
    assert first.revisions_inserted == 1
    assert second.attempts_inserted == 0
    assert second.revisions_inserted == 0
```

- [ ] **Step 2: replay 결정성 실패 테스트 작성**

```python
from eatbid.pipeline.replay import replay_observations


def test_replay_same_raw_and_version_has_same_fingerprint(pipeline_services, observation_id) -> None:
    first = replay_observations(pipeline_services, [observation_id], parser_version="eat-v1")
    second = replay_observations(pipeline_services, [observation_id], parser_version="eat-v1")
    assert first.canonical_fingerprint == second.canonical_fingerprint
```

- [ ] **Step 3: tests가 missing implementation으로 실패하는지 확인**

Run: `cd apps/dataplane && uv run pytest tests/integration/test_project.py tests/integration/test_replay.py -q`

Expected: FAIL on missing project/replay imports.

- [ ] **Step 4: projector transaction 구현**

```python
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ProjectResult:
    publication_id: UUID
    attempts_inserted: int
    revisions_inserted: int
    organizations_inserted: int
    canonical_fingerprint: str
```

한 transaction에서 다음 순서를 지킨다.

1. `core.organization_identifier(scheme_id, code)`로 Organization을 resolve/insert한다.
2. `(source_system, external_bid_id)`로 AuctionAttempt를 resolve/insert한다.
3. `(auction_attempt_id, content_sha256)`로 AuctionRevision을 insert-on-conflict-do-nothing한다.
4. AuctionOrganization role `purchaser`를 upsert한다.
5. 모든 normalized record 처리 후 publication count가 검증 count와 같을 때만 publication을
   `published`로 바꾸고 `activated_at`을 기록한다.

중간 오류는 transaction 전체를 rollback하고 run/publication을 failed로 기록한다.

- [ ] **Step 5: replay 구현**

```python
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ReplayResult:
    run_id: UUID
    publication_id: UUID
    canonical_fingerprint: str
```

replay는 observation ID 목록과 parser version을 받아 R2 raw를 읽고 새 run/publication 아래에서
normalize→validate→project를 호출한다. output fingerprint는 정렬된
`(source_system, external_bid_id, revision content_sha256)` JSON의 SHA-256이다.

- [ ] **Step 6: integration tests와 전체 dataplane tests 통과**

Run: `cd apps/dataplane && uv run pytest -q && uv run ruff check src tests && uv run pyright src`

Expected: all tests PASS; rerun row counts unchanged; replay fingerprints equal.

- [ ] **Step 7: 커밋**

```bash
git add apps/dataplane
git commit -m "feat: publish and replay canonical auction revisions"
```

---

### Task 10: CI에서 migration·dataplane·세 이미지 검증

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

### Task 11: Argo Workflows platform과 product template

**Files:**
- Create: `infra/platform/argo-workflows.application.yaml`
- Create: `infra/product/kustomization.yaml`
- Create: `infra/product/workflows/serviceaccount.yaml`
- Create: `infra/product/workflows/semaphore.yaml`
- Create: `infra/product/workflows/workflow-template.yaml`
- Create: `infra/product/workflows/poll-open.yaml`
- Create: `infra/product/workflows/daily-reconcile.yaml`
- Create: `infra/product/workflows/kustomization.yaml`
- Create: `infra/tests/conftest.py`
- Create: `infra/tests/test_workflow_contract.py`
- Modify: `infra/argocd/application.yaml`

**Interfaces:**
- Consumes: digest-pinned dataplane image and `eatbid` CLI.
- Produces: `WorkflowTemplate/eatbid-dataplane`, `CronWorkflow/eatbid-poll-open`, `CronWorkflow/eatbid-daily-reconcile`.

- [ ] **Step 1: workflow contract 실패 테스트 작성**

`infra/tests/conftest.py`에서 `kubectl kustomize infra/product` 출력을 `yaml.safe_load_all`로 읽어
`ManifestSet.workflow_template(name)`, `ManifestSet.kinds`를 제공하는 `manifests` fixture를 만든다.
WorkflowTemplate wrapper는 DAG task 이름, synchronization semaphore ConfigMap key, project template의
mutex name을 그대로 노출한다.

```python
def test_workflow_has_one_source_semaphore_and_publish_mutex(manifests) -> None:
    template = manifests.workflow_template("eatbid-dataplane")
    assert template.semaphore_key == "eatbid-source-limit"
    assert template.project_mutex == "eatbid-core-publication"
    assert template.entrypoint_steps == [
        "discover", "capture", "normalize", "validate", "project", "build-marts", "verify"
    ]
    assert "CronJob" not in manifests.kinds
```

- [ ] **Step 2: manifests가 없어 실패하는지 확인**

Run: `python -m pytest infra/tests/test_workflow_contract.py -q`

Expected: FAIL because product WorkflowTemplate is absent.

- [ ] **Step 3: platform Argo CD Application 구현**

Helm repository `https://argoproj.github.io/argo-helm`, chart `argo-workflows`, chart version `1.0.23`을
pin한다. controller는 `eatbid` namespace workflow만 실행하고 server/UI는 disabled, workflow archive,
Argo Events, bundled MinIO는 disabled다. CRD는 full validation과 keep policy를 사용한다.

- [ ] **Step 4: product WorkflowTemplate 구현**

모든 step은 같은 digest-pinned dataplane image를 쓰고 artifact는 run/observation ID로 전달한다.
source semaphore ConfigMap 값은 `1`, project step mutex는 `eatbid-core-publication`이다.
retryStrategy는 transient exit 74만 최대 3회 exponential backoff하고 64/75/76은 재시도하지 않는다.

- [ ] **Step 5: 두 CronWorkflow 구현**

`poll-open`은 평일 `Asia/Seoul` 08:00–19:59에 30분 간격, `daily-reconcile`은 매일 07:00에
실행한다. 두 schedule은 동일 template을 `mode` parameter만 달리 호출한다. backfill/replay에는
schedule을 만들지 않고 운영자가 WorkflowTemplate을 제출한다.

- [ ] **Step 6: 렌더·정책 테스트**

Run: `kubectl kustomize infra/product > $null; python -m pytest infra/tests/test_workflow_contract.py -q`

Expected: Kustomize exit 0; WorkflowTemplate/CronWorkflow contract PASS; native CronJob 0.

- [ ] **Step 7: 커밋**

```bash
git add infra/platform infra/product infra/argocd/application.yaml infra/tests
git commit -m "ops: run dataplane with Argo Workflows"
```

---

### Task 12: 첫 수직 슬라이스 검증과 foundation gate

**Files:**
- Create: `apps/dataplane/tests/integration/test_foundation_slice.py`
- Modify: `apps/dataplane/tests/integration/conftest.py`
- Create: `docs/operations/data-foundation-runbook.md`
- Create: `docs/operations/data-foundation-gate.md`
- Modify: `docs/architecture/runtime-and-deployment.md`

**Interfaces:**
- Consumes: Tasks 1–11 전체.
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

- [ ] **Step 3: production composition root 완성**

`cli.py`가 Settings, R2RawObjectStore, PsycopgObservationRepository, EaT source adapter,
projector/replay를 조립하게 한다. 각 command는 JSON 한 줄로 run_id, build_sha, parser_version,
counts, duration_ms, status/failure_category를 stdout에 기록한다.

같은 step에서 integration `conftest.py`에 다음 contract의 `FoundationHarness`와 `foundation` fixture를
추가한다.

```python
from collections.abc import Sequence
from dataclasses import dataclass

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


class FoundationHarness:
    def run_fixture(self, relative_path: str, *, expected_count: int) -> FoundationResult:
        raise NotImplementedError

    def replay(self, observation_ids: Sequence[int], *, parser_version: str) -> ReplayResult:
        raise NotImplementedError
```

- [ ] **Step 4: runbook과 gate 작성**

Runbook에는 local PostgreSQL 시작, migration, fixture capture, replay, Argo 수동 제출, quarantine 확인,
publication count 확인, rollback 없이 active publication을 유지하는 실패 복구 명령을 exact command로
기록한다. Gate에는 raw key/hash, `TOT_CNT`, row counts, replay fingerprint, migration version,
image digest, Workflow status를 붙일 증거 칸을 둔다.

- [ ] **Step 5: 전체 검증 실행**

Run: `pnpm test && pnpm build`

Run: `cd apps/dataplane && uv run pytest --cov=eatbid --cov-fail-under=90 -q && uv run ruff check src tests && uv run pyright src`

Run: `kubectl kustomize infra/product > $null && git grep -n "kind: CronJob" -- infra/product`

Expected: TS/Python build/tests PASS, dataplane coverage at least 90%, Kustomize exit 0, final grep has no matches.

- [ ] **Step 6: architecture conformance 확인**

Run: `git grep -nE "db:push|configMapGenerator:.*schema|split_part\(.*school_id|hostPath:" -- package.json packages apps/dataplane infra/product`

Expected: no matches.

- [ ] **Step 7: 커밋**

```bash
git add apps/dataplane docs/operations docs/architecture/runtime-and-deployment.md
git commit -m "test: prove replayable data foundation slice"
```

---

## Foundation Completion Gate

이 계획은 다음 증거가 모두 있을 때만 완료다.

- 한 실제 eaT fixture의 raw response가 parse 전에 R2-compatible object로 저장된다.
- 같은 bytes 재수집은 raw blob 1개와 observation N개를 만든다.
- `TOT_CNT` 불일치 run은 active publication과 `core`를 바꾸지 않는다.
- Organization/AuctionAttempt 내부 관계에 이름·주소·복합 문자열 FK가 없다.
- 동일 raw+parser version replay fingerprint가 동일하다.
- 빈 PostgreSQL이 committed Drizzle migration만으로 생성된다.
- web/server/dataplane/migration image가 한 Git SHA와 immutable digest를 가진다.
- Argo Workflows만 dataplane을 예약하며 product manifests에 native CronJob이 없다.
- 기존 legacy reader/writer는 아직 제거하지 않지만 새 foundation에 dual-write하지 않는다.

Foundation 완료 뒤 canonical domain expansion 계획은 실제 quarantine/code coverage 보고서를 입력으로
작성한다. 수치가 없는 추측으로 submission/award/region mapping 범위를 확장하지 않는다.
