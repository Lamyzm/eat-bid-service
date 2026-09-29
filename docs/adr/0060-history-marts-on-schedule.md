# 0060 — 과거 기록 mart는 발행마다가 아니라 예약으로 만든다

- Status: Accepted
- Date: 2026-09-29
- Supersedes: [ADR 0034](0034-mart-build-identity-and-atomic-activation.md) "빌드는 Argo `marts` 단계에서만 실행하며"
  문장. 빌드는 이제 발행 DAG의 `marts` 단계(열린 공고 스냅샷)와 예약 entrypoint `history-marts`(과거 기록 mart) 두
  곳에서 실행하고, 둘 다 같은 mutex `eatbid-mart-build`를 잡는다. 0034의 나머지(build 원장·원자적 활성화·전량
  빌드·보존)는 그대로다.
- 관련 작업: EAT-300
- 승인: 총괄 Tech Lead 결정(사용자 위임, 2026-09-29)

## Context

발행 DAG의 마지막 `marts` 단계는 발행마다 세 mart를 전부 다시 만들었다. 2026-09-29 오전 운영 poll-open 세 회차의
시간이다(전체 / capture / marts).

| 회차 | 전체 | capture | marts |
|---|---|---|---|
| 1 | 36.0분 | 16.4분 | 16.2분 |
| 2 | 36.1분 | 13.8분 | 18.1분 |
| 3 | 46.3분 | 12.9분 | 29.3분 |

- poll-open은 10분 주기이고 `concurrencyPolicy: Forbid`다. 한 회차가 36~46분이면 그 사이 tick은 경보 없이
  만들어지지 않는다. 하루 72회 계획 중 실제 실행은 5~24회였다. 신규 공고 노출 SLO 15분(runtime §2.5)이 조용히
  깨진다.
- `org_round_summary`는 build마다 865,470행을 새로 쓴다. 연속한 두 build 사이에 실제로 바뀐 행은 약 160행이다.
  `win_rate_distribution_monthly`는 약 141만 행이다. poll-open 발행 하나가 바꾸는 것은 열린 공고 몇 건인데,
  그 값을 치르려고 과거 5년치 요약을 매번 통째로 다시 쓴다.
- `mart.build`의 `started_at`·`computed_at`·`activated_at`은 workflow가 한 번 찍은 같은 값이다. 그래서 세 mart 중
  무엇이 16~29분을 쓰는지 원장만으로는 알 수 없었다.

화면이 두 종류의 mart를 읽는 방식도 다르다. `/today`와 새 공고 가시성은 열린 공고 스냅샷이 결정하며 분 단위
신선도가 필요하다. 회차 요약과 낙찰률 분포는 분석·기관 이력 화면이 읽는 과거 기록이다. 새로 들어오는 사실은 그날의
개찰 결과이고, 그것이 화면에 몇 시간 늦게 들어와도 판단 재료의 성격은 바뀌지 않는다(ADR 0011: 파생물의
stale은 정상 상태다).

## Decision

1. **발행 DAG의 `marts` 단계는 열린 공고 스냅샷만 만든다.** poll-open·daily-reconcile 발행 뒤에만 붙고, 어느 mart를
   만들지는 CLI `build-marts`가 run mode로 고른다(`OPEN_AUCTION_RUN_MODES`). 발행이 실은 record type으로 과거 기록
   mart의 영향 범위를 고르던 표(`IMPACT_SCOPE`)는 없앤다 — 과거 기록 mart는 더 이상 발행 하나를 따라 만들지 않는다.
   사람이 과거 창 발행을 주고 `build-marts`를 직접 부르면 스냅샷 없이 과거 기록 mart를 만든다(한 발행을 예약을
   기다리지 않고 반영하려는 것이 사람이 부르는 이유다).

