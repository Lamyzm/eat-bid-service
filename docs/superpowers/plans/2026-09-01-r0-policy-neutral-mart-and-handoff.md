# R0 정책 중립 mart와 EAT-6 handoff Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** exact publication set으로 정책 중립 base fact를 만들고 실제 `mart_build_id`와 coverage evidence를 EAT-6에 연결한다.

**Architecture:** PostgreSQL `mart`는 build identity·publication membership·observed outcome fact만 저장한다. builder는 cutoff 이전 verified core facts를 결정적으로 materialize하고, cohort fallback·threshold·추천·UI 정책은 EAT-6 전까지 소유하지 않는다.

**Tech Stack:** Node 24.20.0, Drizzle ORM/Kit, PostgreSQL 16, Python 3.12, Pydantic v2, Argo Workflows

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **Linear:** EAT-24 (mart), EAT-25 (EAT-6 handoff), parent EAT-14

## Global Constraints

- `docs/superpowers/plans/2026-09-01-r0-canonical-corpus-and-publication.md`과 `docs/superpowers/plans/2026-09-01-r0-government-code-releases.md`가 선행한다.
- Node/pnpm 명령은 `fnm exec --using=24.20.0`으로 실행한다.
- mart는 published core만 읽고 raw, quarantine, 미발행 normalized row를 직접 집계하지 않는다.
- 모든 build/fact는 `mart_build_id`, publication membership, computation version, `as_of`를 역추적한다.
- cohort fallback, sample threshold, 추천값, UI label과 미래 observation을 넣지 않는다.
- 실패 build는 이전 active build를 덮지 않으며 동일 입력은 같은 output fingerprint를 만든다.
- 테스트 이름·주석·문서·커밋은 한국어로 작성하고 300줄 초과 파일은 책임별로 분리한다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `packages/db/src/schema/mart/builds.ts` | build identity·publication membership·activation |
| `packages/db/src/schema/mart/outcome_facts.ts` | 정책 중립 observed outcome grain |
| `apps/dataplane/src/eatbid/mart` | deterministic base fact builder와 repository |
| `docs/operations/r0-publication-handoff.md` | 전체 release/publication/mart completeness evidence |
| `docs/operations/data-foundation-gate.md` | EAT-6 Ready 판정 evidence |

### Task 1: 정책 중립 mart build와 observed outcome fact를 구현한다

**Files:**
- Create: `packages/db/src/schema/mart/builds.ts`
- Create: `packages/db/src/schema/mart/outcome_facts.ts`
- Create: `packages/db/src/schema/mart/index.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/schema/mart/mart.test.ts`
- Create: `apps/dataplane/src/eatbid/mart/models.py`
- Create: `apps/dataplane/src/eatbid/mart/repository.py`
- Create: `apps/dataplane/src/eatbid/mart/postgres_repository.py`
- Create: `apps/dataplane/src/eatbid/mart/build.py`
- Test: `apps/dataplane/tests/integration/test_mart_build.py`

**Interfaces:**
- Produces: `mart_build`, `mart_build_publication`, `observed_outcome_fact`, `build_base_mart(publication_ids, computation_version, as_of)`
- Consumes: published core auction revision/submission/award facts only

- [ ] **Step 1: policy-neutral DDL 실패 테스트를 쓴다**

```ts
test("base mart에는 cohort와 추천 정책 열이 없다", () => {
  const columns = Object.keys(getTableColumns(observedOutcomeFact));
  expect(columns).toContain("martBuildId");
  expect(columns).toContain("auctionRevisionId");
  expect(columns).not.toContain("cohortLevel");
  expect(columns).not.toContain("recommendedValue");
});
```

build에는 UUID ID, computation version SHA-256, `as_of`, status, input fingerprint, output fingerprint, validated/activated time가 있고 publication membership은 composite key다.

- [ ] **Step 2: 실패를 확인하고 DDL/migration을 구현한다**

