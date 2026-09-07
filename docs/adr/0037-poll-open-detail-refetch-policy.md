# 0037 — poll-open 상세 재호출은 목록 신호와 마감 전이로 좁힌다

- Status: Accepted
- Date: 2026-09-07
- Supersedes: 없음. [0025](0025-source-release-manifest.md)의 봉인 조건은 그대로이며, "상세 dataset의
  `expected_count`는 목록 `TOT_CNT`와 같다"는 구현 관행만 뗀다.
- 관계: [0029](0029-eat-v2-bid-list-contract.md)가 상세에 들인 명단(`ds_bidList`)이 이 정책이 놓치면
  안 되는 값이다. [0034](0034-mart-build-identity-and-atomic-activation.md)의 열린 공고 스냅샷은 목록
  관측만으로 만들어지므로 이 정책의 영향을 받지 않는다.
- 수용 근거: 신호 필드 넷이 검토된 목록 계약의 필수 column이라는 것과 `LAST_CHG_DT`가 투찰 도착을
  반영하지 않는다는 것이 실측으로 닫혀 있고([2026-09-06 실측](../evidence/source-boundary/2026-09-06-list-open-questions.md) §3·§4.1),
  구현·단위 테스트·PostgreSQL 통합 테스트(빈 회차 봉인·발행 포함)가 같은 변경에 있으며, 놓친 변화를
  하루 안에 되돌리는 안전망(daily-reconcile 전량 재호출)이 이미 운영 중이다. 배포 뒤 실측은
  [전후 비교](../evidence/collection/2026-09-07-poll-open-refetch-policy.md)에 이어 붙인다.

## Context

`poll-open`은 평일 08:00~19:30에 30분마다 오늘 하루 창의 목록을 읽고 **발견된 공고 전부의 상세를
다시 부른다.** 2026-09-07 운영 실측은 회차당 165~175건, 상세 capture 170~291초, 회차 전체 294~534초다.
하루 24회면 약 4,000 상세 요청이고 피크(하루 열린 공고 7,000건대, 2026-08-25 `TOT_CNT` 7,231)에서는
약 170,000이라 소스 정책과 semaphore 안에서 30분 주기를 지킬 수 없다.

[수집 모드별 날짜 창](../evidence/source-boundary/2026-09-03-collection-mode-windows.md) §3은 재호출을
`LAST_CHG_DT` 비교로 좁히려 했다. 그런데 [2026-09-06 실측](../evidence/source-boundary/2026-09-06-list-open-questions.md) §3.1에서
31분 사이 `BID_CNT`가 오른 7건 모두 `LAST_CHG_DT`가 그대로였다. **소스의 변경 시각은 공고 자체의
정정만 반영하고 투찰 도착을 반영하지 않는다.** 그 기준으로 좁히면 참여가 늘어난 공고의 명단을 놓친다.

목록 응답에는 재호출 판단에 쓸 수 있는 필드가 이미 있다. 같은 실측 §4.1이 38개 column을 확인했고
그중 `BID_CNT`·`ETN_BID_STT_NM`·`BID_END_DT`·`LAST_CHG_DT`는 검토된 `bid-list` 계약의 **필수 column**이라
파서가 없으면 발견 전체를 계약 위반으로 닫는다(`source/eat/bid_list.py`). 목록 원본은 회차마다 R2에
남고 `mart.open_auction_snapshot`이 이미 그것을 다시 읽어 참여 수 추이를 만든다.

## Decision

### 1. 재호출 규칙

`poll-open`의 `discover`는 목록 전부를 관측하되, 상세 request unit은 다음 순서의 첫 규칙에 걸리는
공고에만 만든다. 규칙의 소유자는 `apps/dataplane/src/eatbid/pipeline/refetch_policy.py`다.

| 순서 | 이유 | 조건 |
|---|---|---|
| 1 | `no-baseline` | 봉인된 기준 release가 없다 → 전부 |
| 2 | `new` | 기준 목록에 없던 `ETN_BID_ID`. 재공고 차수는 새 ID이므로 여기 든다(AGENTS 4) |
| 3 | `signal-changed` | `BID_CNT`·`ETN_BID_STT_NM`·`BID_END_DT`·`LAST_CHG_DT` 중 하나라도 기준과 다르다 |
| 4 | `deadline-passed` | 기준 관측 시각 < `BID_END_DT` ≤ 이번 `--as-of`. 입찰 마감→개찰 전이는 신호가 같아도 반드시 부른다 |
| 5 | `post-deadline-window` | `BID_END_DT` 뒤 2시간 안. 개찰 뒤 명단·낙찰이 순차로 채워지는 동안 신호와 무관하게 회차마다 부른다 |
| — | `unchanged` | 위에 걸리지 않으면 마지막 관측을 유지한다 |