2. **과거 기록 mart(`org_round_summary`+품목 다리표, `win_rate_distribution_monthly`)는 CronWorkflow
   `eatbid-history-marts`가 만든다.** 같은 WorkflowTemplate의 새 entrypoint `history-marts`가 CLI
   `build-history-marts`를 부른다(AGENTS 9). 입력은 원장이 정한다.
   - 빌드 입력(`source_release_id`, `publication_id`)은 **가장 늦게 발행된 publication**(`activated_at` 최댓값, 같으면
     id)이다. 과거 기록 mart는 어차피 core 전량을 읽으므로 이 값은 계산 범위가 아니라 "어느 발행까지 반영했는가"의
     계보다. replay 발행은 `source_release_run`에 매이지 않으므로 관측 매니페스트(`replay_input`)의 원 release를 쓴다.
   - mart마다 활성 build가 같은 발행을 같은 `calc_version`으로 이미 반영했으면 그 mart는 만들지 않는다. 두 mart 다
     그렇다면 아무것도 하지 않고 성공한다. 새 `calc_version`을 배포하면 첫 회차가 같은 발행이라도 새 규칙으로 다시
     만든다.
   - mutex는 발행 DAG의 `marts`와 같은 `eatbid-mart-build`다. 다른 mutex면 두 build가 같은 core를 동시에 전량 읽어
     단일 노드 DB를 두 배로 누르고, 같은 mart를 동시에 활성화하려 들면 한쪽이 partial unique index에 끊긴다.
   - `priority`는 40으로 수집(100)보다 낮다. 같은 mutex를 기다릴 때 사용자가 보는 스냅샷이 먼저다.
   - 주기는 **매일 KST 07:40·12:40·16:40·20:40**(`40 7,12,16,20 * * *`)이다. 근거는 결정 4다.

3. **"최신 관측 반영 안 됨"(`mart.build_stale_auction`)은 열린 공고 스냅샷의 활성 build에서 읽는다.** EAT-295는 이
   부속 행을 회차 요약의 활성 build에서 읽었다. 부속 행은 어느 mart build에나 같은 규칙(원장 전체)으로 실리지만,
   회차 요약이 하루 네 번만 다시 만들어지면 표시가 최대 11시간(20:40 → 07:40) 늦는다. 그 표시가 필요한 순간은 사용자가
   열린 공고 상세를 볼 때이고, 제외는 대부분 정시 수집의 상세 재호출에서 생긴다. 스냅샷은 poll-open 발행마다 새
   build가 되므로 표시가 한 회차 안에 따라온다. 서버의 조각(`auction-latest-observation-query.ts`)이 읽는 mart 이름만
   바꾸며 표의 모양과 판정 규칙은 그대로다. 달별 제외 수(`build_exclusion_month`)는 그대로 회차 요약의 활성 build에서
   읽는다 — 그 수는 같은 build의 분석 표본에 붙는 주석이라 같은 build에서 나와야 두 수가 어긋나지 않는다.

4. **주기의 근거.**
   - 개찰 결과가 그날 안에 분석 화면에 들어와야 한다. 오전 개찰(대개 10~12시)은 12:40, 이른 오후 개찰은 16:40, 그날
     나머지는 20:40이 반영한다. 07:40은 밤사이 전진 백필·재처리와 07:00 재대조의 앞부분을 업무 시작 전에 반영한다.
   - 기존 예약과 같은 분에 시작하지 않는다. 정각은 전진 백필(매시)·재대조(07:00)·기준정보, 5분은 백업(pg_dump, 매시),
     25분은 재처리(4시간마다), 3·18·33·48분은 감시, 04:30은 mart 회수다. 과거 기록 build는 core 전량을 읽으므로
     백업·회수와 같은 분에 시작하면 단일 노드 DB를 함께 누른다.
   - 07:40과 20:40은 poll-open(08:00~19:50)과 mutex를 다투지 않는다. 12:40·16:40은 그 시각 전후 poll-open 회차의
     스냅샷 단계가 이 build를 한 번 기다릴 수 있다. 하루 두 번의 지연을 받아들이고 매 회차의 16~29분을 없앴다.
   - 새 발행이 없으면 회차는 아무것도 하지 않는다. 전진 백필이 매시 발행하는 동안은 네 회차가 모두 실제로 만든다.

5. **backfill·replay·daily-reconcile DAG.** backfill 계열(`backfill-pipeline`·`windowed-backfill-pipeline`)과 replay
   계열(`replay-pipeline`·`advancing-replay-pipeline`)은 `marts` task를 잇지 않는다. backfill은 원래 스냅샷을 만들지
   않았고(EAT-98) 과거 기록 mart는 예약이 반영한다. 예외를 두지 않는다 — replay는 몇 시간씩 도는 재처리라 그 뒤 몇
   시간 안의 예약이 따라잡는 것이 충분하고, 급하면 사람이 `build-marts --publication-id`를 부른다.
   `reconcile-pipeline`은 열린 공고를 읽으므로 `marts`(스냅샷)를 그대로 잇는다.

