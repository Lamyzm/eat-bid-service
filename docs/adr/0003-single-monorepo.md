# 0003 — `eat-bid-service` 단일 모노레포

- Status: Accepted
- Date: 2026-08-29
- Supersedes: Python `eat-bid`와 서비스 저장소의 분리 운영

## Context

수집기와 서비스가 다른 저장소·계약·배포 버전을 가지면 한 업무 사실의 스키마 변경이 원자적으로
진행되지 않고, 어느 저장소가 진실 원천인지 흐려진다.

## Decision

`eat-bid-service`를 생존 저장소로 삼고 Python 수집기/이력 중 보존할 자산을
`apps/dataplane`으로 흡수한다. JS/TS는 pnpm/Turborepo, Python은 uv를 사용한다. CI와
web/server/dataplane image는 하나의 Git SHA를 공유한다.

## Consequences

- cross-language 변경을 한 PR/commit에서 검증할 수 있다.
- 언어별 lockfile과 테스트 체인은 유지하되 release identity는 하나다.
- 저장소 통합 과정에서 중복 스크립트/문서는 목표 구조로 재배치한다.

## Rejected alternatives

- polyrepo + 수동 버전 조율: 초기 팀에 불필요한 계약/배포 비용을 만든다.
- Python을 TypeScript로 전면 재작성: 검증된 source 지식을 잃고 전환 위험만 늘린다.
