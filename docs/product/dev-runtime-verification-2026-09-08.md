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

## 2026-09-09 정정 — core에 정확한 관측 시각이 이미 있다

위 조사가 "`core`에는 해당 raw 관측의 정확한 `fetched_at`이 없다"고 단정한 것은 사실이 아니었다. `core.auction_revision`의 열과 `source_payload`만 본 결론이며, 같은 발행 transaction이 남기는 코드 라벨 증거를 보지 않았다.

발행 경로는 raw `fetched_at`을 그대로 라벨 관측 시각으로 투영한다. `apps/dataplane/src/eatbid/core/postgres_repository.py`의 frozen member reader가 `ingest.raw_observation.fetched_at`을 읽고, `projection_stream.py`가 그 값을 `apply`에 넘기며, `postgres_projection_writer.py`의 `apply`가 수집 계약상 필수인 구매기관 이름을 같은 transaction에서 `postgres_code_values.resolve_label`로 `core.code_label_observation.observed_at`에 앉힌다. `resolve_label`은 같은 증거에 다른 시각이 붙는 것을 거절한다.

따라서 필요한 것은 새 열도 새 projection도 아니라 읽는 관계의 정정이다. 선택한 revision → `auction_organization`(role=purchaser) → `organization_identifier` → `eat:organization` 소유 체계의 `code_value` → 그 revision의 `observation_id`를 가진 `code_label_observation`이다. `organization_identifier.observation_id`는 정체성을 처음 이은 관측이라 회차의 관측 시각이 아니고, 다른 소유 체계의 라벨은 같은 시각으로 섞지 않는다. 후보가 하나의 시각으로 모이지 않으면 값을 고르지 않고 무결성 결함으로 닫는다.

바뀌지 않은 것: API의 `ingest` 접근 금지, `observedAt`의 필수 여부와 의미(원본 관측 시각), 개찰일·제출일·발행 시각·현재 시각으로의 대체 금지, DDL과 수집 계약.

## 이 기록이 검증한 것과 검증하지 않은 것

- 검증함: 2026-09-08 dev에서 실제 `eatbid_api` 역할의 readiness와 화면 진입, 그리고 명단 요청이 `42501`로 실패한다는 사실.
- 검증하지 않음: 정정한 조회가 운영 자료에서 내는 값. dev의 회차 5271 명단 34행과 그 관측 시각은 총괄의 읽기 전용 재검증 결과가 나오기 전까지 이 문서에 적지 않는다.

## 후속 인수 조건

- 실제 `eatbid_api` 역할로 명단을 읽는 PostgreSQL 통합 검사를 둔다. 저장소에서는 `apps/server/src/testing/auction-roster.integration.test.ts`가 커밋된 migration과 `infra/product/db-provisioning.sql`을 그대로 실행해 이 조건을 닫았다.
- `ingest` 접근 금지를 유지한 채 공고와 특정 revision의 명단 조회가 성공해야 한다.
- 총괄이 dev에서 읽기 전용으로 확인할 것: 공고 89를 유지한 채 5271 선택 → 명단 확인 → 다른 회차 선택, 명단 행 수와 순번·금액·비율·판정, 그리고 공개된 관측 시각이 보존 원본의 `fetched_at`과 같은 값인지.

이전 별도 환경의 명단 조회 증거는 이번 실제 최소 권한 검증을 대신하지 않는다. EAT-114는 완료로 전환하지 않는다.
