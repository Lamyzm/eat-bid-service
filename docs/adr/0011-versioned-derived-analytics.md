# 0011 — 분석은 버전된 재생성 가능 파생물

- Status: Accepted
- Date: 2026-08-29
- Supersedes: master 행의 분석 JSON과 출처 없는 단일 수치

## Context

입찰 분석은 제품 핵심이지만 코호트, 기간, 데이터 기준시점, 계산 규칙에 따라 달라진다. 분석을
master 사실과 섞으면 정체성과 계산 수명주기가 결합되고 결과를 설명/재생성할 수 없다.

## Decision

분석은 PostgreSQL `mart`에 별도 build로 생성한다. 모든 결과는 `sample_n`, cohort/period,
source release/run set, `computation_version`, `as_of`, `built_at`을 가진다. 새 build를 검증한 뒤
원자적으로 활성화하며 이전 build를 감사/비교 정책에 맞춰 보존한다.

## Consequences

- 분석 규칙 변경이 canonical source fact를 수정하지 않는다.
- 동일 과거 기준시점 replay와 전후 비교가 가능하다.
- UI는 수치와 함께 표본·기간·기준시점·근거를 표시해야 한다.
- mart는 삭제/재생성 가능해야 하며 사용자 상태를 담을 수 없다.

## Rejected alternatives

- API 요청 시 전부 즉석 계산: 재현성/성능/버전 가시성이 약하다.
- Organization/Auction JSON column에 캐시: 계산과 master identity를 결합한다.
