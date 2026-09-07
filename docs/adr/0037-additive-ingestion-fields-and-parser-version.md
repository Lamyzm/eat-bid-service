# 0037 — 봉인된 수집 계약의 가산 확장과 parser version의 경계

- Status: Accepted
- Date: 2026-09-07
- Refines: [0014](0014-normalization-attempt-lineage.md) (run-scoped normalization attempt),
  [0025](0025-source-release-manifest.md) (봉인된 raw membership), [0029](0029-eat-v2-bid-list-contract.md)
  (`eat-v2`는 덮지 않고 더한다)
- Relates: [0035](0035-administrative-region-canonical-and-mapping.md) 결정 6 (증거 기반 eaT 매핑),
  [`reference-data-coverage.md`](../operations/reference-data-coverage.md) §4

## Context

행안부 코드 537행과 eaT↔행안부 매핑 생성기는 준비됐지만 운영 `core.code_mapping`은 0행이다.
매핑의 유일한 입력인 eaT 참가제한지역 라벨(`ds_areaList.PDLC_NM`, 예 `서울/노원구`·`전남/전체`)이
정규화 수집 계약 `eatbid.ingestion.auction.v2`의 `location`에 실릴 자리가 없어
`core.code_label_observation`까지 흐르지 못하기 때문이다(EAT-57 lane A 실측, 2026-09-06).

계약을 넓히는 방법은 세 가지였고 각각 다른 불변식과 부딪힌다.

1. **v2 root에 optional 필드를 더한다.** projector는 봉인된 canonical payload를 되읽어 재직렬화가
   바이트 그대로인지 검사한다. 지금까지 재직렬화는 모델의 **모든** 키를 냈으므로 optional 필드라도
   새 키가 `null`로 튀어나와 라벨 이전에 봉인된 v2 payload가 전부 "canonical이 아님"이 된다. 이것이
   [time-and-value-contracts §2](../architecture/time-and-value-contracts.md)가 "v1 root에는 optional도
   더하지 않는다"고 적은 이유였다.
2. **`auction.v3` 새 root.** 생성 모델·발행 가능 record type·빌더·topology 검사가 같은 모양에 두
   이름을 갖게 되고, 이미 봉인된 v2 발행물과 새 발행물이 같은 사실을 다른 이름으로 부른다.
3. **projector가 manifest 밖의 raw를 다시 읽어 라벨만 뽑는다.** projector는 manifest만 소비한다는
   경계([0010](0010-append-only-observations-and-revisions.md)·[0015](0015-canonical-projection-lineage.md))를
   깬다.

그리고 어느 방법을 고르든 한 가지가 더 남는다. 파서가 같은 이름으로 다른 바이트를 내면 안 된다.
`ingest.normalized_record`는 `(observation_id, record_type, source_entity_id, parser_version)`마다
payload 하나를 봉인하고, `PsycopgNormalizationRepository._insert_or_verify_record`는 같은 키에 다른
payload가 오면 `NormalizationNondeterminismError`로 거부한다(ADR 0014). 라벨이 붙은 payload는 다른
바이트다. 그것을 `eat-v2`라고 부르면 이미 정규화된 관측의 재시도와 replay가 전부 이 guard에 막힌다.

## Decision

1. **봉인된 계약 version에 optional 필드를 가산할 수 있다.** 조건은 하나다 — canonical 재직렬화는
   producer가 쓴 키만 낸다(Pydantic `exclude_unset`). 규칙의 단일 권위는
   `apps/dataplane/src/eatbid/source/eat/normalize.py`의 `canonical_record_object`이며 정규화·투영·검증이
   모두 그것을 부른다. 필수 필드는 언제나 set이므로 v1과 라벨 이전 v2 payload의 바이트는 이 규칙 아래서도
   그대로다. 필수 필드를 더하거나 의미를 바꾸는 변경은 여전히 새 root다.
