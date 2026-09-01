# R0 source release와 offline execution Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** 실행 재시도와 독립된 `source_release_id`를 도입하고 eaT offline discovery·capture·CLI를 재현 가능한 raw evidence 경계로 연결한다.

**Architecture:** PostgreSQL `ingest`가 불변 release manifest와 dataset별 completeness를 소유하고 Python dataplane이 동일 aggregate를 통해 discover/capture/seal한다. HTTP source·DB·R2 adapter는 composition root에서만 조립하고 offline fixture가 통과하기 전에는 live credential이나 cluster를 사용하지 않는다.

**Tech Stack:** Node 24.20.0, pnpm 10.12.1, Drizzle ORM/Kit, PostgreSQL 16, Python 3.12, Pydantic v2, httpx, R2/S3, Infisical, Argo Workflows

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **Linear:** EAT-17 (release identity), EAT-18 (offline source/CLI), parent EAT-14

## Global Constraints

- Node/pnpm 명령은 `fnm exec --using=24.20.0`으로 실행한다.
- source bytes를 R2에 성공적으로 보존하기 전에 parsed/normalized 상태를 기록하지 않는다.
- `run_id`는 실행, `source_release_id`는 봉인된 raw member 집합이며 서로 대체하지 않는다.
- raw release 수정은 금지하고 정정·추가 수집은 새 release ID로 만든다.
- release terminal 전이는 PostgreSQL `READ COMMITTED` transaction에서만 수행하며 다른 isolation은 SQLSTATE `25000`으로 실패한다.
- source URL·method·dataset·request parameter는 reviewed registry 밖에서 조립하지 않는다.
- 테스트 이름·주석·문서·커밋은 한국어로 작성하고 300줄 초과 파일은 책임별로 분리한다.
- live eaT/R2/PostgreSQL/Kubernetes mutation은 exact 대상 확인 후 별도 사용자 승인을 받는다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `docs/adr/0025-source-release-manifest.md` | run과 source release 분리, 상태 전이, hash 권위 |
| `packages/db/src/schema/ingest/release.ts` | release·run·observation·dataset membership DDL |
| `apps/dataplane/src/eatbid/ingest/release_models.py` | Python release aggregate와 completeness value |
| `apps/dataplane/src/eatbid/ingest/release_repository.py` | storage-neutral release protocol |
| `apps/dataplane/src/eatbid/ingest/postgres_release_repository.py` | PostgreSQL 상태 전이와 seal transaction |
| `apps/dataplane/src/eatbid/source/eat/registry.py` | reviewed endpoint/dataset/column/request 계약 |
| `apps/dataplane/src/eatbid/source/eat/http_client.py` | allowlist된 eaT HTTP transport와 timeout/throttle 경계 |
| `apps/dataplane/src/eatbid/pipeline/discover.py` | list page를 request unit manifest로 확장 |
| `apps/dataplane/src/eatbid/composition.py` | config·DB·R2·source client composition root |
| `apps/dataplane/src/eatbid/cli.py` | typed argument parse, command dispatch와 exit code |

### Task 1: source release identity ADR과 Drizzle DDL을 만든다

**Files:**
- Create: `docs/adr/0025-source-release-manifest.md`
- Create: `packages/db/src/schema/ingest/release.ts`
- Modify: `packages/db/src/schema/ingest/index.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/schema/ingest/release.test.ts`
- Generated: `packages/db/drizzle`의 `source_release_manifest` migration directory

**Interfaces:**
- Produces: `sourceRelease`, `sourceReleaseRun`, `sourceReleaseObservation`, `sourceReleaseDataset`
- Consumes: `ingestRun.runId`, `rawObservation.observationId`

- [x] **Step 1: 상태·membership 실패 테스트를 쓴다**

```ts
test("source release는 실행과 observation membership을 따로 소유한다", () => {
  expect(getTableName(sourceRelease)).toBe("source_release");
  expect(getTableName(sourceReleaseRun)).toBe("source_release_run");
  expect(getTableName(sourceReleaseObservation)).toBe("source_release_observation");
  expect(getTableName(sourceReleaseDataset)).toBe("source_release_dataset");
});
```

DDL SQL assertion은 `planned|sealed|failed`, SHA-256 `manifest_sha256`, timezone-aware `as_of`, dataset별 expected/observed/normalized/quarantined count, required flag, endpoint/dataset/record type/parser/schema fingerprint를 요구한다.

- [x] **Step 2: 실패를 확인한다**

Run: `fnm exec --using=24.20.0 pnpm --filter @eatbid/db exec bun test src/schema/ingest/release.test.ts`

Expected: 새 export와 table이 없어 FAIL한다.

- [x] **Step 3: 네 table과 불변식을 구현한다**

