# R0 정부 코드 release와 기관 reconciliation Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** 행정구역·기관·학교 코드의 공식 release를 raw evidence부터 canonical membership까지 보존하고 eaT 구매기관·지역 코드를 증거 기반으로 연결한다.

**Architecture:** 행정안전부 행정표준코드 다운로드와 NEIS 학교기본정보를 서로 다른 source scheme으로 수집하고 release를 교차 덮어쓰지 않는다. source code는 scheme 안에서만 identity이며, eaT/행안부/NEIS 간 연결은 evidence·유효기간·상태가 있는 mapping/reconciliation으로만 만든다.

**Tech Stack:** Node 24.20.0, Zod 4, JSON Schema, Pydantic v2, Drizzle ORM/Kit, PostgreSQL 16, Python 3.12, httpx, R2

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **Linear:** EAT-20 (parent EAT-14)

## Global Constraints

- `docs/superpowers/plans/2026-09-01-r0-source-release-and-offline.md`의 source release manifest를 사용한다.
- Node/pnpm 명령은 `fnm exec --using=24.20.0`으로 실행한다.
- 행정안전부·NEIS·eaT code 문자열은 같은 값이어도 scheme이 다르면 자동으로 같다고 보지 않는다.
- 이름·주소·시군구 label 유사도로 자동 병합하거나 좌표를 추론하지 않는다.
- 공식 source file/response를 R2에 먼저 보존하고 release version/content hash를 기록한다.
- mapping은 from/to code value, relation, valid time, evidence observation과 review status를 필수로 가진다.
- 테스트 이름·주석·문서·커밋은 한국어로 작성하고 300줄 초과 adapter는 source별로 분리한다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `docs/audit-source/reference-source-contracts.json` | MOIS/NEIS source URL·format·필드·release version audit |
| `packages/contracts/src/ingestion/v1/normalized-code-release.ts` | portable code release/member wire |
| `packages/contracts/src/ingestion/v1/normalized-organization.ts` | source-scoped organization identifier wire |
| `packages/db/src/schema/core/code-releases.ts` | release와 code membership DDL |
| `apps/dataplane/src/eatbid/source/reference/mois.py` | 행정표준코드 file adapter |
| `apps/dataplane/src/eatbid/source/reference/neis.py` | NEIS 학교기본정보 adapter |
| `apps/dataplane/src/eatbid/core/code_projection.py` | code release/member·label projection |
| `apps/dataplane/src/eatbid/core/organization_reconciliation.py` | evidence 기반 기관 identifier/mapping 후보 |
| `docs/operations/reference-data-coverage.md` | release freshness·mapping·unresolved coverage evidence |

### Task 1: 공식 reference source 계약을 audit fixture로 고정한다

**Files:**
- Create: `docs/audit-source/reference-source-contracts.json`
- Create: `apps/dataplane/tests/fixtures/reference/mois-code-release-sample.csv`
- Create: `apps/dataplane/tests/fixtures/reference/neis-school-info-sample.json`
- Test: `apps/dataplane/tests/unit/test_reference_source_contracts.py`

**Interfaces:**
- Produces: source IDs `mois-standard-code`, `neis-school-info`; dataset IDs `legal-dong`, `organization`, `school`
- Consumes: 행정표준코드관리시스템 전체 다운로드와 NEIS 학교기본정보 response

- [ ] **Step 1: registry shape 실패 테스트를 쓴다**

```python
def test_reference_source_contract가_release와_schema를_모두_고정한다() -> None:
    contracts = load_reference_source_contracts()
    assert set(contracts) == {"mois-standard-code", "neis-school-info"}
    assert contracts["mois-standard-code"].datasets >= {"legal-dong", "organization"}
    assert contracts["neis-school-info"].datasets == {"school"}
    assert all(item.schema_fingerprint for item in contracts.values())
```

- [ ] **Step 2: 공식 응답을 read-only로 관찰하고 raw fixture를 비식별 최소 행으로 줄인다**

MOIS는 `https://www.code.go.kr/stdcodesrch/codeAllDownloadL.do`, NEIS는 공식 `schoolInfo` service의 response를 사용한다. audit JSON은 method, URL, media type, encoding, release/version field, pagination, required columns와 fixture SHA-256을 기록한다. API key·cookie·다운로드 session parameter는 기록하지 않는다.

- [ ] **Step 3: fixture schema fingerprint와 예상 실패를 구현한다**

column 추가/삭제, encoding 변화, 중복 code, release version 누락, NEIS page total 변화가 `SourceContractError`가 되는 test를 작성한다.

