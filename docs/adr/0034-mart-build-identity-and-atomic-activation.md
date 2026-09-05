# 0034 — mart build 정체성과 원자적 활성화

- Status: Proposed
- Date: 2026-09-06
- Supersedes: 없음. [0011](0011-versioned-derived-analytics.md)이 정한 "버전된 재생성 가능
  파생물"을 실행 가능한 경계로 푼다.

## Context

`mart.org_round_summary`는 이미 있고 기관 회차 이력 endpoint가 읽고 있지만 빌더가 없어 비어 있다.
그 표의 계보 열은 자유 문자열 `mart_release` 하나여서 어떤 봉인된 입력 집합을 읽었는지 재현되지
않는다. ADR 0011은 `sample_n`·cohort/period·source release/run set·`computation_version`·`as_of`·
`built_at`을 요구하고 `docs/architecture/runtime-and-deployment.md` §4-6은 새 build ID로 만든 뒤
원자적으로 활성화하라고 요구한다. 지금은 전환할 대상 자체가 없다.

동시에 지켜야 할 경계가 둘이다. 런타임에 DDL을 만들지 않는다(ADR 0009, AGENTS 10). 그리고 부분
결과가 현재 공개 뷰를 덮어쓰지 않는다(ADR 0010).

2026-09-06 일회용 PostgreSQL 16.13 실측에서 5년 전국 규모(74만 회차·2,774만 명단 행)의
`org_round_summary` 전량 재빌드가 6.7초, `win_rate_distribution_monthly`가 4.6초였다. 두 mart를
합쳐 15초 안쪽이고 build 한 벌의 저장 비용은 160~220 MB다.

## Decision

`mart.build`가 빌드 정체성을 소유한다. 열은 `mart_name`, `source_release_id`, `publication_id`,
`calc_version`, `builder_version`, `region_scheme`, `status`, `as_of`, 네 시각(`started_at`,
`computed_at`, `activated_at`, `superseded_at`), `row_count`, `retain_until`, `failure_category`다.
멱등 키는 `unique nulls not distinct (mart_name, calc_version, source_release_id, publication_id)`
이며, `publication_id`가 null인 수동 전량 재빌드도 같은 입력으로 두 번 만들어지지 않는다.

모든 mart 행의 첫 열은 `build_id`이고 나머지 계보는 `mart.build`가 한 벌만 갖는다. 같은 사실을
수백만 행에 복제하면 권위가 둘이 되고 한쪽만 바뀌는 순간을 DB가 막지 못한다(AGENTS 1). 읽기
경로는 활성 build 하나를 조인해 응답 meta에 계보를 싣는다.

활성 build는 `create unique index on mart.build (mart_name) where status = 'active'`로 mart마다
최대 하나가 DB 제약이다. 전환은 이전 active를 `superseded`로, 새 `verified`를 `active`로 바꾸는 한
트랜잭션이며 DDL이 없다. 동시 전환은 두 번째가 partial unique index 위반으로 끊긴다.

상태 전이는 `building→verified`, `building→failed`, `verified→active`, `active→superseded`
넷만 trigger가 허용한다. 같은 규율의 두 번째 trigger가 **활성·봉인된 build에 속한 mart 행의
INSERT·UPDATE·DELETE를 거부한다.** 쓰기는 `building` build에만 가능하고, 예외는 `retain_until`이
지난 build의 회수 삭제다. "부분 수집 결과로 현재 공개 뷰를 덮어쓰지 마라"가 문장이 아니라 제약이
된다.

빌드 단위는 mart 전체다. 행 단위 증분을 만들지 않는다. "영향 범위"는 어느 mart를 다시 만들지의
문제로 해석한다. 전량 빌드가 결정적이고, `verified` 검증이 `row_count`와 표본 합계 하나로 단순해지며,
실측이 그 비용을 감당한다. `org_round_summary` 전량 빌드가 60초를 넘으면 개찰 연도 `partition_key`를
`mart.build`에 더하고 활성 포인터를 `(mart_name, partition_key)`로 넓힌다 — 그때까지는 만들지
않는다(AGENTS 11).

지역 코드 체계는 열이 아니라 build의 속성이다. mart 행은 `region_code_value_id` FK 하나만 갖고
어떤 `CodeScheme`으로 만든 build인지는 `mart.build.region_scheme`이 기록한다. 지금 build는
`eat:auction-location-sigungu`/`-sido`로 만들고, 행정안전부 코드를 적재한 뒤에는 새 `calc_version`의
새 build가 `mois:administrative-region`으로 만든다. 두 체계의 build가 같은 표에 공존하되 서로를
오염시키지 않으며, 전환이 침묵하지 않는다(AGENTS 6).

빌드는 Argo `marts` 단계에서만 실행하며 mutex는 `eatbid-mart-build`로 core 발행과 분리한다.
mart는 파생물이라 stale이 정상 상태이므로(ADR 0011) 발행이 빌드를 기다리지 않는다.

## Consequences

- 전환 순간 mart 하나가 두 벌 존재한다. 실측 160~220 MB이고 mart 셋을 합쳐 1 GB 미만이다.
- 빌드 실패는 활성 포인터를 움직이지 않아 화면이 이전 build를 계속 읽는다. stale은 오류가 아니며
  활성 build가 아직 없는 상태도 오류가 아니라 빈 목록이다.
- `mart_release` 열과 공개 계약의 `martRelease` meta가 `buildId`/`sourceReleaseId`로 바뀐다.
  스키마·서버 어댑터·계약·web 소비자가 한 변경에서 함께 움직인다.
- `eatbid_dataplane`이 `mart`에 DML 권한을 얻는다. `CREATE`는 주지 않는다.
- superseded build의 회수는 `retain_until` 뒤 별도 단계다. `open_auction_snapshot`만 참여 수 추이가
  지난 24시간의 관측점을 보므로 이 창을 길게(기본 7일) 잡는다.

## Rejected alternatives

- **표 이름 바꾸기(`rename`)로 전환한다** — 런타임 DDL이고 AGENTS 10과 부딪힌다.
- **`build_id`로 파티션하고 `ATTACH`/`DETACH`로 전환한다** — 같은 이유. 파티션 추가는 마이그레이션
  lane이라고 `runtime-and-deployment.md` §5가 이미 정했다.
- **계보 네 값을 행마다 복제한다** — 같은 사실의 권위가 둘이 된다. build FK 하나로 충분하다.
- **행 단위 증분 빌드** — 이전 build에서 무엇을 물려받았는가라는 상태를 하나 더 만든다. 실측이
  전량 재빌드를 지지한다.
- **`project`와 같은 mutex를 쓴다** — mart 빌드가 다음 수집의 발행을 막아 소스 관측이 늦어진다.
- **지역 체계를 열 이름에 적는다** — 나중에 체계를 바꾸면 같은 열의 의미가 조용히 바뀌고 저장된
  과거 build의 해석이 사후에 달라진다.