```ts
export const sourceRelease = ingestSchema.table("source_release", {
  sourceReleaseId: uuid("source_release_id").primaryKey(),
  source: varchar("source", { length: 64 }).notNull(),
  releaseName: varchar("release_name", { length: 128 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  manifestSha256: char("manifest_sha256", { length: 64 }),
  sealedAt: timestamp("sealed_at", { withTimezone: true }),
  failureCategory: varchar("failure_category", { length: 64 }),
});
```

membership table은 composite primary key를 쓰고 같은 release 안의 run/observation 중복을 금지한다. sealed 상태는 manifest hash와 sealedAt을 필수로 하고 failed 상태만 failureCategory를 허용한다.

- [x] **Step 4: migration을 생성하고 빈 DB 재실행을 검증한다**

```powershell
fnm exec --using=24.20.0 pnpm --filter @eatbid/db exec drizzle-kit generate --name source_release_manifest
fnm exec --using=24.20.0 pnpm db:check
fnm exec --using=24.20.0 pnpm db:migrate
fnm exec --using=24.20.0 pnpm db:migrate
```

- [x] **Step 5: ADR과 함께 커밋한다**

```powershell
git add docs/adr/0025-source-release-manifest.md packages/db/src/schema/ingest packages/db/src/schema/index.ts packages/db/drizzle
git commit -m "feat(data): source release 불변 manifest를 도입한다"
```

### Task 2: Python release aggregate와 PostgreSQL repository를 구현한다

**Files:**
- Create: `apps/dataplane/src/eatbid/ingest/release_models.py`
- Create: `apps/dataplane/src/eatbid/ingest/release_repository.py`
- Create: `apps/dataplane/src/eatbid/ingest/postgres_release_repository.py`
- Test: `apps/dataplane/tests/unit/test_release_models.py`
- Test: `apps/dataplane/tests/integration/test_source_release.py`

**Interfaces:**
- Produces: `SourceReleasePlan`, `ReleaseDatasetPlan`, `ReleaseCompleteness`, `SourceReleaseRepository`
- Consumes: UUID run/observation IDs와 canonical manifest bytes

- [x] **Step 1: seal 불변식 실패 테스트를 쓴다**

```python
def test_필수_dataset이_불완전하면_release를_봉인하지_않는다() -> None:
    repository = MemorySourceReleaseRepository(incomplete_required_dataset=True)
    with pytest.raises(ReleaseIncompleteError):
        repository.seal_release(RELEASE_ID, sealed_at=SEALED_AT)
```

동일 member를 순서만 바꿔 입력해도 manifest SHA가 같고, sealed release에 run/observation을 추가하면 `ReleaseSealedError`가 나는 테스트를 함께 작성한다.
PostgreSQL repository의 terminal transaction이 `READ COMMITTED`를 사용하고, 다른 isolation의 DB SQLSTATE `25000`을 typed repository error로 보존하는 테스트도 작성한다.

- [x] **Step 2: 실패를 확인한다**

Run: `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_release_models.py apps/dataplane/tests/integration/test_source_release.py -q`

- [x] **Step 3: protocol과 deterministic manifest를 구현한다**

```python
class SourceReleaseRepository(Protocol):
    def plan_release(self, plan: SourceReleasePlan) -> None: ...
    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None: ...
    def attach_observation(self, source_release_id: UUID, observation_id: int) -> None: ...
    def completeness(self, source_release_id: UUID) -> tuple[ReleaseCompleteness, ...]: ...
    def seal_release(self, source_release_id: UUID, *, sealed_at: datetime) -> SealedSourceRelease: ...
```

manifest hash는 release metadata, 정렬된 dataset 계약, 정렬된 observation ID/content hash를 canonical JSON bytes로 직렬화해 SHA-256으로 계산한다. seal은 명시적 `READ COMMITTED` transaction에서 parent row를 잠그고 completeness를 재조회한 뒤 상태를 바꾼다. DB가 반환하는 SQLSTATE `25000`은 isolation 계약 위반으로 분류한다.

- [x] **Step 4: unit/integration test를 통과시킨다**

Run: `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_release_models.py apps/dataplane/tests/integration/test_source_release.py -q`

- [x] **Step 5: 커밋한다**

```powershell
git add apps/dataplane/src/eatbid/ingest apps/dataplane/tests/unit/test_release_models.py apps/dataplane/tests/integration/test_source_release.py
git commit -m "feat(data): source release 봉인 상태를 구현한다"
```

### Task 3: reviewed eaT registry와 HTTP transport를 구현한다

**Files:**
- Create: `apps/dataplane/src/eatbid/source/eat/registry.py`
- Create: `apps/dataplane/src/eatbid/source/eat/http_client.py`
- Modify: `apps/dataplane/src/eatbid/source/eat/schema_contract.py`
- Test: `apps/dataplane/tests/unit/test_eat_registry.py`
- Test: `apps/dataplane/tests/unit/test_eat_http_client.py`

**Interfaces:**
- Produces: `EatEndpointContract`, `EAT_ENDPOINTS`, `EatHttpClient.fetch(CaptureRequest)`
- Consumes: exact audit evidence에서 검토한 path/method/parameter 이름만 사용