- [ ] **Step 4: focused test와 커밋을 만든다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_reference_source_contracts.py -q
git add docs/audit-source/reference-source-contracts.json apps/dataplane/tests/fixtures/reference apps/dataplane/tests/unit/test_reference_source_contracts.py
git commit -m "test(data): 정부 코드 source 계약을 audit fixture로 고정한다"
```

### Task 2: portable code release와 organization identifier 계약을 만든다

**Files:**
- Create: `packages/contracts/src/ingestion/v1/normalized-code-release.ts`
- Create: `packages/contracts/src/ingestion/v1/normalized-code-release.test.ts`
- Create: `packages/contracts/src/ingestion/v1/normalized-organization.ts`
- Create: `packages/contracts/src/ingestion/v1/normalized-organization.test.ts`
- Modify: `packages/contracts/src/portable-registry.ts`
- Modify generated: `apps/dataplane/src/eatbid/generated/ingestion_v1.py`

**Interfaces:**
- Produces: `code-release.v1`, `organization.v1`; code member는 scheme/code/label/active/valid time을 보존
- Consumes: Task 1 source row, 기존 `sourceCodeSchema`와 `InstantText`

- [ ] **Step 1: leading zero와 cross-scheme 실패 테스트를 쓴다**

```ts
test("code member는 scheme과 leading zero code를 함께 보존한다", () => {
  const member = normalizedCodeReleaseMemberV1Schema.parse({
    scheme: "neis:school",
    code: "B100000001",
    label: "표본학교",
    active: true,
    validFrom: null,
    validTo: null,
  });
  expect(member.code).toBe("B100000001");
});
```

같은 code 문자열의 다른 scheme을 한 identity로 합치거나 label을 identifier로 사용하는 payload는 만들 수 없게 shape를 분리한다.

- [ ] **Step 2: portable schema와 registry entry를 구현한다**

```ts
export const normalizedCodeReleaseV1Schema = z.strictObject({
  contractVersion: z.literal("eatbid.ingestion.code-release.v1"),
  release: z.strictObject({
    source: sourceSystemSchema,
    scheme: codeSchemeSchema,
    sourceVersion: z.string().min(1).max(256),
    publishedAt: instantTextSchema.nullable(),
  }),
  members: z.array(normalizedCodeReleaseMemberV1Schema).min(1),
});
```

organization wire는 `source`, `identifierScheme`, `identifier`, `observedName`, `organizationType`만 소유하고 canonical organization ID를 포함하지 않는다.

- [ ] **Step 3: 생성 drift와 test를 통과시킨다**

```powershell
fnm exec --using=24.20.0 pnpm --filter @eatbid/contracts exec bun test src/ingestion/v1/normalized-code-release.test.ts src/ingestion/v1/normalized-organization.test.ts
fnm exec --using=24.20.0 pnpm contracts:generate
fnm exec --using=24.20.0 pnpm contracts:python:generate
fnm exec --using=24.20.0 pnpm contracts:check
fnm exec --using=24.20.0 pnpm contracts:python:check
```

- [ ] **Step 4: 커밋한다**

```powershell
git add packages/contracts apps/dataplane/src/eatbid/generated
git commit -m "feat(contract): 정부 코드 release와 기관 식별자 계약을 추가한다"
```

### Task 3: code release membership DDL과 projection을 구현한다

**Files:**
- Create: `packages/db/src/schema/core/code-releases.ts`
- Modify: `packages/db/src/schema/core/index.ts`
- Test: `packages/db/src/schema/core/code-releases.test.ts`
- Create: `apps/dataplane/src/eatbid/core/code_projection.py`
- Create: `apps/dataplane/tests/integration/test_code_release_projection.py`

**Interfaces:**
- Produces: `codeRelease`, `codeReleaseMember`; existing `codeValue`, `codeLabelObservation`을 evidence와 연결
- Consumes: normalized `code-release.v1`, source release/publication/raw observation lineage

- [ ] **Step 1: release membership과 effective-time 실패 테스트를 쓴다**

```ts
test("code release member는 release와 code value의 복합 identity다", () => {
  expect(primaryKeyColumns(codeReleaseMember)).toEqual(["codeReleaseId", "codeValueId"]);
});
```

source version/content hash 중복, 다른 scheme code membership, validTo<validFrom, raw evidence 없는 label을 DB가 거부하는 SQL assertion을 추가한다.

- [ ] **Step 2: DDL과 migration을 구현한다**

```powershell
fnm exec --using=24.20.0 pnpm --filter @eatbid/db exec bun test src/schema/core/code-releases.test.ts
fnm exec --using=24.20.0 pnpm --filter @eatbid/db exec drizzle-kit generate --name canonical_code_releases
fnm exec --using=24.20.0 pnpm db:check
```

- [ ] **Step 3: projector의 idempotency와 release 교체 금지를 구현한다**

같은 normalized record 재실행은 같은 membership을 확인하고, 이미 발행된 release member를 수정하지 않는다. 정정 source file은 새 code release를 만들며 현재 label을 기존 observation 위에 overwrite하지 않는다.

- [ ] **Step 4: integration test와 커밋을 만든다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_code_release_projection.py -q
fnm exec --using=24.20.0 pnpm --filter @eatbid/db test
git add packages/db apps/dataplane/src/eatbid/core/code_projection.py apps/dataplane/tests/integration/test_code_release_projection.py
git commit -m "feat(data): 정부 코드 release membership을 canonical로 발행한다"
```

