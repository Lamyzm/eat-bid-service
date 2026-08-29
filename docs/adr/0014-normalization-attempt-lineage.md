# 0014 — immutable raw evidence와 run-scoped normalization attempt

- Status: Accepted
- Date: 2026-08-29
- Supersedes: `raw_observation`에 parser 해석 상태를 함께 기록하는 설계

## Context

하나의 HTTP 응답은 다른 parser 버전으로 여러 번 재처리될 수 있다. parser 상태와 schema
fingerprint를 원래 `raw_observation`에 쓰면 새 replay가 과거의 성공·격리 결과를 덮어쓰거나,
capture run의 parser 버전에 묶여 독립적인 해석 이력을 만들 수 없다. 반대로 replay를 새 HTTP
관측처럼 복제하면 실제 요청 provenance가 왜곡된다. 검증된 publication도 run join을 매번 다시
계산하면 이후 staging 변화가 과거 발행 집합에 섞일 수 있다.

## Decision

R2 raw 객체와 `ingest.raw_observation`은 불변 HTTP 증거만 소유한다. source identity,
schema fingerprint, parser status, quarantine reason은 raw observation의 속성이 아니다.

각 해석은 `normalization_attempt(run_id, observation_id, parser_version)`가 소유한다. attempt는
최종 `normalized` 또는 `quarantined` 상태이며 같은 키에서 상태와 metadata를 바꾸지 않는다.
성공 attempt는 lowercase SHA-256 schema fingerprint와 하나 이상의
`normalization_attempt_record` member를 repository transaction으로 보장한다. 격리 attempt는
bounded reason을 가지며 member를 갖지 않는다. deterministic `normalized_record`는 전역 key로
insert-or-verify하고 여러 processing run이 같은 record를 재사용할 수 있다.

eaT source boundary는 `(source, endpoint, parser_version)`별로 사람이 검토한 dataset/column
shape를 코드에 선언하고 parser와 같은 canonical algorithm으로 fingerprint를 계산한다. 관측된
attempt fingerprint가 이 contract와 다르거나 contract key가 없으면 raw와 attempt는 보존하되
publication은 `SOURCE_CONTRACT`로 실패한다. PostgreSQL adapter는 eaT shape 상수를 소유하지
않고 source-contract validator를 port로 주입받는다.

capture/backfill processing run은 자기 `raw_observation`만 입력으로 삼는다. replay run은 새
관측을 만들지 않고 `replay_input(run_id, observation_id)` manifest로 기존 증거를 명시한다.
호출 parser version은 원래 capture run이 아니라 processing run과 일치해야 한다.

publication validation은 current run/parser의 final attempt와 그 attempt-record member만 잠그고
다시 센다. 완전성 gate를 통과한 exact normalized member ID 집합을
`publication_record(publication_id, normalized_record_id)`에 동결한다. 이후 projector의 유일한
입력은 이 manifest이며 raw/run join을 다시 계산하지 않는다.
terminal 재검증도 빠르게 저장 count만 반환하지 않는다. candidate observation에서 current
run/parser attempt와 attempt-record exact sorted member set을 다시 잠그고 계산한 뒤 run/publication
status, metadata, count, frozen member와 모두 비교한다.

## Consequences

- 같은 raw를 새 replay run이나 parser로 해석해도 과거 attempt와 capture provenance가 보존된다.
- normalized record 재사용과 해석 이력은 분리되며 join table의 N:M 관계가 이를 명시한다.
- 격리와 성공은 run-scoped final state라서 재호출은 멱등이고 반대 상태로 회귀하지 않는다.
- publication 이후 생긴 staging record는 기존 publication에 암묵적으로 편입되지 않는다.
- 같은 개수의 다른 member로 치환하거나 terminal status를 바꾸면 재검증이 integrity error로
  거부한다.
- 미검토 source column은 증거에서 삭제하지 않고 reviewed contract가 갱신될 때까지 발행만 막는다.
- attempt와 member의 cross-row 불변식은 DB check만으로 완결되지 않아 transaction과 behavior
  test가 함께 강제한다.

## Rejected alternatives

- mutable parser columns on `raw_observation`: 새 replay가 과거 해석을 덮어쓴다.
- replay마다 raw observation 복제: 실제로 없던 HTTP 요청과 capture run을 발명한다.
- `raw_observation.run_id`로 normalized output 재계산: replay processing run과 exact output set을
  표현하지 못한다.
- projector가 publication 시점의 run join을 재실행: staging 변화로 과거 발행 입력이 달라진다.