- [x] **Step 1: allowlist와 timeout 실패 테스트를 쓴다**

```python
def test_registry에_없는_endpoint는_HTTP_전에_거부한다() -> None:
    transport = RecordingTransport()
    client = EatHttpClient(transport=transport, endpoints=EAT_ENDPOINTS)
    with pytest.raises(SourceContractError):
        client.fetch(capture_request(endpoint="unknown"))
    assert transport.requests == []
```

403/429 throttle, non-2xx contract failure, redirect 금지, connect/read/write/pool timeout 고정, response byte 상한과 secret/query redaction을 각각 테스트한다.

- [x] **Step 2: 실패를 확인한다**

Run: `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_eat_registry.py apps/dataplane/tests/unit/test_eat_http_client.py -q`

- [x] **Step 3: httpx transport를 최소 구현한다**

```python
class EatHttpClient:
    def fetch(self, request: CaptureRequest) -> SourceResponse:
        contract = self._endpoints.require(request.endpoint)
        response = self._client.request(contract.method, contract.url, data=dict(request.params))
        return SourceResponse(response.status_code, response.content, self._clock.now())
```

실제 URL과 field는 `docs/audit-source/endpoint-calls.json`의 검토된 call만 registry에 옮긴다. generic URL 인수와 arbitrary header/params는 노출하지 않는다.

- [x] **Step 4: focused test와 ruff/pyright를 통과시킨다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_eat_registry.py apps/dataplane/tests/unit/test_eat_http_client.py -q
uv run --project apps/dataplane ruff check apps/dataplane/src/eatbid/source/eat apps/dataplane/tests/unit/test_eat_registry.py apps/dataplane/tests/unit/test_eat_http_client.py
uv run --project apps/dataplane pyright apps/dataplane/src/eatbid/source/eat
```

- [x] **Step 5: 커밋한다**

```powershell
git add apps/dataplane/src/eatbid/source/eat apps/dataplane/tests/unit/test_eat_registry.py apps/dataplane/tests/unit/test_eat_http_client.py
git commit -m "feat(data): 검토된 eaT HTTP 경계를 구현한다"
```

### Task 4: discovery와 production CLI composition을 연결한다

**Files:**
- Create: `apps/dataplane/src/eatbid/pipeline/discover.py`
- Create: `apps/dataplane/src/eatbid/config.py`
- Create: `apps/dataplane/src/eatbid/composition.py`
- Modify: `apps/dataplane/src/eatbid/cli.py`
- Test: `apps/dataplane/tests/unit/test_discover.py`
- Test: `apps/dataplane/tests/unit/test_cli.py`
- Test: `apps/dataplane/tests/integration/test_cli_pipeline.py`

**Interfaces:**
- Produces: `discover_release(plan, repository, client)`, `build_application(config)`, command별 실제 exit code
- Consumes: Task 2 release repository, Task 3 endpoint registry/client, 기존 capture/normalize/validate/project stage

- [x] **Step 1: page 중복·count mismatch와 unwired exit 64 제거 테스트를 쓴다**

```python
def test_discovery가_total_count와_exact_bid_id_manifest를_고정한다() -> None:
    result = discover_release(RELEASE_PLAN, repository, paged_client)
    assert result.expected_count == 3
    assert result.external_bid_ids == ("EAT-1", "EAT-2", "EAT-3")
```

중복 ID, page 간 `TOT_CNT` 변화, 빈 중간 page, page budget 초과는 source contract failure로 끝나고 release가 sealed되지 않아야 한다.

- [x] **Step 2: 실패를 확인한다**

Run: `uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_discover.py apps/dataplane/tests/unit/test_cli.py apps/dataplane/tests/integration/test_cli_pipeline.py -q`

- [x] **Step 3: command dispatch를 구현한다**

```python
COMMAND_HANDLERS: Mapping[str, Callable[[Namespace, Application], int]] = {
    "discover": run_discover,
    "capture": run_capture,
    "normalize": run_normalize,
    "validate": run_validate,
    "project": run_project,
    "replay": run_replay,
}
```

모든 command에 UUID `--source-release-id`를 추가한다. config는 Pydantic Settings로 DB/R2/source timeout을 검증하되 secret 값을 로그나 error에 포함하지 않는다. command가 실제 stage를 끝내면 0, typed failure면 기존 64/65/75/76을 반환한다.

- [x] **Step 4: focused/전체 dataplane gate를 통과시킨다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_discover.py apps/dataplane/tests/unit/test_cli.py apps/dataplane/tests/integration/test_cli_pipeline.py -q
uv run --project apps/dataplane pytest apps/dataplane/tests -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
uv run --project apps/dataplane pyright apps/dataplane/src
```

- [x] **Step 5: 커밋한다**

```powershell
git add apps/dataplane/src/eatbid apps/dataplane/tests
git commit -m "feat(data): eaT pipeline CLI를 실제 실행 경계에 연결한다"
```