```powershell
fnm exec --using=24.20.0 pnpm --filter @eatbid/db test -- mart.test.ts
fnm exec --using=24.20.0 pnpm --filter @eatbid/db exec drizzle-kit generate --name policy_neutral_mart
fnm exec --using=24.20.0 pnpm db:check
```

- [ ] **Step 3: deterministic builder를 구현한다**

```python
def build_base_mart(
    *,
    mart_build_id: UUID,
    publication_ids: tuple[UUID, ...],
    computation_version: str,
    as_of: datetime,
    repository: MartRepository,
) -> MartBuildEvidence: ...
```

builder는 selected canonical revision과 cutoff 이전 final outcome/submission만 읽는다. fact grain은 auction revision×submission observation이고 submission이 없는 final auction은 명시적 no-submission fact 또는 coverage exclusion로 분리한다. 같은 입력 정렬과 decimal canonical form으로 output fingerprint를 계산한다.

- [ ] **Step 4: 미래 누수·결정성·atomic activation을 검증한다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_mart_build.py -q
fnm exec --using=24.20.0 pnpm --filter @eatbid/db test
```

미래 observation 추가 후 과거 build hash 불변, 실패 build가 이전 active build를 덮지 않음, 동일 입력 재실행 hash 일치를 검사한다.

- [ ] **Step 5: 커밋한다**

```powershell
git add packages/db/src/schema/mart packages/db/src/schema/index.ts packages/db/drizzle apps/dataplane/src/eatbid/mart apps/dataplane/tests/integration/test_mart_build.py
git commit -m "feat(mart): 정책 중립 관측 사실 build를 구현한다"
```

### Task 2: 전체 R0 publication과 EAT-6 handoff를 닫는다

**Files:**
- Create: `docs/operations/r0-publication-handoff.md`
- Modify: `docs/operations/data-foundation-gate.md`
- External: approved full eaT backfill, R2, PostgreSQL, Argo manual Workflow
- Update: EAT-14와 EAT-6 Linear comments

**Interfaces:**
- Produces: actual sealed `source_release_id`, published `publication_id`, validated `mart_build_id`, coverage report
- Consumes: 선행 canonical publication 계획과 승인된 기간/as-of/dataset registry

- [ ] **Step 1: full backfill 전 전체 repository gate를 통과시킨다**

```powershell
fnm exec --using=24.20.0 node --version
fnm exec --using=24.20.0 pnpm architecture:check
fnm exec --using=24.20.0 pnpm test
fnm exec --using=24.20.0 pnpm build
uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra
uv run --project apps/dataplane pyright apps/dataplane/src
```

- [ ] **Step 2: 기간·as-of·필수 dataset·page budget을 출력하고 별도 승인을 받는다**

canary와 같은 image digest/registry/parser 계약을 사용한다. source count가 canary 대비 예상 범위를 벗어나면 full run을 시작하지 않는다.

- [ ] **Step 3: full raw release와 atomic publication을 실행한다**

Workflow를 manual submit하고 schedule은 계속 suspended로 둔다. 실패 request unit만 bounded retry run으로 수집해 같은 planned release에 attach하고, seal 이후에는 member를 추가하지 않는다.

- [ ] **Step 4: policy-neutral mart build를 만들고 read-only evidence를 저장한다**

handoff 문서는 dataset별 expected/observed/normalized/published/quarantined count, 기간/as-of/freshness, unresolved mapping, 기관·품목·지역·방식·금액·finality field coverage, source release/run/publication/mart lineage와 deterministic hash를 포함한다.

- [ ] **Step 5: EAT-6 Ready gate를 판정한다**

실제 세 ID가 queryable하고 설계 9절의 일곱 조건이 모두 evidence로 연결될 때만 EAT-6을 Ready로 옮긴다. 하나라도 없으면 EAT-6은 Backlog를 유지하고 누락 child issue를 blocker로 연결한다.

- [ ] **Step 6: 문서 커밋과 Linear handoff를 남긴다**

```powershell
git add docs/operations/r0-publication-handoff.md docs/operations/data-foundation-gate.md
git commit -m "docs(data): R0 publication과 mart handoff 증거를 봉인한다"
```
