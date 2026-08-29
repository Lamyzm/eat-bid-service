# 0004 — 소유권별 데이터 권위 사슬

- Status: Accepted
- Date: 2026-08-29
- Supersedes: raw/Parquet/serving DB가 동시에 진실 원천인 구조

## Context

원본 증거, source 사실의 해석, 사용자 기록, 분석 결과는 변경 주체와 복구 방법이 다르다.
이를 한 테이블에 섞거나 여러 저장소에서 동시에 authoritative하게 유지하면 불일치가 생긴다.

## Decision

- R2 raw: source가 보낸 불변 증거
- PostgreSQL `ingest`: 실행/관측/격리 제어 상태
- PostgreSQL `core`: 검증·발행된 canonical source facts
- PostgreSQL `app`: user-authored workspace state
- PostgreSQL `mart`: 버전된 재생성 가능 분석

각 사실의 쓰기 주체와 DB role을 분리한다.

## Consequences

- raw를 고쳐 canonical 문제를 숨길 수 없다. 새 parser로 replay한다.
- `mart`를 삭제해도 제품 사실과 사용자 상태는 남아야 한다.
- API는 `core`/`mart` read-only, `app` write 권한을 가진다.

## Rejected alternatives

- 한 스키마/테이블에 모든 데이터 혼합: 소유권과 복구 경계가 사라진다.
- raw만 SSOT로 선언: 대화형 애플리케이션의 일관된 업무 해석을 제공하지 못한다.
