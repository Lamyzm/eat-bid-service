# 0069 — 수집 예약은 실행 시간 상한을 갖고, 끝난 단계가 쥔 자물쇠는 전용 예약이 푼다

- Status: Accepted
- Date: 2026-10-16
- Supersedes: 없음.
- 보충: [ADR 0046](0046-telemetry-wire-correlation-and-alert-origin.md) 결정 5(멈춤은 기대 문장으로 잡는다)에 `stuck-lock` 기대를
  더한다. 감시 권한은 읽기뿐인 채로 두고(`monitoring-rbac.yaml`), 고치는 일은 이 ADR의 풀기 예약이 한다.
- 관련 작업: EAT-361
- 승인: 사용자 결정(2026-10-16 "해봐" — 멈춘 뒤 서버가 다시 떠도 수집이 스스로 이어 가게)

## Context

2026-10-14 17:29(KST) 클러스터 파드가 모두 재시작됐다. 그때 `eatbid-core-publication` mutex를 쥐고 있던 replay-advance 회차의
replay 단계 파드가 SIGTERM(exit 143)으로 죽었다. Argo(v4.0.8)는 그 단계를 실패로 표시했지만 끝난 시각을 붙이지 않았고, 회차를
Running으로 둔 채 reconcile마다 mutex를 다시 잡았다. 공고 수집(16:30)·아침 정리(10-15 07:00)·개찰 결과(10-15 09:00)·백필이
project 단계에서 그 mutex를 기다렸다. CronWorkflow가 모두 `concurrencyPolicy: Forbid`라 그 뒤 회차가 35시간 만들어지지 않았다.
2026-10-16 03:34에 runbook §4.4로 손으로 풀었다. 2026-09-10, 2026-09-19에 이어 세 번째다.

데이터 쪽 이어 가기는 이미 사실에서 다시 계산한다. 공고 수집과 개찰 결과는 오늘 창을 매번 새로 읽고, 아침 정리는 7일 창을,
백필은 커버리지 view(ADR 0052)를, 재처리는 실패 창 목록(EAT-274)을 다시 읽는다. 멈춘 것은 실행 층이었다.

2026-10-16 로컬 Argo(v4.0.8, k3d)에서 원인을 재현했다.

| 실험 | 결과 |
|---|---|
| 자물쇠를 쥔 채 15분 자는 회차에 `activeDeadlineSeconds: 60` | 60초에 실패로 끝나며 자물쇠를 놓았고 대기 회차가 이어받았다 |
| 노드(k3s 컨테이너) 재시작 | 컨트롤러가 회차를 실패로 끝내고 자물쇠를 놓았다. 죽은 보유가 생기지 않았다 |
| 보유 단계 파드의 wait 컨테이너를 먼저 죽이고 main을 SIGTERM | 운영과 같은 꼴이 됐다. 단계는 Failed·끝난 시각 없음, 회차 Running, mutex 보유 |
| 위 상태에 `activeDeadlineSeconds`를 넘김 | 풀리지 않았다. 상한이 끊을 살아 있는 파드가 없다 |
| 위 상태에 `shutdown: Terminate` (DAG 회차) | 풀렸다 |
| 위 상태에 `shutdown: Terminate` (Steps 회차) | 풀리지 않았다 |
| Steps 회차의 WorkflowTaskResult에 `report-outputs-completed=true` | 풀렸다 |

컨트롤러는 로그에 "wait 컨테이너가 정상 종료하지 않아 결과 보고를 완료로 표시한다"고 적지만 그 표시를 저장하지 않는다. 그래서
단계는 실패했는데 끝나지 않은 노드가 되고, 그 노드가 쥔 자물쇠는 영영 풀리지 않는다.

## Decision

1. **모든 CronWorkflow는 실행 시간 상한(`activeDeadlineSeconds`)을 갖는다.** 살아서 끝나지 않는 회차가 Forbid 아래에서 그 예약
   전체를 조용히 멈추지 않게 한다. 상한에는 자물쇠 대기도 든다. 그래서 값은 정상 회차의 실측 최대(ingest.run, 2026-09-16~10-16)보다
   길게 잡는다. 정상인데 오래 걸리는 회차를 계속 끊어 영영 끝나지 못하게 만드는 것이 상한 없는 것보다 나쁘다. 값과 근거는 각 예약
   manifest가 소유한다.
