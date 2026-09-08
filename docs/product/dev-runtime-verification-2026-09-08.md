# 2026-09-08 실제 역할의 dev 검증

이 기록은 EAT-111 dev 통합과 EAT-114 명단 조회의 실행 증거다. 시안 일치, 운영 배포 또는 MVP 전체 완료를 뜻하지 않는다.

## 실행 기준

- 코드: `codex/eat-111-dev-integration`, `0b61e84`.
- 로컬 Web `127.0.0.1:3002`, 같은 worktree의 Nest `4400`.
- VM PostgreSQL 서비스에 localhost 포워드를 열고 기존 `eatbid_api` 역할로 연결했다. 비밀은 Infisical child 환경에만 주입했다.
- worktree와 VM의 마지막 migration은 `20260906043400_canonical_code_releases`, journal 시각은 `1788669240000`으로 일치했다.
- 23:33–23:35 KST에 실제 역할의 readiness SELECT가 통과했다. DB 데이터·DDL·권한은 변경하지 않았다.
- `dev:/runtime/server`에는 DB 연결값이 없어서 검증한 `prod:/runtime/server`의 제한된 API 역할을 사용했다. 이는 독립된 dev DB를 구축했다는 의미가 아니다.

## 화면에서 확인한 결과

사용자의 기존 Chrome 세션을 새로고침해 공고 89를 열었다. 현재 공고 제목과 하한 `88.000`, 기관 이력 10행, 각 행의 정확한 비율과 기록 버튼이 표시됐다. 현재 선택 조건은 12개월·하한 88·같은 낙찰 방식이다. 미필터 API의 12행과 화면의 10행은 같은 코호트가 아니다.

과거 회차 5271(8월 5일 농산물)을 선택하면 오른쪽 선택 기록 패널이 열리고 현재 공고 제목은 유지된다. 그러나 실제 명단 요청은 `503 DEPENDENCY_UNAVAILABLE`로 실패했다. 버튼 진입 성공과 명단 조회 성공을 구분해야 한다.

## 발견한 경계 위반

`apps/server/src/modules/procurement/infrastructure/drizzle/auction-roster-query.ts`는 `ingest.raw_observation`을 JOIN해 명단의 `observedAt`을 읽는다. 실제 SQL을 read-only transaction의 `eatbid_api` 역할로 실행하면 `42501: permission denied for schema ingest`가 재현된다.

이는 권한 누락이 아니다. `infra/product/db-provisioning.sql`과 readiness는 API의 `ingest` 접근을 의도적으로 금지한다. 명단의 `core.bid_submission`·`core.award_decision` 읽기 권한은 있다. 진단 SELECT에서 금지 JOIN만 제거하면 5271 명단은 34행, 기대 34행, 고유 순번 34개로 일치한다.

현재 `core.auction_revision`과 그 `source_payload`에는 해당 raw 관측의 정확한 `fetched_at`이 없다. 공개 명단 계약은 `observedAt`을 필수로 요구하므로 JOIN만 삭제하거나 임의 시각을 채우는 수정은 불완전하다. 라벨 관측일·개찰일·제출일을 대신 사용하거나 API에 `ingest` 접근 권한을 주지 않는다.

## 후속 인수 조건

EAT-114에서 공개 관측 시각을 소유할 canonical 표현과 projection을 먼저 정한다. 저장 표현이 필요하면 Drizzle migration 및 과거 발행 자료 전환을 같은 검토 단위로 수행한다. EAT-110의 DB writer와는 직렬로 인계한다.

- 실제 `eatbid_api` 역할로 명단 endpoint를 호출하는 PostgreSQL 통합 테스트를 추가한다.
- `ingest` 접근 금지를 유지한 채 공고와 특정 revision의 명단 조회가 성공해야 한다.
- 관측 시각이 보존 원본과 같고 명단 34행의 순번·금액·비율·판정이 일치해야 한다.
- 현재 공고 89를 유지하며 5271 선택 → 명단 확인 → 다른 회차 선택을 dev에서 다시 검증한다.

이전 별도 환경의 명단 조회 증거는 이번 실제 최소 권한 검증을 대신하지 않는다. EAT-114는 완료로 전환하지 않는다.
