# R0 canonical corpus와 atomic publication Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** eaT 투찰·낙찰 사실을 versioned portable contract와 canonical core로 변환해 source release 단위로 원자 발행한다.

**Architecture:** Zod portable registry가 언어 간 normalized submission/award wire의 권위이고 generated Pydantic이 source normalizer를 검증한다. PostgreSQL core는 append-only submission/award facts를 소유하며 sealed source release의 모든 필수 record type이 완전할 때만 한 publication으로 원자 활성화한다.

**Tech Stack:** Node 24.20.0, Zod 4, JSON Schema, generated Pydantic v2, Drizzle ORM/Kit, PostgreSQL 16, Python 3.12

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **Linear:** EAT-21 (submission), EAT-22 (award), EAT-23 (full publication), parent EAT-14

## Global Constraints

- `docs/superpowers/plans/2026-09-01-r0-live-canary.md`의 sealed canary evidence가 선행한다.
- `docs/superpowers/plans/2026-09-01-r0-government-code-releases.md`의 code release·organization mapping coverage가 full handoff 전에 완료돼야 한다.
- Node/pnpm 명령은 `fnm exec --using=24.20.0`으로 실행한다.
- source parser DTO, portable ingestion DTO, DB row와 public DTO를 서로 직접 `pick`하지 않는다.
- 투찰자·금액·비율·순위·결과 finality는 source가 준 의미와 단위를 보존하고 이름/상태 문자열로 추론하지 않는다.
- raw observation과 normalized record가 없는 core row를 금지하고 필수 record type 누락 시 publication을 활성화하지 않는다.
- 테스트 이름·주석·문서·커밋은 한국어로 작성하고 300줄 초과 writer는 이 계획에서 분리한다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `packages/contracts/src/ingestion/v1/normalized-submission.ts` | portable `submission.v1` wire |
| `packages/contracts/src/ingestion/v1/normalized-award.ts` | portable `award.v1` wire |
| `apps/dataplane/src/eatbid/source/eat/normalize_submission.py` | `ds_bidList` source row → generated submission model |
| `apps/dataplane/src/eatbid/source/eat/normalize_award.py` | `ds_info` result fields → generated award model |
| `packages/db/src/schema/core/submissions.ts` | bidder identity와 append-only submission observation |
| `packages/db/src/schema/core/awards.ts` | award decision/finality observation |
| `apps/dataplane/src/eatbid/core/postgres` | auction/submission/award writer의 분리된 transaction adapter |

### Task 1: submission portable contract와 eaT normalizer를 만든다

**Files:**
- Create: `packages/contracts/src/ingestion/v1/normalized-submission.ts`
- Create: `packages/contracts/src/ingestion/v1/normalized-submission.test.ts`
- Modify: `packages/contracts/src/portable-registry.ts`
- Create: `apps/dataplane/src/eatbid/source/eat/normalize_submission.py`
- Create: `apps/dataplane/tests/unit/test_eat_submission_normalize.py`
- Modify generated: `apps/dataplane/src/eatbid/generated/ingestion_v1.py`

**Interfaces:**
- Produces: `EatbidIngestionSubmissionV1`, record type `submission.v1`, contract version `eatbid.ingestion.submission.v1`
- Consumes: reviewed `ds_bidList` columns `SHIPPER_CD`, amount/rate/rank/status fields와 parent external bid ID

- [ ] **Step 1: portable value 실패 테스트를 쓴다**

```ts
test("submission은 문자열 identity와 exact decimal rate를 보존한다", () => {
  expect(normalizedSubmissionV1Schema.parse({
    contractVersion: "eatbid.ingestion.submission.v1",
    auctionExternalId: "EAT-1",
    participant: { sourceIdentifier: "00001234" },
    bidAmount: { amount: "123456.00", currency: "KRW" },
    adjustmentRate: { value: "99.91234", unit: "percentage-points" },
    rank: 1,
    sourceStatus: "개찰",
  }).participant.sourceIdentifier).toBe("00001234");
});
```

float/number rate, 음수 amount, 0 이하 rank, 암묵적 participant 이름 identity는 거부한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `fnm exec --using=24.20.0 pnpm --filter @eatbid/contracts exec bun test src/ingestion/v1/normalized-submission.test.ts`

- [ ] **Step 3: Zod contract와 registry entry를 구현하고 Python을 생성한다**

contract는 기존 money/rate/source-code atom을 조립하고 spread 대신 named object field를 사용한다.

```ts
export const normalizedSubmissionV1Schema = z.strictObject({
  contractVersion: z.literal("eatbid.ingestion.submission.v1"),
  auctionExternalId: externalBidIdSchema,
  participant: z.strictObject({ sourceIdentifier: sourceCodeSchema }),
  bidAmount: moneyWireSchema.nullable(),
  adjustmentRate: percentagePointsWireSchema.nullable(),
  rank: z.number().int().positive().nullable(),
  sourceStatus: z.string().min(1),
});
```

