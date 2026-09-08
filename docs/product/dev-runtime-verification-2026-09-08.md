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

바뀌지 않은 것: API의 `ingest` 접근 금지, `observedAt`의 필수 여부와 의미(원본 관측 시각), 개찰일·제출일·발행 시각·현재 시각으로의 대체 금지, DDL과 수집 계약. 무결성 결함은 계속 500이고 연결 장애만 503이다.

## 2026-09-09 운영 자료 읽기 전용 관측

총괄이 2026-09-09 00:50:12 KST에 운영 PostgreSQL을 `REPEATABLE READ READ ONLY`, `statement_timeout` 15초로 열어 스냅샷 `566960:566960:` 하나에서 집계했다. 데이터·DDL·권한은 바꾸지 않았고 raw XML·사업자번호·자격증명은 결과에 담지 않았다.

| 항목 | 값 |
|---|---|
| 검사한 eaT revision | 67,183 |
| buyer core 라벨 `observed_at`이 raw `fetched_at`과 일치 | 67,183 |
| 구매기관 없음 / 체계 내 식별자 없음 / 같은 관측의 라벨 없음 | 0 |
| 관측 시각 충돌 / raw 불일치 / 후보 라벨 다중 | 0 |
| 최초 identifier 관측이 현재 revision 관측과 다름 | 59,978 |

표본은 공고 5271, revision 4709, observation 5053, 기관 42, code value 385이고 관측 시각은 `2026-09-06T17:18:18.429134Z`다. 그 기관의 최초 identifier 관측은 224로 달라서, 정체성 관측을 회차 시각으로 쓰면 안 된다는 것이 실제 자료에서도 확인된다. 같은 값을 `eatbid_api` 역할의 core 전용 조회로도 얻었다.

따라서 "공개 관측 시각을 담을 새 열이나 새 projection이 필요하다"는 앞의 단정은 실제 자료에서도 성립하지 않는다. Drizzle migration이나 과거 발행 자료 전환은 이 결함의 해결 조건이 아니다. 다만 이 관측은 그 스냅샷의 eaT revision에 한정되며 5년 전체 수집 완료나 앞으로 추가될 코드 체계까지 보장하지 않는다.

## 2026-09-09 수정 후 로컬 dev 인수

Claude가 명단 reader와 실제 DB 역할 통합 검사를 구현했고 총괄이 `63ebefc`, `b93baa8`, `153f7f9`를 `codex/eat-111-dev-integration`에 fast-forward했다. 실행 중인 서버의 코드 기준은 `153f7f97bdf89a7aa70e3bfaa6359a09669c08b2`다. 01:26 KST에 새 빌드의 `application_ready`를 확인했다. 이후 이 문서만 추가한 커밋은 실행 코드의 변경이 아니다.

DB 연결은 여전히 VM의 운영 PostgreSQL에 연결하는 기존 `eatbid_api` 역할이다. 독립 dev DB가 아니며, 이번 인수는 조회만 수행했다. `ingest` 권한 추가, 데이터 변경, DDL, 운영 서비스 배포는 없었다.

### 실제 API와 화면

- `GET http://127.0.0.1:4400/api/v1/auctions/5271/roster?revisionId=4709`가 HTTP 200을 반환했다. 수정 전의 HTTP 503이 해소됐다.
- 명단은 34행이고 `meta.rowCount`, `sourceRosterSize`도 각각 34다. `observedAt`은 `2026-09-06T17:18:18.429134Z`, observation 5053, normalized record 4818이다.
- 01:27:31.480114 KST, DB 스냅샷 `571847:571847:`에서 DB와 API의 34행을 비교해 불일치 0을 확인했다. 순번·submission ID·순위·원천 상태/철회·금액·비율·제출 시각·낙찰 판정과 메타데이터/출처를 대조했다. 사업자번호나 전체 응답은 보고서에 출력하지 않았다.
- 01:28:16 KST에 revision 4709 → normalized 4818 → observation 5053, parser `eat-v2`, 발행 연결 1개와 raw HTTP 200 메타데이터를 확인했다. 정규화 payload 전체와 core source payload가 동일하고 revision/raw의 hash 참조도 일치했다. 01:30:57 KST에는 정규화 34행과 core의 순번·두 금액·비율·순위·상태 코드 체계·관측 ID도 불일치 0이었다. 이 확인은 DB 계보까지이며 R2 객체 GET은 실행 Pod 목록 조회가 제한시간 내 완료되지 않아 재검증하지 못했다.
- 사용자의 기존 브라우저에서 현재 공고 89를 유지한 채 과거 회차 5271의 참여 기록 34건 → 회차 5274의 6건 → 현재 공고 89의 상세 → 5271의 기록으로 전환했다. 선택 강조와 오른쪽 패널의 대상이 일치했고 현재 공고 URL이 과거 회차로 바뀌지 않았다.
- 1280×720 화면에서 차트·필터와 오른쪽 기록 패널이 함께 보이는 것을 확인했다. 이 관측은 화면 연결 검증이며 시안과의 픽셀 일치 검증은 아니다.

### 검사 결과

- 실제 역할 통합 검사는 수정 전에 2건이 `42501`로 실패했고 수정 뒤 2건/23 assertion이 통과했다. 커밋된 migration과 `infra/product/db-provisioning.sql`을 실행하는 임시 PostgreSQL에서 API 역할의 `ingest` 접근 금지도 확인한다.
- Server 전체 검사 실행은 211건 통과, 기존 OpenAPI 기대값 1건 실패였다. 총괄이 수정 전 기준에서도 같은 실패를 재현한 뒤 현재 계약에 맞게 검사 기대값만 수정했다. 해당 OpenAPI 검사 4건이 통과했으며 공개 계약은 바꾸지 않았다.
- 최종 코드에서 총괄이 실제 역할 통합 검사와 OpenAPI 검사를 독립 실행해 6건/103 assertion 통과를 확인했다.
- `pnpm architecture:check`, `pnpm quality:check`와 통합 worktree의 `pnpm --filter @eatbid/server build`가 통과했다.
- 결정적 검사 뒤 `pnpm review:ai -- --base cbf99feae283c40f1870382e599c587f397e40a7 --provider claude`를 실행했지만 `claude:timeout`으로 advisory 결과를 받지 못했다. AI 리뷰 통과로 세지 않으며 총괄의 코드 확인과 결정적 검사에 근거해 로컬 dev를 인수했다.

## 남아 있는 범위

이번 인수로 실제 최소 권한 역할에서 과거 회차 명단이 API와 로컬 dev에 연결되는 조건을 확인했다. 운영 배포·CI/PR 인수·시안 전체 일치·5년 전체 수집 완료는 이 기록으로 검증되지 않는다. Linear 상태는 이 문서가 아니라 해당 이슈가 소유한다.

EAT-115에서는 일반 표와 확대 표의 열·기록 진입을 하나로 통합한다. 현재 확대 표는 전역 기록 패널을 가리는 모달이고, 조회한 두 번째 페이지 이후의 회차 선택과 확대 복귀 시 페이지 유지에도 문제가 남아 있다. 기존 본문 확대와 전역 패널을 재사용하고, 같은 필터에서 불러온 회차를 확대 여부와 독립적으로 유지하는 것이 다음 인수 범위다.
