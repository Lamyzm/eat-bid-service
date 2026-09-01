---
name: eatbid-dataplane-invariants
description: eaT capture, normalization, validation, projection, replay, publication, Argo WorkflowTemplate, retry 정책, 동시성 제어 또는 dataplane 복구 동작을 변경할 때 사용한다.
---

# Eatbid 데이터플레인 불변식

처리량이나 비용을 최적화하기 전에 증거 보존과 publication 안전성을 지킨다.

## 현재 실행 계약 확인

`docs/architecture/domain-and-data.md`, `docs/architecture/runtime-and-deployment.md`의 관련 절과 현재 WorkflowTemplate·계약 테스트를 읽는다. Argo retry를 제안하기 전에 실제 CLI 종료 범주를 확인한다.

변경을 단계별로 분류한다.

| 단계 | 필수 불변식 |
| --- | --- |
| capture | canonical 노출 전에 immutable raw byte를 보관하고 관측 metadata를 append한다. |
| normalize | parser/version 출력은 결정적이어야 하며, 잘못됐거나 알 수 없는 입력은 추측하지 않고 quarantine한다. |
| validate | membership을 고정하기 전에 정확한 request, observation, attempt, record 완전성을 확인한다. |
| project/publish | 저장소가 소유하는 단일 transaction, insert-or-verify 의미론과 atomic activation을 사용한다. |
| replay | 고정된 정확한 observation manifest로 새 run을 만들며 원래 증거는 바꾸지 않는다. |

부분 결과가 active publication을 대체하면 안 된다.

## Retry 판단

idempotent 또는 re-entrant 연산의 typed transient failure에만 제한된 횟수와 deadline을 두고 retry한다.

- network timeout/reset과 선택된 5xx는 retry할 수 있다.
- 403, 429, 잘못된 설정, schema·contract 위반, quarantine, 결정적 projection conflict는 중단한다.
- CLI가 transient와 terminal 종료 범주를 신뢰성 있게 제공하기 전에는 `retryStrategy`를 추가하지 않는다.
- retry 사이에도 같은 logical idempotency key와 immutable input을 유지한다.

## Memoization 판단

기본값은 Argo memoization 미사용이다. 단계가 pure임이 입증되고, key가 모든 immutable input과 code/schema/parser version을 포함하며, 실행 생략이 새 observation·validation·lock·side effect를 빠뜨리지 않을 때만 허용한다.

capture observation, completeness validation, DB projection, publication activation, failure recording은 memoize하지 않는다. workflow cache가 아니라 R2 content addressing과 durable PostgreSQL checkpoint를 resume·deduplication 권위로 사용한다.

## 동시성과 lineage

- 외부 capture에는 선언된 source semaphore를, projector·activation에는 publication mutex를 사용한다.
- 하나의 문서화된 DB lock 순서를 유지하고 concurrent retry와 deadlock 동작을 테스트한다.
- 모든 published fact는 run, request, observation/raw blob, normalization attempt/version, frozen publication membership, projection version까지 추적할 수 있어야 한다.
- 실패한 candidate는 기존 active publication을 유지하고, 필요한 경우 새 transaction에서 실패를 기록한다.

## 검증 증거

Hypothesis로 순열, 중복, 누락 member, count, fingerprint 속성을 검사한다. commit과 activation 경계에서 PostgreSQL/R2 통합 fault injection을 수행한다. 순차·동시 retry가 run, attempt, revision, publication을 중복 생성하지 않음을 입증한다.

Argo manifest를 render·lint하고 retry expression, limit/backoff, mutex/semaphore, suspended CronWorkflow, 위험한 memoization 부재를 검사한다. dataplane lint/typecheck/test와 `pnpm architecture:check`, `pnpm test:quality`를 실행한다.

현재 live workflow는 dormant 상태다. manifest가 바뀌었다는 이유만으로 live source/R2에 submit, sync, resume, call하지 않는다. 이는 별도의 명시적 승인과 운영 gate 증거가 필요하다.
