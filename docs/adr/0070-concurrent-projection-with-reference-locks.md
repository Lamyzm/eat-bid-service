# 0070 — 공고 투영은 발행 mutex 없이 동시에 돌고, 공유 행은 참조 잠금으로만 잠근다

- Status: Accepted
- Date: 2026-10-16
- Supersedes: runtime-and-deployment §3의 "canonical publication/projector에는 mutex를 둬 서로 다른 실행의 활성화가 엇갈리지
  않게 한다". 그 문장이 기준정보 투영에 남기는 몫은 아래 결정 4다.
- 보충: [ADR 0065](0065-latest-revision-is-latest-observation.md)(최신 개정본은 관측 번호 순)에 기대어 거래가 끝나는 순서를
  가리지 않는다. [ADR 0069](0069-collection-self-heals-stuck-locks.md)의 죽은 보유 풀기는 남은 mutex(기준정보·mart)에 그대로 쓴다.
- 관련 작업: EAT-366 (앞선 조치 EAT-362)
- 승인: 사용자 결정(2026-10-16 "걍 비동기로 처리해")

## Context

모든 공고 투영(project)과 재처리(replay)가 Argo mutex `eatbid-core-publication` 하나를 두고 줄을 섰다. 2026-10-16 08:25 재처리
회차가 2021-06 창 2만 건을 다시 발행하는 58분 동안 이 mutex를 쥐었다. 그동안 08:30 공고 수집과 09:00 개찰 결과는 반영 단계에서
기다렸고, Forbid라 08:40~09:20 회차가 만들어지지 않아 아침 개찰 결과가 화면에 들어오지 못했다. 10-14에는 백필 12시 회차가 공고
수집을 74분 비웠다. eaT 쪽 한도는 원인이 아니다. 보류(source_hold) 0건이고, 최근 30일 SOURCE_THROTTLED·네트워크 실패도 0건이다.

투영은 발행 하나를 한 거래로 반영한다. core 표를 UPDATE하는 곳은 자기 발행·실행 상태 행뿐이고, 공유 행(코드값·기관·업체·업체
계정·공고)은 넣거나(`on conflict do nothing`) 가리키기만 한다. 그런데 그 행을 `FOR NO KEY UPDATE`로 잠갔고, 이 잠금은 같은
잠금끼리 막는다. 그래서 mutex만 빼면 재처리의 20분짜리 거래가 같은 학교·업체·코드값을 쥔 채, 정시 수집이 DB에서 똑같이 줄을 선다.

mutex에 기대던 생성 경합도 둘 있었다. 기관 행에는 자연 키가 없어 "찾고 없으면 만든다"가 동시에 돌면 같은 기관을 둘 만들거나
식별자 unique에 부딪힌다. 업체 계정 짝은 unique가 있지만 `on conflict` 없이 넣었다.

## Decision

1. **공고 투영과 재처리는 발행 mutex를 잡지 않는다.** 발행은 여전히 한 거래로 통째로 반영한다. "검증된 실행 단위로 원자적으로
   발행한다"는 규칙은 그대로다.
2. **공유 행은 참조 잠금(`FOR KEY SHARE`)으로만 잠근다.** 대상은 `core.code_value`·`code_label_observation`·`organization`·
   `organization_identifier`·`supplier_party`·`source_supplier_account`·`auction_attempt`다. 이 잠금은 지우기와 키 바꾸기만 막고
   같은 잠금끼리, 또 UPDATE 잠금과도 막지 않는다. `FOR NO KEY UPDATE`는 자기 발행·실행 상태 행과 자기 개정본에 딸린 행에만
   남는다. `test_row_lock_mode.py`가 공고 투영 writer의 공유 표에 `FOR NO KEY UPDATE`가 다시 생기지 않는지 본다.
3. **새 행을 함께 만드는 경합은 데이터베이스가 푼다.** unique가 있는 행은 `on conflict do nothing` 뒤 다시 찾는다(업체 계정 짝을
   이번에 고쳤다). 자연 키가 없는 기관 행만, 새로 만들 때 그 기관 코드 하나로 advisory 거래 잠금
   (`pg_advisory_xact_lock(hashtextextended('core.organization_identifier:' || code_value_id, 0))`)을 걸고 다시 찾는다. 이미 있는
   기관을 찾는 대부분의 경로는 이 잠금을 지나지 않는다. 교착은 지금처럼 PostgreSQL이 끊고 투영이 세 번까지 다시 한다.
4. **기준정보 투영(`project-reference`·`project-code-vocabulary`)은 mutex를 유지하되 자기들끼리만 줄을 선다.** 활성 code release가
   하나라는 규칙이 그 둘 사이의 순서에 기대고, 한 달에 한 번이라 공고 투영을 막지 않는다. 공고 투영과는 `on conflict`와 참조
   잠금으로 같은 `code_value`를 함께 쓴다. mart의 `eatbid-mart-build`도 그대로다.
5. **거래가 끝나는 순서는 결과를 바꾸지 않는다.** 한 공고의 최신 개정본은 관측 번호 순이라(ADR 0065), 정시 수집과 개찰 결과가
   같은 공고를 동시에 반영해도 화면은 늦게 관측한 쪽을 본다.

## 검증

`tests/integration/test_projection_concurrency.py`가 실제 PostgreSQL에서 확인한다.

| 시험 | 새 코드 | 대조 |
|---|---|---|
| 긴 투영 거래를 열어 둔 채 같은 공유 행을 쓰는 다른 발행 | 막히지 않고 끝남 | 옛 잠금이면 `LockNotAvailable` |
| 기관 행을 고치는 잠금(`FOR UPDATE`)을 다른 거래가 쥠 | 막힘(시험이 그 행을 실제로 지나는지 가름) | — |
| 두 투영이 같은 새 기관을 함께 만듦 | 기관 하나로 모임 | advisory 잠금을 빼면 `organization_identifier_code_value_key` 중복 |
| 두 투영이 같은 새 업체 계정 짝을 함께 만듦 | 짝 하나로 모임 | `on conflict`를 빼면 `source_supplier_account_code_party_key` 중복 |

## Consequences

- 재처리·백필이 낮에 돌아도 정시 공고 수집과 개찰 결과는 그 뒤에서 기다리지 않는다. EAT-362가 옮긴 밤 전용 예약은 운영에서 동시
  발행을 확인한 뒤 되돌린다.
- 교착이 늘 수 있다. 재처리처럼 긴 거래가 교착의 희생자가 되면 그 거래를 처음부터 다시 한다. 세 번 모두 교착이면 회차가 실패하고
  재처리 전진이 다음 예약에서 다시 고른다.
- 새 기관이 처음 나타나는 순간에는 두 투영이 그 기관 하나를 두고 줄을 선다. 앞 투영이 긴 재처리면 그만큼 기다린다. 재처리가 만드는
  기관은 옛 기관이라 정시 수집과 겹치는 일은 드물다.
- 투영 writer에 공유 행을 고치는 코드가 생기면 그 행은 이 결정의 참조 잠금 대상에서 빠져야 하고, 동시 투영과의 경합을 다시 따진다.

## 되돌리기 조건

- 운영에서 투영 교착이 하루 한 번 넘게 반복되거나 동시 발행 뒤 core 사실이 어긋나면 project·replay에 mutex를 다시 걸고 원인을 본다.
