# Data foundation capability gate

이 문서는 자동 검증된 **Task 13 capability**와 실제 외부 시스템에서 수행한 **execution evidence**를
분리한다. 오프라인 테스트 통과를 live eaT/R2/Argo 실행으로 표현하지 않는다.

## 자동 capability evidence

| 증거 | 명령/테스트 | 기대·확인 값 | 상태 |
|---|---|---|---|
| fixture vertical slice | `pytest ...test_foundation_slice.py::test_raw_to_core_and_replay_foundation_slice` | capture/publication/core/replay 1 member, 두 publication `published`; focused file 2 passed | **PASS** |
| raw content address | 같은 테스트의 DB assertion | SHA-256 `f06489c6ee6f7aec1df877a16ef9369658f2e5a96574ea96ced63493e9299e07`, key `raw/eat/bid-detail/<sha>.xml.gz`, 1,618 bytes | **PASS** |
| capture completeness | 같은 테스트의 run/request-unit assertion | detail plan `expected_count=1`, observation/normalized/published 각 1 | **PASS** |
| exact publication member | 같은 테스트의 publication/lineage assertion | capture/replay publication별 frozen member 1, direct normalized-record→revision lineage | **PASS** |
| canonical identity | 같은 테스트의 core SQL assertion | Organization/AuctionAttempt/AuctionRevision 각 신규 1, relation PK/FK는 bigint, code relation 3 | **PASS** |
| replay determinism | 같은 테스트 | 새 replay run/publication, 원 observation/raw 재사용, canonical duplicate 0, fingerprint `6f2d955b5d76e5aa60fc015dbb25e2a134504c6b5e0d0c29d936fa4822b39658` 동일 | **PASS** |
| raw deduplication | `test_capture.py::test_same_body_is_one_blob_and_two_append_only_observations` | identical bytes → raw blob 1, observations 2; full suite에 포함 | **PASS** |
| quarantine/count failure | Task 13 failure test + Task 8 quarantine/count-preservation tests | typed failure, failed publication, 신규 core write 0, 기존 core 유지 | **PASS** |
| migrations | disposable PostgreSQL 16에 migration command 두 번 + journal query | 두 번 모두 성공, latest `20260829002500_core_projection_lineage`, container 제거 | **PASS** |
| product render policy | `kubectl kustomize infra/product` + parsed policy test | 18 documents, native CronJob 0, hostPath 0, literal PostgreSQL credential 0, digest product image ref 9, CronWorkflow 2개 suspended | **PASS** |

`bid-detail-one.xml`에는 list `TOT_CNT`가 없다. Task 13에서 검증한 `1`은 동결된 detail request plan의
`expected_count`이지 live list의 `TOT_CNT`가 아니다. list raw archive, `TOT_CNT`, pagination/detail plan
대조는 Task 14 외부 source boundary가 구현되기 전까지 PASS로 기록하지 않는다.

## 최종 자동 gate 명령

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_foundation_slice.py -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_foundation_slice.py apps/dataplane/tests/integration/test_replay.py apps/dataplane/tests/integration/test_project.py apps/dataplane/tests/integration/test_normalize_validate.py -q
uv run --project apps/dataplane pytest apps/dataplane/tests --cov=eatbid --cov-fail-under=90 -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
uv run --project apps/dataplane pyright apps/dataplane/src
pnpm test
pnpm exec turbo build --force
pnpm architecture:check
pnpm db:check
pnpm db:generate
```

`pnpm db:generate` 전후 `git status --short`에 새 migration/snapshot diff가 없어야 한다. product manifest
정책은 [runbook](data-foundation-runbook.md)의 parsed render command와
`infra/tests/test_workflow_contract.py`로 확인한다. source grep은 transitive Kustomize delete patch를
증명하지 못하므로 render 결과를 우선한다.

2026-08-30 검증 결과:

- Task 13 focused: 2 passed
- reverse integration `Task13 → Task10 → Task9 → Task8`: 131 passed
- full dataplane: 330 passed, total coverage 92.14% (`--cov-fail-under=90` 통과)
- Ruff: pass, Pyright: 0 errors/0 warnings
- root Bun: 119 passed
- forced Turbo build: web/server/shared/db 4/4 성공, cache 0
- architecture stack check와 Drizzle check: pass; `db:generate`: schema diff 0
- architecture grep: raw 3건은 모두 `db:push` 부재를 강제하는 negative test, active-path match 0
- workflow contract: 9 passed; parsed product render policy: pass

## 외부 execution evidence

| 외부 증거 | 필요한 값 | 상태 |
|---|---|---|
| dataplane image | Git SHA, immutable digest, signature/attestation | **NOT RUN — Task 14 approval gate** |
| live source request | 승인된 request budget, endpoint, HTTP counts, list `TOT_CNT`, schema fingerprint | **NOT RUN — Task 14 approval gate** |
| live R2 raw | bucket/object key, provider timestamp, hash/head verification | **NOT RUN — Task 14 approval gate** |
| Argo execution | Workflow UID, template revision, image digest, phase, step exit categories | **NOT RUN — Task 14 approval gate** |
| schedule activation | 승인자, resume change, first-run evidence | **NOT RUN — Task 14 approval gate** |

외부 evidence가 NOT RUN인 동안 두 CronWorkflow는 `spec.suspend: true`여야 한다. capability test만으로
schedule을 재개하거나 Task 14 승인 gate를 통과한 것으로 간주하지 않는다.