`daily-reconcile`과 `backfill`은 좁히지 않는다(`full-mode`). **하루 한 번의 강제 전량 재호출은
새 규칙이 아니라 daily-reconcile 자체다.** 이 정책이 놓친 변화는 늦어도 다음 07:00에 되돌아온다.

### 2. 기준은 마지막으로 봉인된 정기 수집 release의 목록 원본이다

`refetch_baseline.py`가 `ingest.source_release`에서 `poll-open`·`daily-reconcile` run이 붙은 가장
최근(`as_of`) **`sealed`** release 하나를 고르고, 그 release의 `bid-list` 관측을 R2에서 검토된 파서로
다시 읽어 `ETN_BID_ID → 신호` 표를 만든다. 기준 관측 시각은 그 목록 page들의 `fetched_at` 최댓값이다.

봉인된 release만 기준이 되는 이유: 봉인은 "계획한 상세를 전부 관측했다"는 증명이다(0025). 상세 캡처가
실패해 봉인되지 않은 회차는 기준이 되지 못하므로, 그 회차에만 보였던 변화는 다음 회차가 더 오래된
기준과 비교해 다시 잡는다. 직전 회차와 무조건 비교하면 실패한 회차의 변화가 조용히 사라진다.

기준을 mart 스냅샷에서 읽지 않는다. mart는 파생물이라(AGENTS 1) 재빌드가 수집 결과를 바꾸면 안 된다.
새 표를 만들지도 않는다 — 봉인된 release와 R2 원본이 이미 같은 사실을 담고 있다.

### 3. release 불변식

- 목록 dataset의 `expected_count`는 `TOT_CNT`이고 발견 manifest(`discovered_manifest_sha256`)는 목록
  전부다. `TOT_CNT` 대조(runtime §3)는 목록의 사실이다.
- 상세 dataset과 detail run의 `expected_count`는 **이번 회차가 계획한 request unit 수**다. 0025의 봉인
  조건 `observed = expected`, `normalized + quarantined = observed`는 그대로다. 0건이면 명시적 0으로
  exact complete다(0025가 이미 허용).
- `discover`의 창 사이 중복 제거는 여전히 하지 않는다(EAT-46 문항 4). 이 정책은 poll-open의 회차 사이
  판단이고 backfill 창 분할의 비용 모델(달력 월, runtime §2.2)에 손대지 않는다. backfill에도 같은
  기준 비교를 넣는 것은 별도 결정이며, 그때도 `TOT_CNT` 대조는 창 단위로 남는다.

### 4. 근거를 남기는 곳

- 어느 공고를 불렀는지는 detail run의 `ingest.request_unit` 존재 자체다. 부르지 않은 공고는 request
  unit이 없다.
- 왜 그렇게 골랐는지는 `discover` machine result의 `detail_count`·`refetch_reasons`(이유별 집계)·
  `baseline_source_release_id`이며 workflow output parameter `detail-count`·`refetch-reasons`로도
  나간다. 회차 실측은 pod 로그 없이 workflow status에서 한다.
- 참여 수 추이는 상세와 무관하게 목록 관측(`open_auction_snapshot`)이 만든다. 해상도는 poll 주기다.

### 5. 빈 회차

상세 0건인 회차도 목록 관측·봉인·발행·mart 스냅샷까지 간다. `capture`는 `withParam: []`로 Argo가
"Skipped, empty params"로 건너뛰고, 그 output `observation-ids`의 `valueFrom.default: "[]"`가 normalize를
같은 방식으로 건너뛰게 한다. Argo v4.0.8은 건너뛴 task의 선언된 output에 default만 채우므로
(`addSkippedNodeOutputsToScope`) 이 default가 없으면 normalize의 `withParam`이 해석되지 않아 빈 회차가
실패한다. validate·project는 0건 publication을 봉인·검증·활성화한다(통합 테스트
`test_poll_refetch_pipeline.py`).

## 요청 수 전후 비교

전은 2026-09-07 운영 실측, 후는 같은 날 실측과 2026-09-06 재관측에서 뽑은 **추정**이다. 배포 뒤
`refetch-reasons` 집계로 [전후 비교](../evidence/collection/2026-09-07-poll-open-refetch-policy.md)에서
실측으로 바꾼다.

