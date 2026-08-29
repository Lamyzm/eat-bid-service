# 0007 — Argo CD와 Argo Workflows의 런타임 경계

- Status: Accepted
- Date: 2026-08-29
- Supersedes: Kubernetes CronJob 기반 crawler scheduling

## Context

배포 동기화와 데이터 작업 실행은 실패·재시도·동시성·감사 요구가 다르다. CronJob, 앱 scheduler,
workflow scheduler가 병존하면 중복 수집과 운영 모호성이 생긴다.

## Decision

Argo CD는 platform/product 리소스를 배포한다. Argo Workflows만 poll, reconcile, backfill,
replay를 실행한다. 동일 WorkflowTemplate과 dataplane image를 사용하고 source semaphore,
projector mutex, typed exit, completeness gate를 적용한다. 기존 CronJob은 cutover 후 제거한다.

## Consequences

- 정기/수동/재처리 경로가 동일한 코드와 제약을 공유한다.
- Argo Workflows CRD/controller를 platform application으로 먼저 배포해야 한다.
- workflow pod는 stateless이며 hostPath/SQLite/shared JSON을 계약으로 사용할 수 없다.

## Rejected alternatives

- CronJob 유지 + backfill만 Workflows: 실행 경로와 장애 대응이 다시 갈라진다.
- Argo CD hook으로 정기 수집: 배포와 업무 실행 수명주기를 혼동한다.
- Airflow/Dagster 추가: 현재 Kubernetes/작업 규모에 중복 플랫폼이다.