2. **끝난 단계가 쥔 자물쇠는 전용 예약 `eatbid-lock-release`가 10분마다 푼다.** 보유 단계가 끝난 지(끝난 시각이 없으면 시작한 지)
   10분이 지났는데도 자물쇠를 쥔 Running 회차에 `shutdown: Terminate`를 걸고, 그 단계의 결과 보고가 미완료면 완료로 표시한다.
   대상 회차는 보유 단계가 이미 실패해 있어 어차피 실패로 끝난다. 끊어서 잃는 것이 없다.
3. **이미 끝난 회차가 남긴 자물쇠(2026-09-20 꼴)는 사람에게 남긴다.** 회차를 지우고 컨트롤러를 다시 띄워야 풀린다. 기계는
   Workflow를 지우지 않는다. 감시가 critical로 알리고, 경보에 푸는 법을 적는다.
4. **주인이 놓은 자물쇠를 아직 기다리는 회차는 풀기 예약이 깨운다.** 대기 기록에 적힌 주인 가운데 누구도 그 자물쇠를 쥐고 있지
   않을 때만 `eatbid.dev/nudge` annotation을 바꿔 다시 조정하게 한다. runbook §4.4 2단계와 같은 동작이다.
5. **풀기는 감시와 다른 ServiceAccount로 돈다.** `eatbid-lock-release`는 eatbid namespace의 Workflow get/list/patch와
   WorkflowTaskResult get/create/patch만 받는다. delete와 Secret은 받지 않는다. 수집·감시 파드가 쓰는 `eatbid-dataplane`은
   Workflow를 바꿀 수 없다. 풀기 예약은 수집 WorkflowTemplate을 참조하지 않고, 자물쇠를 잡지 않으며, DB·R2 비밀도 받지 않는다.
   그래서 DB가 막혀 있을 때도 돈다. 풀기 회차 자체가 걸리면 Forbid가 풀기를 멈추므로 `concurrencyPolicy: Replace`다.
6. **판정은 하나다.** 감시의 `stuck-lock` 기대와 풀기 예약은 같은 순수 함수(`eatbid.monitoring.stuck_locks.find_stuck_locks`)로
   죽은 보유를 가른다. "알렸는데 안 풀었다"나 "풀었는데 몰랐다"가 생기지 않는다. 감시는 죽은 보유를 critical로 알리고, 풀기
   예약이 풀면 다음 감시 회차에 해소된다. 사람은 "재시작이 있었고 스스로 풀렸다"를 알림 두 통으로 안다.

## Consequences

- 재시작이 단계를 죽여도 늦어도 20분 안에 자물쇠가 풀리고 기다리던 회차가 이어 간다. 그동안 정시 공고 수집 한두 회차를 잃는다.
- Argo 내부 표시(`workflows.argoproj.io/report-outputs-completed`)를 우리가 바꾼다. Argo가 그 이름을 바꾸면 Steps 꼴에서는 Terminate만
  남는다. 운영 수집 회차는 모두 DAG라 그때도 풀린다. Argo를 올릴 때 이 동작을 로컬에서 다시 재현해 본다.
- 상한이 실측보다 짧으면 정상 회차를 끊는다. 성수기에 회차가 길어지면 상한을 먼저 다시 본다. 끊긴 회차는 cron 실패로 알림이 간다.
- 감시가 "스스로 풀렸다"를 알림으로 남기므로 재시작 빈도가 보인다. 재시작 원인 자체는 이 ADR의 범위가 아니다(EAT-364).

## 되돌리기 조건

- Argo가 재시작으로 죽은 단계의 결과 보고를 스스로 마무리하고, 로컬 재현에서 죽은 보유가 더는 생기지 않으면 풀기 예약을 뺀다.
  감시의 `stuck-lock` 기대는 남긴다.