### Task 4: MOIS·NEIS adapter와 기관 reconciliation을 구현한다

**Files:**
- Create: `apps/dataplane/src/eatbid/source/reference/__init__.py`
- Create: `apps/dataplane/src/eatbid/source/reference/mois.py`
- Create: `apps/dataplane/src/eatbid/source/reference/neis.py`
- Create: `apps/dataplane/src/eatbid/core/organization_reconciliation.py`
- Test: `apps/dataplane/tests/unit/test_reference_normalize.py`
- Test: `apps/dataplane/tests/integration/test_organization_reconciliation.py`

**Interfaces:**
- Produces: generated `code-release.v1`/`organization.v1`; reviewed `CodeMappingCandidate`
- Consumes: Task 1 fixtures, Task 2 models, Task 3 code releases, eaT organization/location identifiers

- [ ] **Step 1: 동명이기관·명칭변경·미확정 mapping 실패 테스트를 쓴다**

```python
def test_동일_이름과_시군구만으로_기관을_합치지_않는다() -> None:
    result = reconcile_organization(eat_identifier, candidates_with_same_name)
    assert result.status == "unresolved"
    assert result.organization_id is None
```

같은 NEIS school code의 명칭변경은 동일 organization에 새 label observation을 추가하고, 다른 code의 같은 이름은 분리한다.

- [ ] **Step 2: source별 normalizer를 구현한다**

MOIS file encoding/column을 registry로 검증한 뒤 법정동과 기관 release를 별도로 만든다. NEIS page는 total count와 학교코드 중복을 검증한다. generic mapping dictionary 한 파일로 합치지 않는다.

- [ ] **Step 3: reconciliation은 exact identifier와 승인 mapping만 활성화한다**

`CodeMappingCandidate`는 from/to code value, relation, valid time, evidence observation, status를 요구한다. exact officially supplied cross-reference는 `reviewed`, 이름/주소 후보는 `unresolved`로 남겨 core 관계를 만들지 않는다.

- [ ] **Step 4: focused/전체 dataplane gate와 커밋을 만든다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_reference_normalize.py apps/dataplane/tests/integration/test_organization_reconciliation.py -q
uv run --project apps/dataplane ruff check apps/dataplane/src/eatbid/source/reference apps/dataplane/src/eatbid/core/organization_reconciliation.py
uv run --project apps/dataplane pyright apps/dataplane/src/eatbid/source/reference apps/dataplane/src/eatbid/core/organization_reconciliation.py
git add apps/dataplane/src/eatbid/source/reference apps/dataplane/src/eatbid/core/organization_reconciliation.py apps/dataplane/tests
git commit -m "feat(data): 정부 코드와 eaT 기관을 증거 기반으로 연결한다"
```

### Task 5: release freshness와 mapping coverage를 handoff한다

**Files:**
- Create: `docs/operations/reference-data-coverage.md`
- Modify: `docs/operations/data-foundation-gate.md`
- Update: Linear 정부 코드 issue와 EAT-14 comments

**Interfaces:**
- Produces: scheme별 code release ID, as-of/freshness, member count, mapped/unresolved/unknown count
- Consumes: Task 1~4의 actual publication evidence

- [ ] **Step 1: full source 실행 전 offline gate를 통과시킨다**

```powershell
fnm exec --using=24.20.0 pnpm architecture:check
fnm exec --using=24.20.0 pnpm test
uv run --project apps/dataplane pytest apps/dataplane/tests -q
```

- [ ] **Step 2: 공식 release 수집 대상을 출력하고 별도 승인을 받는다**

MOIS/NEIS source, 기간/as-of, 예상 file/page count, R2/DB/Infisical path만 출력한다. credential과 raw row는 출력하지 않는다.

- [ ] **Step 3: actual release와 coverage를 기록한다**

MOIS 법정동·기관, NEIS 학교, eaT 조직·지역 scheme 각각의 release ID와 content hash를 기록한다. mapping coverage는 전체·reviewed·unresolved·unknown을 분리하고 100%가 아니면 숨기지 않는다.

- [ ] **Step 4: EAT-6 dimension 사용 가능 여부를 판정하고 커밋한다**

기관·지역 dimension별로 exact source identifier만으로 가능한 범위와 cross-scheme mapping이 필요한 범위를 분리한다. coverage가 사전 기준에 못 미치는 dimension은 EAT-6 후보에서 제외한다.

```powershell
git add docs/operations/reference-data-coverage.md docs/operations/data-foundation-gate.md
git commit -m "docs(data): 정부 코드 release와 mapping coverage를 기록한다"
```
