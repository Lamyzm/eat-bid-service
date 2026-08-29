# 0008 — 세 deployable과 Server 모듈러 모놀리스

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 없음

## Context

도메인 경계는 필요하지만 제품 초기 단계에서 각 경계를 네트워크 서비스로 분리하면 transaction,
관측, 배포, 계약 비용이 가치보다 크다. Web, 사용자 API, batch 수집은 런타임 성격은 다르다.

## Decision

배포 단위는 `web`, `server`, `dataplane` 세 개다. Server는 procurement, institutions,
suppliers, eligibility, workspace, intelligence, contracts, operations 모듈을 가진 NestJS 모듈러
모놀리스다. 모듈은 명시적 application interface로 협력하고 다른 모듈 데이터를 임의 수정하지 않는다.

## Consequences

- 로컬 transaction과 리팩터링 속도를 유지하면서 도메인 소유권을 분명히 한다.
- Web은 DB에 직접 접근하지 않는다.
- 독립 scaling/failure/ownership의 측정 근거가 생긴 모듈만 후속 ADR로 분리할 수 있다.

## Rejected alternatives

- 단일 거대 root module: 의존성과 데이터 소유권을 숨긴다.
- 초기 마이크로서비스: 분산 시스템 비용을 조기에 부과한다.