| 항목 | 전 (전량 재호출) | 후 (이 정책) | 근거 |
|---|---|---|---|
| 회차당 상세 호출 | 165 / 168 / 175 (실측 3회, 평균 169) | 약 20~35 | 신호 변화 7~15%(일요일 31분 실측 7/102 = 6.9%, 평일은 그 위로 가정) + 신규 3~7(실측 1시간 165→175) + 마감 뒤 창 4~6(하루 마감 20~35건 × 4회 ÷ 24회) |
| 하루 상세 호출 (24회) | 약 4,060 | 약 500~850 | 위 곱 |
| 절감 | — | 79~88% | |
| 피크(열린 공고 7,000건) 하루 | 약 168,000 | 약 15,000~20,000 | 변화율 7%를 그대로 두면 회차당 약 500~700 |
| 회차당 capture pod | 4 (chunk 50) | 1 | 선택 건수가 50 이하면 chunk 하나 |
| 회차당 capture 시간 | 170~291초 (실측) | 약 60~90초 (추정) | chunk 하나, 건당 소스 응답 약 7초 |
| 회차당 추가 비용 | — | SQL 2회 + R2 목록 page 1~2개 읽기(page당 약 1.8 KB × 행) | 기준 읽기 |

포함하지 않은 것: 목록 page 호출(전후 동일, 회차당 1회), daily-reconcile(전후 동일, 하루 1회 전량).

## Consequences

- 열린 공고의 명단은 `BID_CNT`가 오른 회차, 상태가 바뀐 회차, 마감 뒤 2시간 안의 회차에 다시 관측된다.
  그 밖의 회차에는 마지막 관측(마지막 canonical revision)이 그대로 남는다.
- 30분 안에 참여가 늘었다가 같은 회차 안에서 철회되어 `BID_CNT`가 원래대로 돌아오면 그 사이 명단은
  보지 못한다. `BID_CNT`는 실측에서 감소 0건이라 희박하지만, 그 명단은 애초에 30분 해상도의 poll로는
  보장할 수 없는 것이다.
- 명단이 목록 신호 변화 없이 마감 2시간 뒤에 채워지는 경우는 아직 관측한 적이 없다. 그런 경우가 있으면
  daily-reconcile이 24시간 안에 잡고, 실측되면 `POST_DEADLINE_REFETCH_WINDOW`를 늘리는 것이 이 ADR의
  재검토 트리거다.
- 회차당 R2 읽기가 1~2개 늘고 기준 표는 메모리에 잠깐 산다(피크 7,000행 × 신호 넷). 이 비용은 절감되는
  상세 호출 수백 건과 비교가 되지 않는다.
- 상세 dataset `expected_count`가 `TOT_CNT`와 다를 수 있으므로, 둘이 같다고 가정한 대시보드·질의는
  이 ADR 뒤로는 틀린다. 저장소 안에는 그런 가정이 없다(`validate_run`은 request unit 계획 수와 대조).
- 이 정책이 없던 시절의 봉인 release도 목록 원본을 갖고 있어 배포 직후 첫 회차부터 기준이 있다.

## Rejected alternatives

- **`LAST_CHG_DT`만 비교한다.** 투찰 도착을 반영하지 않는다는 것이 실측으로 닫혔다. 참여가 늘어난
  공고의 명단을 놓친다.
- **마감 임박(예: 2시간 전)만 상세를 부른다.** 입찰기간 중앙값 6일 동안의 참여 증가와 정정을 전부
  놓치고, 마감 뒤 명단 도착은 여전히 따로 다뤄야 한다. 마감 규칙은 신호 비교의 보완이지 대체가 아니다.
- **poll-open 안에 하루 N회 강제 전량 재호출을 둔다.** daily-reconcile이 이미 그 역할이다. 같은 안전망을
  두 번 두면 비용만 늘고, 그 N을 정할 실측이 없다.
- **직전 회차 목록과 비교한다(봉인 여부 무관).** 상세 캡처가 실패한 회차의 변화가 다음 회차 비교에서
  "변화 없음"으로 사라진다.
- **공고마다 "마지막 상세 관측 시점의 신호"를 새 표에 둔다.** Drizzle DDL·마이그레이션·쓰기 경로가
  늘어나는데, 봉인된 release + R2 원본이 같은 보장을 이미 준다.
- **mart 스냅샷을 기준으로 쓴다.** 파생물이 수집 판단의 입력이 되면 mart 재빌드가 수집 결과를 바꾼다.
- **전량 재호출을 유지한다.** 피크에서 하루 170,000 상세 호출이라 30분 주기가 성립하지 않는다.
- **빈 회차에 canary 상세 1건을 억지로 넣어 Argo 빈 fan-out을 피한다.** 관측 이유가 없는 요청을 만들고
  request unit 근거를 거짓으로 만든다. `valueFrom.default`가 정확히 이 상황을 위한 장치다.
