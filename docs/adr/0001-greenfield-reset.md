# 0001 — 그린필드 재설계와 선택적 자산 보존

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 기존 비공식 현행 설계 문서의 목표 아키텍처 지위

## Context

제품은 초기 단계이며 현재 DB, URL, API, Parquet/loader, 문자열 키, CronJob에 대한 호환성이
새 모델의 복잡성을 정당화하지 않는다. 반면 raw XML과 source 지식은 다시 얻기 어렵다.

## Decision

목표 구조를 그린필드로 설계한다. 기존 구조를 새 모델의 제약으로 삼지 않는다. raw 응답,
검증된 source identifier/불변식/fixture, endpoint 지식, 제품 연구, 명확히 매핑되는 사용자 상태만
보존한다. 전환 게이트는 [legacy-disposition.md](../architecture/legacy-disposition.md)를 따른다.

## Consequences

- 호환 shim, 장기 dual-write, 옛 URL/PK 보존 비용을 지지 않는다.
- 데이터 이관은 자동 신뢰가 아니라 dry-run·충돌 보고·승인 대상이다.
- 기존 구현을 삭제하기 전에 raw/사용자 상태의 복구 가능성을 먼저 검증해야 한다.

## Rejected alternatives

- 현 스키마를 점진적으로 확장: 잘못된 grain과 문자열 identity를 장기간 유지한다.
- 전부 폐기하고 재수집: 원본 증거와 검증된 source 지식을 잃는다.