2. **`auction.v2`의 `location.eligibilityAreas`가 첫 가산 필드다.** `SourceCodedValue[]`이며
   `eligibilityCodes`와 같은 순서로 `(eat, eat:eligibility-area, PDLC_CD, PDLC_NM 원문)`을 싣는다.
   키 없음은 "이 parser version은 라벨을 관측하지 않았다", 빈 배열은 "참가제한지역이 없는 공고"다.
   두 사실을 `null` 하나로 접지 않는다. 라벨은 원문 그대로이며(`서울 / 전체`의 공백도 남긴다) 대조용
   정규화는 매핑 생성기의 규칙이다(ADR 0035 §라벨 정규화의 범위). projector는 두 목록의 코드·순서·
   체계가 어긋나면 `ProjectionContractError`로 끊고, 라벨을 `core.code_label_observation`에 이 관측을
   근거로 남긴다.
3. **라벨을 싣는 파서는 새 parser version `eat-v3`다.** 검토 schema는 `eat-v2`와 같고(`ds_areaList`에
   선택 column `PDLC_NM`만 더 안다) `required`가 같아 fingerprint도 같으며, record type은 그대로
   `auction.v2`다. `eat-v2`의 출력은 바이트 그대로이고 그 사실을 `_SEALED_V2_PAYLOAD_DIGESTS`가 고정한다.
   parser version은 곧 결정성의 키이므로 "출력이 달라지면 이름이 달라진다"가 규칙이다(ADR 0029와 같은
   원칙).
4. **이미 발행된 revision의 라벨은 replay 한 번으로 채운다.** `replay --parser-version eat-v3`가 같은
   관측에서 새 정규화 행·새 revision을 만들고, 원래 eat-v2 발행물은 바이트도 검증도 그대로다. 매핑은
   revision이 아니라 코드에 매달리므로 replay 없이도 새 수집이 관측한 코드부터 라벨이 쌓인다.
5. **WorkflowTemplate의 `parser-version` 기본값 전환은 이 결정에 포함하지 않는다.** 템플릿이 이미지보다
   먼저 동기화되면 옛 이미지가 모르는 version 이름을 받는다(EAT-95). 기본값은 이미지 릴리즈·배포 뒤의
   별도 커밋으로 올리며 절차는 [`collection-runbook.md`](../operations/collection-runbook.md) §2다.

## Consequences

- `time-and-value-contracts.md` §2의 "optional도 더하지 않는다"는 문장은 이 결정으로 바뀐다. 가산
  optional은 같은 root에, 필수·의미 변경은 새 root에.
- `core.code_mapping`이 운영에서 채워지는 전제가 생겼다. 매핑률은 여전히
  [`reference-data-coverage.md`](../operations/reference-data-coverage.md)가 운영 실측으로 센다.
- 검토된 eaT parser version은 셋이다. 발행 경로가 열린 version이 둘(eat-v2·eat-v3)이므로 infra 계약
  테스트는 "기본값이 명단을 아는 version이어야 한다"를 집합 동일이 아니라 포함으로 검사한다.
- `exclude_unset`은 producer가 명시적으로 `null`을 쓴 키와 쓰지 않은 키를 구분한다. 생성 모델의
  optional 필드에 `None`을 직접 넣는 코드는 canonical 바이트에 그 키를 남기므로, 파서는 관측하지 않은
  필드를 아예 쓰지 않는다.

## Rejected alternatives

- **`eat-v2`가 라벨을 내되 이름을 유지.** 같은 키에 다른 payload가 되어 `NormalizationNondeterminismError`가
  재시도·replay를 막는다. guard를 완화하면 ADR 0014의 결정성 주장이 사라진다.
- **`auction.v3` root.** 위 Context 2. 라벨은 새 사실의 집합이 아니라 이미 있는 코드 관측의 증거다.
- **projector의 raw 재독.** 위 Context 3.
- **재직렬화를 모든 키로 유지하고 봉인된 v2 발행물을 전부 replay.** 수십만 revision을 다시 만들면서
  얻는 것이 없고, replay 전까지 `verify`가 전부 실패한다.
