# 0012 — 초기 보안·관측·복구 기준

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 없음

## Context

초기 단일 노드 환경은 완전한 HA를 제공하지 못하지만 raw와 사용자 기록은 손실 비용이 크다.
수집 실패는 source, parser, code mapping, 운영 환경 중 어디서 발생했는지 추적 가능해야 한다.

## Decision

- GitOps secret은 SOPS+age로 암호화하고 workload/DB credential을 역할별 분리한다.
- 구조화 JSON log에 run/correlation ID, Git SHA, parser/projector version을 남긴다.
- raw와 DB backup을 독립 위치에 보관하고 실제 restore drill을 수행한다.
- 초기 목표는 사용자 상태 RPO 1시간, 핵심 서비스 RTO 4시간이다.
- 영업시간 열린 공고 source-to-core p95 35분을 초기 freshness SLO로 측정한다.
- 단일 노드 k3d는 HA로 표현하지 않는다.

## Consequences

- WAL/증분 백업이 준비되기 전 RPO는 목표 미달로 명시해야 한다.
- raw 삭제 권한을 일반 ingestor에서 분리하고 lifecycle 변경을 승인 대상으로 둔다.
- Argo UI, DB, metrics는 외부에 직접 공개하지 않는다.
- 규모가 생기면 OTel/Prometheus/Grafana/Loki 및 CNPG/managed PG를 측정 근거로 추가한다.

## Rejected alternatives

- “초기라 백업/관측은 나중”: 기초 데이터와 실패 근거를 복구할 수 없다.
- 지금 전체 관측/HA 플랫폼 구축: 현재 규모에서 운영 복잡성이 과도하다.
