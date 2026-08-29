# 0015 — normalized interpretation에서 canonical revision으로의 직접 lineage

- Status: Accepted
- Date: 2026-08-29
- Supersedes: canonical revision을 raw content hash만으로 식별하는 설계

## Context

같은 raw 바이트는 새 parser로 다시 해석될 수 있고, 여러 replay publication이 같은 deterministic
normalized record를 재사용할 수 있다. `AuctionRevision`을 attempt와 raw hash 조합으로만 유일하게
만들면 서로 다른 parser 해석을 한 revision으로 합치며, 반대로 publication마다 revision을 만들면
같은 해석의 replay가 canonical 사실을 중복한다. 기관명과 화면용 공고번호도 source에서 바뀔 수
있는 관측값이므로 정체성이 될 수 없다.

## Decision

`AuctionAttempt`의 외부 정체성은 `(source_system, external_bid_id)`만 사용한다. 화면용 공고번호는
nullable `AuctionRevision.display_bid_no`로 보존한다. 각 `AuctionRevision`은
`ingest.normalized_record_id`를 직접 참조하며 그 값으로 유일하다. 따라서 같은 normalized record를
사용하는 replay publication은 기존 revision을 재사용하고, 같은 raw라도 새 parser가 만든 별도
normalized record는 독립 revision이 될 수 있다.

기관과 code-value 사실은 revision 시점의 사실이다. `AuctionOrganization`과
`AuctionRevisionCodeValue`는 모두 `auction_revision_id` bigint로 연결한다. projector가 자동 생성하는
code ref는 검토된 eaT 소재 시도·시군구·참가제한 체계뿐이다. MOIS/NEIS 값, mapping, 학교 유형,
이름 기반 taxonomy는 만들지 않는다.

eaT `PURR_CD`는 `eat:organization` code value와 OrganizationIdentifier로 해소한다. 새 Organization은
`type='unknown'`, `canonical_name=NULL`로 만들고 `PURR_NM`은
`CodeLabelObservation(language='und')` 증거로만 append한다. 별도 reconciliation 정책 없이는 source
label을 canonical 이름이나 유형으로 승격하지 않는다.

Projector는 잠근 `publication.status='validated'`의 frozen `publication_record`만 읽는다. manifest의
각 member가 Task 8의 current run/parser attempt와 여전히 정확히 연결되는지 확인한다. capture run의
candidate는 `raw_observation.run_id`, replay run의 candidate는 exact `replay_input`이며, candidate마다
current parser attempt 하나와 같은 observation의 normalized member 하나만 허용한다. factory 결과의
lineage/source/external ID/hash도 잠근 member와 다시 비교하고 normalized payload digest는 repository가
잠근 canonical JSON에서 계산한다. fingerprint는 정렬한 다음 tuple 목록의 compact JSON에 SHA-256을
적용한다.

이 candidate→attempt→record 검증과 잠금 query는 source-agnostic PostgreSQL topology verifier 하나가
소유하며 Task 8 validation과 Task 9 projection이 함께 사용한다. 따라서 wrong-parser/extra attempt,
swapped edge, 2-output/0-output 재분배, observation/parser/type drift의 정의가 두 gate 사이에서 갈라지지
않는다.

```text
(source_system, external_bid_id, raw_content_sha256,
 parser_version, normalized_payload_sha256)
```

publication/run 잠금, insert-or-verify canonical write, revision-scoped relation, publication/run의
`published` 전환은 한 transaction이다. 동일/concurrent 호출은 publication row에서 직렬화되고 이미
published인 전체 projection과 최초 activation/fingerprint를 검증한 뒤 0 insert를 반환한다.
Replay orchestration도 validated/published status만 신뢰해 shortcut하지 않는다. validated 재진입은
projector가 frozen member와 candidate→attempt→record topology를 다시 잠그고, published 재진입은 같은
topology뿐 아니라 canonical row와 revision-scoped relation exact set, projector version, persisted
fingerprint를 다시 계산해 검증한다. 입력 순서와 bigint 할당 순서는 fingerprint에 영향을 주지 않는다.

payload, lineage, scheme 또는 기존 canonical row/전체 relation set의 결정적 충돌은 core transaction을
rollback한 뒤 별도 fresh connection의 transaction에서 아직 validated인 run/publication을
`PROJECTION_CONTRACT` failed로 만든다. projector adapter는 ambient transaction을 허용하지 않고 idle
connection에서 repository-owned transaction을 시작하므로 failure marker가 외부 rollback에 딸려가지
않는다. 이때
기존 `validated_at`과 exact frozen member manifest를 진단용으로 보존하고 activation, fingerprint,
projector version, published count는 비운다. 연결/provider 같은 일시적 infrastructure 오류는 상태를
failed로 오분류하지 않고 validated로 남겨 Argo retry가 가능하게 한다. 이미 published인 상태는
failed로 되돌리지 않는다.

`20260829002500_core_projection_lineage`는 승인된 greenfield/reset migration 경로를 전제로 한다.
기존 canonical row를 이름이나 raw hash로 추정 backfill하지 않고 `normalized_record_id NOT NULL`을
추가하므로, 운영 데이터가 있는 레거시 DB에 무검증 적용하는 migration이 아니다.

## Consequences

- canonical revision을 raw observation, parser version, normalized payload까지 직접 추적할 수 있다.
- source label과 display number 변경이 기관/공고 정체성을 바꾸지 않는다.
- replay는 publication count를 정확히 발행하면서 같은 canonical revision을 중복하지 않는다.
- 서로 다른 replay run이 같은 raw/parser/build를 처리하면 run-scoped attempt/publication은 별도지만
  normalized record, canonical revision과 deterministic fingerprint는 재사용한다.
- 관계의 revision grain 때문에 과거 source 사실을 현재 기관/지역 관계로 덮어쓰지 않는다.
- 결정적 data contract 실패와 retryable infrastructure 실패가 운영 ledger에서 구분된다.
- greenfield reset이 아닌 이관에는 source identity 기반의 별도 검증 migration/ADR이 필요하다.

## Rejected alternatives

- `(auction_attempt_id, raw_content_sha256)` revision uniqueness: 새 parser 해석을 합친다.
- publication별 revision: 같은 normalized record replay를 중복한다.
- attempt-scoped 기관/지역 관계: revision 사이의 source 변경을 덮어쓴다.
- `PURR_NM`을 canonical name/type로 자동 승격: 이름을 identity와 reconciliation 결정으로 오용한다.
- 모든 projection 오류를 source failure로 기록: 일시적 DB 장애의 안전한 retry를 막는다.
