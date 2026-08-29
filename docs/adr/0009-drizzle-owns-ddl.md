# 0009 — Drizzle migration이 유일한 DDL 경로

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 수기 `schema.sql`, `db:push`, 중복 schema 정의

## Context

TypeScript schema, 수기 Kubernetes SQL, loader 기대 구조가 각각 변하면 실제 운영 DDL과 코드가
달라진다. destructive change의 검토/순서/복구 기록도 남지 않는다.

## Decision

`packages/db` Drizzle schema만 DDL을 작성한다. 생성된 SQL migration을 검토·커밋하고 동일 Git
SHA의 migration image가 배포 전에 한 번 적용한다. 운영 `db:push`와 ConfigMap DDL은 금지한다.
Python dataplane은 기대 migration/schema version을 확인하되 DDL을 소유하지 않는다.

## Consequences

- 빈 DB에서 전체 migration chain을 CI로 검증해야 한다.
- migration은 forward-compatible rollout 순서와 명시적 timeout/failure를 가져야 한다.
- DB schema type과 공개 HTTP contract는 별도로 유지한다.

## Rejected alternatives

- schema.sql 단일 파일: 변화 이력과 안전한 배포 순서가 없다.
- ORM `push` 자동 동기화: 운영 변경을 리뷰 가능한 artifact로 만들지 못한다.
