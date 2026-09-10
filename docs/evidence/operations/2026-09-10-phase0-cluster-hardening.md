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

`eatbid-share`는 EAT-126이 폐기 중이라 처음에 뺐으나, 같은 날 EAT-129 부트스트랩이 그 Secret 없이 멈춰
(`main`의 server manifest가 아직 요구) 같은 형식으로 `K8S_SECRET_EATBID_EATBID_SHARE`(288 bytes)를 추가했다.
목록에도 되돌렸다. 같은 날 저녁 EAT-126이 main에 들어가 server가 더는 요구하지 않으므로 목록에서 다시 뺐다(Infisical의
사본은 남아 있으나 복원 대상이 아니다). `eatbid-infisical-operator`는 같은 경로의 `INFISICAL_CLIENT_ID/SECRET`로 조립한다.

### 4.1.1 복구 사본 실사용 (2026-09-10 17:2x KST)

EAT-129 새 클러스터 부트스트랩이 `-FromInfisical`로 이 사본에서 Secret 여섯을 재생성했다(operator identity 조립
포함). 옛 클러스터 없이 세우는 경로가 실제로 동작함을 확인했다.

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

이 리허설 객체는 hourly 보존 규칙(7일)에 따라 첫 스케줄 실행들이 지운다. 24시간 파드 수 관측은 이 절에 덧붙인다.

### 4.3 첫 스케줄 실행 실패와 자격 정정 (2026-09-10 22:05 KST)

main 반영 뒤 첫 회차 `eatbid-db-backup-1789045500`이 1초 만에 실패했다.

```
pg_dump: error: query failed: ERROR:  permission denied for table account
pg_dump: detail: Query was: LOCK TABLE app.…, core.…, public.account, … IN ACCESS SHARE MODE
```

`pg_dump`는 전체 덤프 앞에서 모든 표를 한 문장으로 `ACCESS SHARE` 잠그므로 하나라도 못 읽으면 그 자리에서
끝난다. §4.2 리허설은 개발 PC에서 database 소유자 자격으로 돌려 이 경계를 지나쳤고, 클러스터 안에서만
`eatbid_migrator`로 돌아 드러났다.

| schema | 표 | 크기 | 소유자 |
|---|---|---|---|
| `core` | 24 | 2,627MB | `eatbid_migrator` |
| `public` (레거시) | 18 | 2,887MB | database 소유자 |
| `mart` | 5 | 2,053MB | `eatbid_migrator` |
| `ingest` | 14 | 959MB | `eatbid_migrator` |
| `app`·`drizzle` | 13 | 288kB | `eatbid_migrator` |

레거시 `public`은 `firm_bids` 1,107만 행, `school_roster_cat` 142만 행 등 database의 34%다. schema를 좁혀
덤프하면 이 구간이 백업에서 조용히 빠지므로, 범위를 좁히는 대신 provisioning Job과 같은
`eatbid-postgres-bootstrap` 자격으로 읽도록 고쳤다. 계약 테스트는 `--schema` 사용을 막아 이 결정을 고정한다.
권한이 더 좁은 전용 백업 역할은 role 생성이 Drizzle 소관이라 후속으로 둔다.
