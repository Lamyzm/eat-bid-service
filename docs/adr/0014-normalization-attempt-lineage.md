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

`ReplayRunRepository`만 replay run을 만들 수 있다. 호출자가 제공한 run/publication UUID,
build/parser version, timezone-aware start time, 중복 없는 positive observation ID 전체를 DB 접근 전에
검증한다. 그 뒤 idle connection의 repository-owned transaction 하나에서 `mode='replay'` run,
`status='pending'` publication, 정렬한 exact `replay_input` 전체를 함께 생성한다. observation 하나씩
나중에 추가하는 API는 두지 않는다. 기존 run을 재호출하면 mode, 두 UUID, build/parser/start time,
expected count, publication metadata와 manifest 전체가 동일할 때만 현재 monotonic state를 반환한다.
unknown member나 metadata drift는 아무 행도 남기지 않거나 기존 행을 바꾸지 않고 거부한다.
capture adapter의 request 계획, raw 기록, capture 실패 전이는 run을 잠그고 capture/backfill mode만
허용한다. 따라서 이미 존재하는 replay run에 request/raw/blob/captured count를 붙이거나 pending
publication과 어긋난 failed 상태를 만들 수 없다.

resume과 validation/projection adapter의 잠금 순서는 `run → raw/topology → publication →
publication_record`로 통일한다. replay identity 충돌 확인도 raw를 먼저 잠그지 않으므로 반대 순서의
run lock과 cycle을 만들지 않는다.

replay orchestration은 `running → validated → published` checkpoint에서 재개한다. running은 아직 final
attempt가 없는 member를 포함해 exact manifest를 deterministic normalize/insert-or-verify하고,
validated는 같은 frozen publication을 project하며, published는 topology와 persisted canonical
fingerprint를 다시 검증한다. failed 재호출은 저장된 `DATA_QUARANTINED`, `SOURCE_CONTRACT`,
`PROJECTION_CONTRACT` category를 사용해 동일한 typed failure를 반환하되, 그 전에 같은 shared
topology verifier로 상태별 exact publication manifest를 검증한다. source/data failure는 빈 manifest,
projection failure는 validated 시점의 exact frozen manifest여야 한다. 이 검증은 R2 read, attempt 추가,
projection 재실행보다 먼저 일어나며 transient R2/DB 오류는 running 또는 validated 상태를 유지한다.
running과 source/data failure의 incomplete topology는 shared partial invariant를 통과해야 한다. 아직 없는
candidate attempt는 허용하지만 존재하는 attempt는 candidate별 최대 하나, current parser의
normalized/quarantined final 상태만 허용한다. normalized attempt는 같은 observation/parser의 auction
member 정확히 하나, quarantined attempt는 member 0개여야 하며 foreign/redistributed edge는 거부한다.

publication validation은 current run/parser의 final attempt와 그 attempt-record member만 잠그고
다시 센다. 완전성 gate를 통과한 exact normalized member ID 집합을
`publication_record(publication_id, normalized_record_id)`에 동결한다. 이후 projector의 유일한
입력은 이 manifest이며 raw/run join을 다시 계산하지 않는다.
terminal 재검증도 빠르게 저장 count만 반환하지 않는다. candidate observation에서 current
run/parser attempt와 attempt-record exact sorted member set을 다시 잠그고 계산한 뒤 run/publication
status, metadata, count, frozen member와 모두 비교한다. validated terminal은 failed request가 없고,
request/candidate/run expected/output count가 정확하며, candidate마다 current-parser attempt가 정확히
하나이고 모두 `normalized`이고, 다른 parser attempt가 없어야 한다. Task 8 auction contract에서는
각 attempt가 정확히 하나의 `auction` output에 연결되고 output observation은 candidate observation과,
output parser는 current parser와 일치해야 하며 reviewed schema contract도 통과해야 한다. complete
candidate-to-member mapping을 검증한 뒤에만 동결하거나 terminal manifest와 비교한다. join table의
미래 N:M 표현력 자체는 유지한다. failed terminal은 이후 외부 수정으로 승격하지 않는다.
`SOURCE_CONTRACT`/`DATA_QUARANTINED`는 빈 manifest를,
`PROJECTION_CONTRACT`는 coherent topology의 exact frozen manifest를 계속 검증한다. source/data
failure는 completeness를 다시 요구하지 않지만 남아 있는 lineage의 partial structural coherence는
계속 요구한다.

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
- manifest-only, 일부 normalized, validated, published checkpoint 재호출은 같은 identity와 frozen
  member를 유지하며 중복 run/publication/attempt/core revision을 만들지 않는다.

## Rejected alternatives

- mutable parser columns on `raw_observation`: 새 replay가 과거 해석을 덮어쓴다.
- replay마다 raw observation 복제: 실제로 없던 HTTP 요청과 capture run을 발명한다.
- replay run 생성과 row-at-a-time input 추가를 서로 다른 repository에 분산: 부분 manifest가 실행될
  수 있고 run identity와 publication identity를 한 원자 단위로 동결할 수 없다.
- `raw_observation.run_id`로 normalized output 재계산: replay processing run과 exact output set을
  표현하지 못한다.
- projector가 publication 시점의 run join을 재실행: staging 변화로 과거 발행 입력이 달라진다.
