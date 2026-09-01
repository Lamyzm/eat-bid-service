# 0025 — source release manifest로 수집 입력 집합을 봉인한다

- Status: Accepted
- Date: 2026-09-01
- Supersedes: 없음

## Context

수집 실행(`run_id`)은 한 번의 처리 시도를 나타내지만, 재처리·부분 실패·여러 실행의
결과를 조합한 시점 기준 입력 집합을 대신 표현하지는 못한다. 분석과 canonical projection은
어떤 raw observation 집합과 parser/schema 정의를 기준으로 했는지 다시 판별할 수 있어야 한다.

## Decision

`ingest.source_release`를 source별 release identity로 두고, `source_release_run`과
`source_release_observation`으로 실행과 raw observation membership을 서로 독립적으로
기록한다. membership은 각각 복합 primary key로 중복을 막는다.

`source_release_dataset`은 release별 endpoint, dataset, record type, parser version, schema
fingerprint와 expected/observed/normalized/quarantined count 및 required 여부를 보존한다.
여기서 count는 모두 같은 dataset의 source record grain이다. `expected_count`는 source가
완결로 선언한 record 수, `observed_count`는 release membership에서 실제 관측한 record 수,
`normalized_count`와 `quarantined_count`는 그 observed record의 서로 배타적인 최종 parser
결과 수다. 따라서 `normalized + quarantined <= observed <= expected`를 DB check로 강제한다.
모든 count는 음수를 허용하지 않고 fingerprint는 SHA-256 형식이어야 한다.

release 상태는 `planned`, `sealed`, `failed`만 허용한다. `sealed`는 manifest SHA-256과
`sealed_at`을 반드시 가지며 failure category를 가질 수 없다. `failed`만 failure category를
가질 수 있고 봉인 metadata를 가질 수 없다. 봉인된 release와 그 membership은 수정하지 않으며,
원본 정정이나 추가가 필요하면 새 release를 만든다. DB trigger는 sealed release 자체와
run/observation/dataset membership의 INSERT·UPDATE·DELETE를 거부한다. `required = true`인
dataset은 seal 시점에 `observed = expected` 및 `normalized + quarantined = observed`여야 한다.
`required = false` dataset은 관측 범위를 보존하지만 seal completeness gate의 필수 입력은 아니다.

같은 source에서 같은 non-null manifest SHA-256은 partial unique index로 한 release만 가질 수
있다. release 이름은 source 안에서 사람이 읽는 구분자일 뿐 manifest identity를 대신하지 않는다.

## Consequences

- `run_id`는 실행의 정체성을, `source_release_id`는 봉인된 raw member 집합의 정체성을
  각각 계속 소유하며 서로 대체하지 않는다.
- downstream 결과는 release ID와 dataset manifest를 저장해 재현 가능한 입력 기준을 남길 수 있다.
- source release가 sealed된 뒤의 변경은 허용되지 않으므로, 운영자는 누락·정정을 새 release로
  명시해야 한다.

## Rejected alternatives

- 실행 하나를 곧바로 release로 취급한다. 재처리와 여러 실행의 조합을 표현하지 못한다.
- dataset 수량과 parser/schema metadata를 observation 행에만 둔다. release 단위 completeness와
  재현 기준을 확인하기 어렵다.
- 봉인된 release를 in-place 수정한다. 과거 분석이 어떤 입력을 사용했는지 보장할 수 없다.
