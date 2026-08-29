# 0006 — 내부 ID와 source-scoped code scheme

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 이름·주소·복합 문자열 기반 identity와 지역 비교

## Context

기관명과 행정구역 라벨은 바뀌고 중복되며, eaT 공고지역/참가제한지역과 정부 행정구역/학교
코드는 의미와 소유자가 다르다. 문자열을 이어 붙인 키는 변화와 충돌을 숨긴다.

## Decision

외부 코드는 `(source_system, code_scheme, code text)`로 보존하고 내부 엔터티 관계는 bigint
PK/FK로 연결한다. CodeScheme/Value/LabelObservation/Mapping을 명시적으로 모델링한다.
서로 다른 scheme은 근거·유효기간이 있는 mapping 없이는 비교하지 않는다. 공식 코드가 없는
품목은 버전된 내부 Taxonomy/ClassificationRule을 사용한다.

## Consequences

- 선행 0이 있는 원본 코드는 text로 안전하게 보존된다.
- 이름/주소/라벨은 표시와 관측 속성으로 남지만 정체성/조인을 결정하지 않는다.
- 기존 문자열 URL과 key는 새 내부 ID 계약으로 바뀐다.
- 행정구역 개편과 source code 변화는 mapping/revision으로 추적된다.

## Rejected alternatives

- 모든 정부 코드를 하나의 region table에 합침: 의미가 다른 코드를 거짓 동등성으로 만든다.
- 문자열을 전부 금지: 원본 코드와 이름/주소 보존까지 훼손하는 잘못된 목표다.
