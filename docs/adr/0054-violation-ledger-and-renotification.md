# 0054 — 위반은 PostgreSQL 표에 이력으로 남고, 미해결은 다시 울린다

- Status: Accepted
- Date: 2026-09-16
- Supersedes: [ADR 0046](0046-telemetry-wire-correlation-and-alert-origin.md) 결정 6 가운데 두 곳. (a) "해소될 때까지 같은 위반을 반복해 보내지 않는다"를 폐기하고 심각도별 재알림과 하루 요약으로 대체한다. (b) 감시 상태를 R2 JSON 하나에 두던 구현 선택(`monitoring/store.py`)을 `monitoring` 스키마의 표로 대체한다. 결정 6의 나머지 — 출처 둘·도착지 하나, 생존 확인은 밖에서 미는 쪽, 한 회차의 위반은 한 통으로 — 는 그대로다.
- 관련 작업: EAT-242(R1), EAT-243(R2), 설계 `docs/superpowers/plans/2026-09-16-ops-signal-design.md`

## Context

2026-09-16 하루의 실측이 결정을 정한다.

- `main`은 9월 11일부터 16일까지 빨간 채였고 그 위에서 v0.1.33~36이 나갔다. `ci-main-green` 기대는 첫 회차에
  울렸고 그 뒤 침묵했다. ADR 0046 결정 6의 "해소될 때까지 반복하지 않는다"가 그렇게 시켰다. 5일 동안 아무도
  다시 듣지 못했다.
- 3월 백필 창은 06:20 KST부터 매시 같은 자리에서 죽었고 `cron-workflow` 기대가 첫 회차에 울린 뒤 같은 이유로
  침묵했다. 사람이 알아챈 것은 09:50경, 알림이 아니라 조사로였다.
- 열린 위반 목록은 R2 JSON 한 덩어리에만 있었다. PostgreSQL을 보는 Grafana는 개수만 그렸고, 진단하는 AI는
  돌고 있던 파드에 들어가 boto3로 읽어야 했다. 감시 상태에 사람도 기계도 닿지 못했다.
- 기대 질의가 예외로 끝나면 그 기대의 위반이 전부 "해소됨"으로 나가고 처음 본 시각이 초기화됐다(R1에서 수정).

결정 6이 한 문장에 두 개의 서로 다른 결정을 묶어 둔 것이 뿌리다. "한 사고가 여러 통으로 쪼개지지 않게"는
옳고 "미해결이어도 다시 보내지 않는다"는 틀렸는데, 한 문장이라 같이 굳었다. 그리고 그 판정의 결과를 아무
곳에도 조회 가능하게 두지 않아 억제가 방치로 변해도 볼 수 없었다.

설계 입력 둘을 명시한다. 텔레그램을 보는 사람은 한 명이다. 노드는 12GB 하나다. 당번을 도는 팀 전제의 알림
설계와 Prometheus·Alertmanager 계열 스택은 이 둘에 맞지 않는다.

## Decision

1. **묶기와 재알림은 별개다.** 한 회차에서 새로 열린 위반은 지금처럼 한 통으로 묶어 보낸다. 미해결 위반은
   심각도에 따라 다시 울린다.

   | 심각도 | 어떤 기대 | 재알림 |
   |---|---|---|
   | `critical` | 실시간 수집 중단(`capture-freshness`), 노드(`node-health`), Argo CD Application(`argocd-application`), poll-open 회차 실패(`cron-workflow:eatbid-poll-open`), 백업 신선도(`backup-freshness`) | 미해결이면 60분마다 한 통에 묶어 다시 보낸다 |
   | `normal` | 나머지 — 백필 진행, 발행 실패 창, `planned` release 나이, 원격 main CI, 릴리스 발행, 전진·기타 cron 회차, 평가 실패(`:check-failed`) | 09:03 KST 회차의 하루 요약 한 통에만 실린다 |

   하루 요약은 "열린 것 N개, 가장 오래된 것 X일째(키)"와 열린 위반 전부의 나이를 적는다. 첫 통을 놓쳐도
   다음 날 아침에 본다. 숫자(60분, 09:03)는 시작값이며 2주 뒤 `monitoring.notification`의 실제 통 수를 보고
   조정한다.

