---
id: EVIDENCE-COLLECTION-POLL-REFETCH-2026-09-07
status: active
canonical_for: poll-open-detail-refetch-request-count
last_reviewed: 2026-09-07
review_trigger: poll-open-schedule-or-refetch-policy-change
---

# poll-open 상세 재호출 정책 전후 (2026-09-07)

[ADR 0037](../../adr/0037-poll-open-detail-refetch-policy.md)의 요청 수 비교를 운영 실측으로 채우는
문서다. §2는 정책 적용 **전**의 실측이고 §3은 적용 뒤 같은 방법으로 이어 붙인다.

## 1. 결론

정책 전 `poll-open`은 회차마다 발견된 공고 전부(165~175건)의 상세를 다시 불렀고 그 capture가
회차 시간의 절반 이상이었다. 정책 후 예상은 회차당 20~35건이며(ADR 0037 표), 실측은 §3에서 채운다.

## 2. 정책 전 실측 (main `f70271e`, dataplane 이미지 v0.1.x, 2026-09-07 KST)

읽기 전용으로 `kubectl get wf -n eatbid -o json`에서 `discover` pod의 output parameter
`discovered-count`와 `capture(*)` pod들의 시작·종료 시각을 뽑았다. 세 회차 모두 Succeeded이고 EAT-93
반영 뒤라 backfill 창과 semaphore를 다투지 않았다(11:00 회차 discover 57초).

| 회차(KST) | workflow | discover | 발견 = 상세 호출 | capture pod | capture 구간 | 회차 전체 |
|---|---|---|---|---|---|---|
| 10:00 | `eatbid-poll-open-1788742800` | 48초 | 165 | 4 | 291초 | 534초 |
| 10:30 | `eatbid-poll-open-1788744600` | 9초 | 168 | 4 | 170초 | 294초 |
| 11:00 | `eatbid-poll-open-1788746400` | 57초 | 175 | 4 | 174초 | 324초 |

같은 날 07:00 `daily-reconcile`(`eatbid-daily-reconcile-1788732000`)은 7일 창 216건을 capture pod 5개,
222초에 받았다. discover가 9,066초를 기다린 것은 EAT-93 반영 전 backfill 창 뒤에 줄을 선 탓이다.

하루로 환산하면 24회 × 평균 169건 = **약 4,060 상세 호출**이다. 발견 건수가 한 시간에 165→175로
늘었으므로 오전에는 회차당 3~7건이 새로 들어온다.

## 3. 정책 후 실측 (v0.1.21 배포 뒤, 2026-09-07 KST)

| 회차(KST) | workflow | discover | 발견 | 상세 호출 | 이유별 | 회차 전체 |
|---|---|---|---|---|---|---|
| 12:30 | `eatbid-poll-open-1788751800` | 20초 | 181 | 15 | signal-changed 14 · post-deadline-window 1 · unchanged 166 | 108분* |
| 14:30 | `eatbid-poll-open-1788759000` | — | 186 | 80 | new 5 · signal-changed 74 · deadline-passed 1 · unchanged 106 | 13분 50초 |

\* 12:30 회차의 project 단계가 같은 시각에 돌던 복구 replay의 `eatbid-core-publication` mutex를
기다렸다(EAT-99). 13:00·13:30 회차는 `concurrencyPolicy: Forbid`로 생성되지 않았고, 14:30 회차는 두 시간
만의 실행이라 신호 변화가 누적돼 상세 비율이 43%로 높다. 정책 전 회차(§2)는 발견 전량을 상세로
불렀으므로 같은 조건에서 각각 181·186건이었을 것이다. 정상 30분 주기의 대표값은 12:30 회차(8%)이며,
하루치 표는 다음 평일에 채운다.

원래 안내:


같은 방법으로 `discover` pod의 output parameter `detail-count`와 `refetch-reasons`를 읽는다.
`refetch-reasons`는 `{"new":N,"signal-changed":N,"deadline-passed":N,"post-deadline-window":N,"unchanged":N}`
모양의 JSON 객체다. 하루치를 모아 이유별 합과 회차당 평균을 §2와 같은 표로 적고, ADR 0037의 추정
(회차당 20~35건, 79~88% 절감)과 비교한다.

확인할 것:

- 신호 변화 비율이 평일 오전(마감 09~11시 집중)에 일요일 실측 6.9%보다 얼마나 높은가.
- `post-deadline-window`가 실제로 명단 변화를 잡는지 — 그 회차의 새 revision이 직전 revision과 명단
  행 수가 다른지 `core.bid_submission`으로 센다. 2시간 창 안에서 한 번도 다르지 않으면 창을 줄이고,
  창 밖에서 daily-reconcile이 명단 차이를 잡으면 창을 늘리는 것이 ADR 0037의 재검토 트리거다.
- 상세 0건 회차가 capture·normalize Skipped, validate·project·marts Succeeded로 끝나는지.

## 4. 재현

```powershell
# 회차별 발견·상세·이유 (읽기 전용)
$wf = kubectl --context eatbid-vm -n eatbid get wf eatbid-poll-open-<unix> -o json | ConvertFrom-Json
$discover = $wf.status.nodes.PSObject.Properties.Value | Where-Object { $_.displayName -eq "discover" -and $_.type -eq "Pod" }
$discover.outputs.parameters | Where-Object { $_.name -in "discovered-count","detail-count","refetch-reasons" }
```
