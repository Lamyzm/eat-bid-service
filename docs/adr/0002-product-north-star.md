# 0002 — 분석 엔진과 다사업자 운영 워크스페이스

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 없음

## Context

단순 공고 목록/기록 앱으로는 입찰 분석이라는 핵심 가치를 설명할 수 없고, 분석만 제공하면
사용자의 발견·검토·입력·복기 흐름에 연결되지 않는다. 사용자는 여러 법적 사업자를 운영한다.

## Decision

제품을 “정부 원본 기반 입찰 분석 엔진 + 급식 입찰 운영 워크스페이스”로 정의한다. 업무
grain은 `Workspace × SupplierParty × AuctionAttempt`다. 분석은 표본·기간·기준시점·버전·
출처를 가진다. 추천가/예측가/자동 투찰은 시스템 경계 밖이다.

## Consequences

- 같은 공고의 사용자 상태를 사업자별로 분리한다.
- recorded value, 사용자 NeaT 입력 확인, source-observed submission을 각각 모델링한다.
- 지역 조건 일부만 확인하고 전체 자격 충족으로 표현할 수 없다.

## Rejected alternatives

- 공고 중심 전역 찜/상태: 다사업자 운영에서 상태가 충돌한다.
- 분석 전용 대시보드: 실제 업무 전환과 복기 폐회로를 만들지 못한다.
