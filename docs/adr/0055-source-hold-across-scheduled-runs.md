# 0055 — 소스가 우리를 막으면 그 결정은 다음 정시 실행까지 살아 있어야 한다

- Status: Accepted
- Date: 2026-09-16
- Supersedes: 없음. [ADR 0052](0052-backfill-progress-recovery-and-advance.md) 결정 2(진도는 저장하지 않고 파생한다)를 대체하지 않고 경계 하나를 더한다 — **진도는 파생, 결정은 저장**. [ADR 0053](0053-negative-observed-bid-rates-and-failed-window-advance.md) 결정 3(발행 실패 창은 전진이 건너뛴다)은 그대로다.
- 관련 작업: EAT-244(R3), 설계 `docs/superpowers/plans/2026-09-16-ops-signal-design.md` D4

## Context

2026-09-16 3월 창은 06:20부터 매시 같은 16,469건을 다시 받아 같은 자리에서 죽었다. 재요청을 멈춘 것은
`backfill_coverage.failed_publications`에서 파생한 규칙 하나였고(ADR 0053), 그것은 **발행 실패**라는 한 가지
원인에만 듣는다.

소스가 우리를 막는 경우는 다르다. `capture`는 403·429를 `SOURCE_THROTTLED`로 분류해 그 자리에서 run을 실패로
닫는다(exit 75). 프로세스 안의 재시도 정책(`source/retry.py`)은 5xx와 전송 실패만 다시 시도하고 상한이
120초다. 그런데 CronWorkflow는 다음 정시에 **완전히 새 Workflow**를 띄운다. `retryStrategy`도 재시도 정책도
그 경계를 넘지 못한다. 소스가 한 시간 동안 우리를 막으면 poll-open은 10분마다, 전진은 매시 다시 두드린다.
그것은 차단을 풀어 주는 행동이 아니라 굳히는 행동이다.

파생으로는 이 결정을 만들 수 없다. "언제까지 부르지 않는다"는 사실에서 계산되는 진도가 아니라 우리가 내린
결정이고, 다음 실행이 그 결정을 읽어야 한다.

## Decision

1. **진도는 파생, 결정은 저장.** `ingest.backfill_coverage`는 그대로 뷰다. "어디까지 됐나"는 사실에서 다시
   계산한다. 그러나 "무엇을 언제까지 하지 않기로 했나"는 표 `ingest.source_hold`에 적는다. 이 표에는 진도가
   없고 사실도 없다. 결정과 그 근거만 있다.

   ```
   ingest.source_hold
     hold_id        bigint identity
     source         varchar(32)      -- 'eat'
     reason         varchar(32)      -- source-throttled
     detail         text             -- 어느 run이 어떤 응답을 봤나
     held_at        timestamptz
     held_by_run_id uuid null
     release_after  timestamptz      -- 이 시각이 지나면 보류가 풀린다
     released_at    timestamptz null -- 사람이 일찍 풀었을 때만. 지금은 쓰는 자리가 없다
   ```

   보류는 소스 전체 단위다. 창 단위 보류는 만들지 않는다 — 차단은 창이 아니라 우리 IP에 걸린다.

2. **보류는 `SOURCE_THROTTLED`를 본 capture가 적는다.** 그 capture는 이미 DB에 관측을 기록하는 자리다. 새 보류의
   `release_after`는 지수로 는다. 지난 24시간 안에 풀린 보류가 없으면 15분, 하나 있으면 30분, 둘이면 60분,
   상한 24시간. 소스가 계속 막으면 우리는 점점 뜸하게 두드리고, 하루 뒤에는 하루에 한 번 확인한다.

3. **정시 실행은 보류를 먼저 읽는다.** 열린 보류(`release_after > now()`)가 있으면
   - 전진(`advancing-backfill-pipeline`)의 `decide`는 `has-window=false`를 내고 `run`은 건너뛴다. Workflow는
     아무 일 없이 성공한다 — 백필은 하루 늦어도 되는 일이다.
   - 실시간 수집(`scheduled-pipeline`)의 `discover`는 소스를 부르기 전에 `SOURCE_THROTTLED`(exit 75)로 끝난다.
     run도 release도 만들지 않는다. Workflow는 실패로 남고 `cron-workflow:eatbid-poll-open` 위반이 열린다.
     실시간 수집이 멈춘 것은 사람이 알아야 하는 일이고(critical, ADR 0054), 그 실패는 소스 호출 0회다.
   - 사람이 부르는 `backfill-pipeline`·`replay-pipeline`은 보류를 보지 않는다. replay는 소스를 부르지 않고,
     사람이 부르는 백필은 그 사람이 보류를 알고 부른 것이다.

4. **보류는 기대가 든다.** `check-expectations`의 `source-hold` 기대가 열린 보류를 위반으로 열어 둔다. critical이다.
   보류가 풀리면 해소된다. 보류가 하루 상한에 닿아 있으면 그것은 소스가 우리를 하루 이상 막고 있다는 뜻이고,
   그 사실이 매시 재알림으로 온다.

## Consequences

- 소스가 우리를 막을 때 우리가 보내는 요청 수: 매시 창 하나 + 10분마다 목록 → 15분 뒤 한 번, 30분 뒤 한 번, …,
  하루에 한 번. 차단이 굳지 않는다.
- 전진과 poll-open의 동작이 갈린다. 전진은 조용히 기다리고 poll-open은 소리 내며 멈춘다. 둘 다 소스는 부르지
  않는다. 이 비대칭은 의도다 — 오늘의 공고가 화면에 없는 것과 2021년 공고가 하루 늦는 것은 같은 무게가 아니다.
- `ingest`에 결정을 적는 표가 처음 생긴다. 사람이 쓰는 자리(`released_at`)는 열어 두되 지금은 쓰지 않는다.
  수동 운영 쓰기 금지 원칙과 부딪히므로, 필요해지면 Workflow 진입점으로 시스템이 쓰게 만든다.
- 로컬 Argo smoke에 음성 사례가 하나 는다: 열린 보류가 있을 때 `decide`가 `has-window=false`를 내는가.

## 대안과 기각 이유

- **Argo `retryStrategy`** — 한 Workflow 안에서만 센다. 다음 정시 실행이 새 Workflow인 한 무력하다.
- **차단 상태를 `backfill_coverage`에 파생** — 차단은 창이 아니라 소스에 걸리고, "언제까지"는 사실에서 계산되지
  않는다. 진도 뷰에 결정을 섞으면 ADR 0052 결정 2가 지키려던 것이 무너진다.
- **CronWorkflow를 suspend** — 사람이 손으로 하는 일이고, 다시 켜는 것을 잊으면 조용히 멈춘다(2026-09-10 실측).
  시스템이 스스로 멈추고 스스로 풀어야 한다.
- **창 단위 보류** — 차단은 IP 단위다. 창을 바꿔 부르면 더 빨리 굳는다.