Run: `fnm exec --using=24.20.0 pnpm contracts:generate && fnm exec --using=24.20.0 pnpm contracts:python:generate`

- [ ] **Step 4: source normalizer를 구현하고 drift gate를 통과시킨다**

`normalize_submissions(payload, external_bid_id, parser_version)`는 `tuple[EatbidIngestionSubmissionV1, ...]`를 반환한다. empty result는 dataset 계약이 허용할 때만 빈 tuple이고, 같은 participant/rank 중복과 알려지지 않은 column fingerprint는 quarantine한다.

```powershell
fnm exec --using=24.20.0 pnpm contracts:check
fnm exec --using=24.20.0 pnpm contracts:python:check
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_eat_submission_normalize.py -q
```

- [ ] **Step 5: 커밋한다**

```powershell
git add packages/contracts apps/dataplane/src/eatbid/generated apps/dataplane/src/eatbid/source/eat/normalize_submission.py apps/dataplane/tests/unit/test_eat_submission_normalize.py
git commit -m "feat(contract): 투찰 관측 portable 계약을 추가한다"
```

### Task 2: award·result finality portable contract를 만든다

**Files:**
- Create: `packages/contracts/src/ingestion/v1/normalized-award.ts`
- Create: `packages/contracts/src/ingestion/v1/normalized-award.test.ts`
- Modify: `packages/contracts/src/portable-registry.ts`
- Create: `apps/dataplane/src/eatbid/source/eat/normalize_award.py`
- Create: `apps/dataplane/tests/unit/test_eat_award_normalize.py`
- Modify generated: `apps/dataplane/src/eatbid/generated/ingestion_v1.py`

**Interfaces:**
- Produces: `EatbidIngestionAwardV1`, record type `award.v1`, explicit finality enum
- Consumes: reviewed result status/winner/amount/rate columns; 모르는 상태는 `unknown`, 추론 금지

- [ ] **Step 1: finality 실패 테스트를 쓴다**

```ts
test("award는 source status와 canonical finality를 함께 보존한다", () => {
  const award = normalizedAwardV1Schema.parse({
    contractVersion: "eatbid.ingestion.award.v1",
    auctionExternalId: "EAT-1",
    sourceStatus: "낙찰",
    finality: "final",
    winnerSourceIdentifier: "00001234",
    awardedAmount: { amount: "123456.00", currency: "KRW" },
  });
  expect(award.finality).toBe("final");
});
```

winner가 없는데 final winner를 주장하거나 unknown source status를 final로 매핑하는 경우를 거부한다.

- [ ] **Step 2: 실패를 확인하고 contract/normalizer를 구현한다**

Run: `fnm exec --using=24.20.0 pnpm --filter @eatbid/contracts exec bun test src/ingestion/v1/normalized-award.test.ts`

source-status→finality mapping은 `normalize_award.py`의 versioned explicit mapping table 한 곳만 소유한다. 매핑되지 않은 값은 `unknown`과 원문 status를 보존하고 publication coverage에 집계한다.

- [ ] **Step 3: 생성물과 Python test를 검증한다**

```powershell
fnm exec --using=24.20.0 pnpm contracts:generate
fnm exec --using=24.20.0 pnpm contracts:python:generate
fnm exec --using=24.20.0 pnpm contracts:check
fnm exec --using=24.20.0 pnpm contracts:python:check
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_eat_award_normalize.py -q
```

- [ ] **Step 4: 커밋한다**

```powershell
git add packages/contracts apps/dataplane/src/eatbid/generated apps/dataplane/src/eatbid/source/eat/normalize_award.py apps/dataplane/tests/unit/test_eat_award_normalize.py
git commit -m "feat(contract): 낙찰 결과와 finality 계약을 추가한다"
```

### Task 3: submission/award core schema와 writer를 분리한다

**Files:**
- Create: `packages/db/src/schema/core/submissions.ts`
- Create: `packages/db/src/schema/core/awards.ts`
- Modify: `packages/db/src/schema/core/index.ts`
- Test: `packages/db/src/schema/core/outcomes.test.ts`
- Create: `apps/dataplane/src/eatbid/core/postgres/transaction.py`
- Create: `apps/dataplane/src/eatbid/core/postgres/auction_writer.py`
- Create: `apps/dataplane/src/eatbid/core/postgres/submission_writer.py`
- Create: `apps/dataplane/src/eatbid/core/postgres/award_writer.py`
- Modify: `apps/dataplane/src/eatbid/core/postgres_projection_writer.py`
- Test: `apps/dataplane/tests/integration/test_outcome_projection.py`

