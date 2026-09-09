---
id: EVIDENCE-OPERATIONS-PHASE0-2026-09-10
status: evidence
canonical_for: none
last_reviewed: 2026-09-10
review_trigger: cluster-hardening-rerun
---

# 운영 VM 정비 실측 (2026-09-10, EAT-127)

관측 시점의 증거다. 절차의 권위는 [`backup-and-restore.md`](../../operations/backup-and-restore.md)와
[`k3s-hyperv-vm.md`](../../operations/k3s-hyperv-vm.md)다.

## 1. 완료 파드 정리

| 항목 | 값 |
|---|---|
| 정리 전 Workflow 객체 | 38 |
| 정리 전 파드 (Succeeded / Failed / 그 외) | 6,519 / 41 / 7 |
| 명령 | `kubectl -n eatbid delete pods --field-selector=status.phase=Succeeded --wait=false` |
| 정리 후 파드 합계 | 48 |
| VM 가용 메모리 (정리 전 → 후) | 1,976MB → 2,166MB |

메모리가 거의 돌아오지 않았다. 완료 파드는 API 서버·etcd 객체이지 노드 RSS가 아니므로, 12GB 노드의 압박은
postgres·server·web·Argo 자체다. 메모리는 새 PC(24GB VM, EAT-129)로 푼다. 재발 방지는 WorkflowTemplate의
`podGC: OnPodSuccess`와 `ttlStrategy`(성공 1h·실패 24h)이며 이 변경이 main에 들어간 뒤 24시간 관측을
§4에 추가한다.

## 2. 수동 Secret 복구 사본

`Export-EatbidManualSecrets.ps1 -SourceContext eatbid-vm` 실행 결과는 §4에 기록한다.

## 3. 백업·복원 리허설(로컬)

CronWorkflow가 main에 들어가기 전, 같은 명령 순서를 개발 PC에서 운영 DB(port-forward) 상대로 1회 실행해
R2 업로드와 일회용 postgres 복원을 확인했다. 결과는 §4.

## 4. 실행 기록

### 4.1 수동 Secret 복구 사본 (2026-09-10 04:5x KST)

`Export-EatbidManualSecrets.ps1 -SourceContext eatbid-vm` 결과. 값은 찍지 않고 base64 길이만 남겼다.

| Infisical key | 원본 | base64 길이 |
|---|---|---|
| `K8S_SECRET_ARGOCD_REPO_EATBID` | `argocd/repo-eatbid` | 460 |
| `K8S_SECRET_EATBID_GHCR_PULL` | `eatbid/ghcr-pull` | 536 |
| `K8S_SECRET_EATBID_CLOUDFLARED_CREDS` | `eatbid/cloudflared-creds` | 524 |
| `K8S_SECRET_EATBID_EATBID_AUTH` | `eatbid/eatbid-auth` | 608 |

`eatbid-share`는 EAT-126이 미사용으로 폐기 중이라 올리지 않았다. `eatbid-infisical-operator`는 같은 경로의
`INFISICAL_CLIENT_ID/SECRET`로 조립한다.

### 4.2 백업·복원 리허설 (2026-09-10 04:58~05:35 KST, 로컬)

운영 DB를 port-forward(15432)로 읽어 CronWorkflow와 같은 명령을 개발 PC의 docker로 실행했다.

| 단계 | 결과 |
|---|---|
| `pg_dump --format=custom --no-owner --no-privileges` | 1,353,291,428 bytes, **1,234초**(port-forward 경유. 클러스터 안에서는 이보다 짧을 것이며 첫 스케줄 실행에서 재측정) |
| `rclone copyto` → `r2:eatbid-lake/backup/postgres/hourly/20260909T201847Z-local-rehearsal.dump` | 143초, `rclone lsl`로 객체 확인 |
| 일회용 `postgres:16-alpine`에 `pg_restore --jobs=4` | 407초, exit 0 |

행 수 대조(복원본 = 운영):

| 표 | 복원본 | 운영 |
|---|---|---|
| `core.auction_attempt` | 76,977 | 76,977 |
| `core.bid_submission_2026` | 4,195,744 | 4,195,744 |
| `mart.build` | 214 | 214 |
| `app.workspace` | 0 | 0 |

이 리허설 객체는 hourly 보존 규칙(7일)에 따라 첫 스케줄 실행들이 지운다. 클러스터 안 첫 실행의 소요 시간과
24시간 파드 수 관측은 main 반영 뒤 이 절에 덧붙인다.
