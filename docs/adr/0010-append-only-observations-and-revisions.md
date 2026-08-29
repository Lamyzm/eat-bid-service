# 0010 — append-only 관측/revision과 원자적 발행

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 최신 raw/DB 행 overwrite와 부분 성공 공개

## Context

source는 응답을 정정하고 parser는 발전한다. 최신 값만 덮어쓰면 “소스가 바뀐 것”과 “우리 해석이
바뀐 것”을 구분할 수 없고, 부분 수집 성공이 현재 화면을 오염시킬 수 있다.

## Decision

HTTP 관측은 매번 기록하고 바이트는 content-addressed R2에 먼저 보존한다. source entity 내용이
변하면 append-only domain revision을 만든다. 실행의 `TOT_CNT`, schema, 불변식을 모두 검증한 뒤
publication 단위로 원자 활성화한다. 실패 실행은 raw/격리를 남기고 현재 publication을 유지한다.

## Consequences

- observation과 blob은 N:1일 수 있어 중복 저장 비용을 줄이면서 호출 이력을 보존한다.
- replay가 source 재요청 없이 가능하다.
- current view를 위한 active pointer/validity query가 필요하다.
- retention은 감사/복구 요구를 고려해 별도 운영 정책으로 정한다.

## Rejected alternatives

- upsert-only current tables: source 정정과 parser 변화의 근거가 사라진다.
- parse 성공 후 raw 저장: 가장 필요한 실패 payload를 잃는다.