2. **감시 상태의 기준은 `monitoring.violation`과 `monitoring.notification`이다.** R2 JSON은 이관 뒤 쓰지 않는다.
   옮기는 이유는 소유권 원칙이 아니라 **조회 가능성**이다. 감시 상태는 raw도 업무 사실도 사용자 상태도 아니라
   R2에 둔 것 자체가 위반은 아니었다. 그러나 Grafana와 AI가 같은 표를 읽어야 하고, 나이·이력·재알림 판정이
   같은 표에서 나야 한다.

   - `violation`: 위반 하나가 열린 순간부터 해소까지 한 행. `violation_key`, `expectation_key`, `severity`, 문구
     셋, `first_seen_at`, `last_seen_at`, `observation`(`observed`/`unobserved`, R1), `resolved_at`,
     `last_notified_at`. 열린 행은 환경·키당 하나다. 해소된 행은 지우지 않는다 — 이력이 "이 기대가 얼마나
     자주 어떻게 깨지나"의 근거다.
   - `notification`: 보낸 통 하나에 위반 하나당 한 행. `kind`는 `opened`·`repeat`·`resolved`·`digest`.
     전송 실패도 `ok=false`와 오류로 남는다. 알림이 안 간 상태가 정상으로 보이면 안 된다.
   - DDL은 Drizzle 마이그레이션 하나다. 쓰는 역할은 이미 `monitoring.round`에 쓰는 `eatbid_dataplane`이고,
     `eatbid_grafana`는 `monitoring` SELECT를 이미 갖는다.
   - `monitoring.round`는 그대로다. `violations_open`은 이제 이 표에서 파생되지만 회차 행의 자기 기술로 남긴다.

3. **이관은 아는 것만 옮긴다.** 첫 회차에 표가 비어 있고 R2 문서가 있으면 열린 항목의 `first_seen_at`만
   옮기고 `last_notified_at`은 그 값으로 둔다(첫 통은 그때 나갔다). 없는 이력을 만들지 않는다. 그 뒤 R2 문서는
   읽지도 쓰지도 않는다.

4. **관측하지 못한 것은 상태를 바꾸지 않는다**(R1, EAT-242). 어떤 기대의 평가가 실패하면 그 기대의 열린 위반은
   `unobserved`로 남고 해소되지 않는다. 재알림은 `unobserved`인 위반도 포함한다 — 모른다는 것이 괜찮다는
   뜻은 아니다.

## Consequences

- 5일 방치의 최대치가 하루 요약 한 통으로 하루가 된다. critical은 60분이다.
- Grafana 운영 요약 대시보드가 열린 위반 목록과 나이를 그릴 수 있다(설계 D6). AI는 `select … from
  monitoring.violation where resolved_at is null` 한 줄로 같은 것을 읽는다.
- 알림 통 수가 늘어난다. 시작값이 보수적이라도 critical 분류가 틀리면 60분마다 노이즈다. 그래서 `notification`에
  통 수가 남고, 2주 뒤 그 표로 조정한다.
- `monitoring/store.py`의 R2 상태 저장소는 이관용 읽기만 남고 다음 정리에서 지운다.
- 런타임 문서 §8.3의 "해소될 때까지 반복하지 않는다" 문장은 이 결정으로 바뀐다.

## 대안과 기각 이유

- **Alertmanager의 `repeat_interval`** — 우리 알림은 지표가 아니라 기대에서 난다(ADR 0046 결정 4). Alertmanager를
  쓰려면 기대 결과를 지표로 내보내야 하고, 그러면 지표 수집이 멈추면 조용히 정상으로 보이는 실패 모드를 다시
  들인다. 우리에게 재알림은 `resolved_at is null and last_notified_at < now() - interval` 한 줄이다.
- **R2 JSON을 그대로 두고 조회 API를 앞에 세우기** — 조회가 막힌 원인은 전송이 아니라 데이터 위치다. API는 세
  번째 표면이고 보는 사람은 한 명이다.
- **incident 시스템, 확인자 기록** — 1인 운영. "언제까지 조용히"가 필요해지면 `violation`에 열 하나로 더한다.