**Interfaces:**
- Produces: append-only `bid_submission_observation`, `award_decision_observation`; writer facade는 기존 repository protocol 유지
- Consumes: normalized record ID, raw observation ID, auction attempt/revision과 organization source identifier

- [ ] **Step 1: grain과 lineage 실패 테스트를 쓴다**

```ts
test("submission과 award observation은 normalized/raw lineage를 필수로 가진다", () => {
  expect(getTableColumns(bidSubmissionObservation)).toHaveProperty("normalizedRecordId");
  expect(getTableColumns(bidSubmissionObservation)).toHaveProperty("observationId");
  expect(getTableColumns(awardDecisionObservation)).toHaveProperty("normalizedRecordId");
  expect(getTableColumns(awardDecisionObservation)).toHaveProperty("observationId");
});
```

같은 normalized record 중복, 다른 auction의 participant/award 연결, unknown finality를 winner로 활성화하는 integration failure를 작성한다.

- [ ] **Step 2: 실패를 확인하고 DDL/migration을 구현한다**

```powershell
fnm exec --using=24.20.0 pnpm --filter @eatbid/db test -- outcomes.test.ts
fnm exec --using=24.20.0 pnpm --filter @eatbid/db exec drizzle-kit generate --name canonical_submission_award
fnm exec --using=24.20.0 pnpm db:check
```

participant source identifier는 `organization_identifier` evidence를 통해 organization에 연결하며 이름으로 자동 병합하지 않는다.

- [ ] **Step 3: 478줄 writer를 facade와 세 writer로 분리한다**

```python
class PostgresProjectionWriter:
    def project(self, member: FrozenPublicationMember) -> ProjectedRecord:
        return self._writers.require(member.record_type).project(member)
```

facade는 dispatch/transaction만 소유하고 각 writer는 자기 record type SQL만 소유한다. 파일마다 한국어 module 책임 주석을 둔다.

- [ ] **Step 4: migration·projection·300줄 gate를 검증한다**

```powershell
fnm exec --using=24.20.0 pnpm --filter @eatbid/db test
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_outcome_projection.py -q
fnm exec --using=24.20.0 pnpm quality:check
```

- [ ] **Step 5: 커밋한다**

```powershell
git add packages/db apps/dataplane/src/eatbid/core apps/dataplane/tests/integration/test_outcome_projection.py
git commit -m "feat(data): 투찰과 낙찰 결과를 canonical core에 발행한다"
```

### Task 4: source release 단위 atomic publication을 구현한다

**Files:**
- Modify: `packages/db/src/schema/ingest/publication.ts`
- Modify: `apps/dataplane/src/eatbid/ingest/publication_repository.py`
- Modify: `apps/dataplane/src/eatbid/ingest/postgres_publication_repository.py`
- Modify: `apps/dataplane/src/eatbid/pipeline/project.py`
- Test: `apps/dataplane/tests/integration/test_release_publication.py`

**Interfaces:**
- Produces: publication이 exact `source_release_id`와 여러 record type member를 참조
- Consumes: Task 1~3 normalized auction/submission/award와 sealed release completeness

- [ ] **Step 1: 부분 record type publication 실패 테스트를 쓴다**

```python
def test_필수_submission이_누락되면_auction만_publication하지_않는다() -> None:
    with pytest.raises(PublicationCompletenessError):
        repository.publish_release(RELEASE_ID, PUBLICATION_ID, ACTIVATED_AT)
    assert repository.active_publication() == PREVIOUS_PUBLICATION_ID
```

한 release의 normalized members가 여러 capture/replay run에서 와도 observation membership 밖 record는 거부하고, 재실행 fingerprint가 같은지 테스트한다.

- [ ] **Step 2: 실패를 확인하고 publication FK/transaction을 변경한다**

`publication`은 `source_release_id` unique FK와 `processing_run_id`를 갖는다. 기존 `run_id`를 release alias로 쓰지 않는다. publish transaction은 sealed release, dataset completeness, quarantine 0, member count/fingerprint를 다시 검증하고 core writer 전체가 성공한 뒤 active 상태를 바꾼다.

- [ ] **Step 3: focused replay/publication gate를 통과시킨다**

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_release_publication.py apps/dataplane/tests/integration/test_replay.py -q
fnm exec --using=24.20.0 pnpm db:check
```

- [ ] **Step 4: 커밋한다**

```powershell
git add packages/db/src/schema/ingest packages/db/drizzle apps/dataplane/src/eatbid/ingest apps/dataplane/src/eatbid/pipeline/project.py apps/dataplane/tests/integration
git commit -m "feat(data): source release를 원자적으로 core에 발행한다"
```