6. **mart별 계산 시간을 원장에 남긴다.** `mart.build`에 `fill_started_at`·`fill_finished_at`을 더한다. 행을 채우는
   트랜잭션의 시작과 끝에서 DB가 `clock_timestamp()`로 찍는다 — `now()`는 트랜잭션 시작에 멈춰 두 값이 같아진다.
   채우기가 끊기면 시각도 행과 함께 되감기므로 `fill_finished_at`이 null인 building build가 "채우다 끊겼다"의 흔적이다.
   이 열이 생기기 전의 build는 null이다. 두 열은 계산 규칙이 아니라 실행 기록이라 `calc_version`을 올리지 않는다.

## Consequences

- poll-open 한 회차에서 과거 기록 mart 두 build(16~29분 중 대부분으로 추정)가 빠진다. 스냅샷 build 하나의 시간은 이
  변경 뒤 `fill_finished_at - fill_started_at`으로 처음 잴 수 있다. 회차 실행이 10분 아래로 돌아오는지는 배포 뒤
  `ingest.run`과 workflow duration으로 확인한다. 돌아오지 않으면 다음 원인은 capture(13~16분)다.
- 분석·기관 이력 화면의 신선도가 "발행 뒤 몇 분"에서 "하루 네 번"으로 바뀐다. 서버는 활성 build의 계보
  (`computedAt`)를 이미 응답에 싣지만 분석 화면은 그 시각을 표시하지 않는다. "몇 시 기준"을 보여 주는 것은 후속이다.
- 배포 직후 첫 예약 회차까지 과거 기록 mart는 배포 전 마지막 build에 머문다. 공백이 아니라 옛 build다.
- 열 추가 마이그레이션은 `mart.build`에 `ACCESS EXCLUSIVE` 잠금을 잡는다. 채우기 트랜잭션은 FK 검사로 그 표를
  잡고 있으므로 mart build가 도는 동안에는 migrator의 `lock_timeout`(5초)에 걸려 실패한다. 배포는 mart build가 없는
  시각(20:40 회차가 끝난 저녁, 또는 poll-open이 없는 주말의 예약 회차 사이)에 한다.
- 재처리 publication의 `activated_at`은 decide 시각에서 파생해 실제 커밋보다 이를 수 있다. 재처리가 발행 mutex를
  기다리는 동안 다른 발행이 끼어 그 사이에 예약 회차가 돌면, 재처리 발행은 "최신"이 아니어서 다음 새 발행이 생길
  때까지 반영이 밀린다. 평일에는 정시 수집, 주말에도 전진 백필이 매시 발행하므로 밀림은 한두 회차다.
- ADR 0034의 "`org_round_summary` 전량 빌드가 60초를 넘으면 개찰 연도 partition" 조건은 이미 넘었을 가능성이 높다.
  이번 결정은 그 처방을 고르지 않는다. `fill_*` 시각으로 mart별 실측이 쌓인 뒤 따로 판단한다.

## Rejected alternatives

- **과거 기록 mart를 발행마다 증분으로 고친다.** build 사이 실제 변화가 약 160행이라 가장 싸 보이지만, 행 단위 증분은
  ADR 0034가 전량 빌드로 얻은 결정성·단순한 검증을 버린다. 같은 build 원장 위에서 증분과 전량이 섞이면 "이 build가
  무엇을 셌는가"에 한 번에 답할 수 없다.
- **과거 기록 mart에 별도 mutex를 준다.** poll-open의 스냅샷이 과거 기록 build를 기다리지 않게 되지만, 두 전량 읽기가
  단일 노드 DB에서 겹치고 둘 다 느려진다. mutex 대기는 하루 두 번뿐이라 이득이 작다.
- **매시 만든다.** 개찰 결과가 한 시간 안에 들어오지만 업무 시간 내내 매 시간 16~29분씩 mutex를 쥐어 poll-open의
  스냅샷이 거의 매 회차 기다린다. 이번 변경이 없애려는 지연을 다른 이름으로 되살린다.
- **daily-reconcile 뒤에만 하루 한 번 만든다.** 그날 개찰 결과가 다음 날 아침에야 보인다. 결과를 확인하고 다음 입찰을
  준비하는 날의 흐름에 맞지 않는다.
