---
id: EVIDENCE-OPERATIONS-PROD-MOVE-2026-09-10
status: evidence
canonical_for: none
last_reviewed: 2026-09-10
review_trigger: prod-host-change
---

# 운영 클러스터를 전용 PC로 이전한 실측 (2026-09-10, EAT-129)

관측 시점의 증거다. 절차의 권위는 [`k3s-hyperv-vm.md`](../../operations/k3s-hyperv-vm.md) §2.1·§3~§5다.

## 1. 새 호스트

| 항목 | 값 |
|---|---|
| 기기 | Windows 10 Pro, Ryzen 5 5600(6C/12T), **RAM 16GB(1슬롯)**, C: 250GB(여유 172GB) |
| 관리 경로 | Tailscale `mw-vmhost` 100.100.253.75, ssh `k@`, LAN 192.168.219.43 |
| VM | `eatbid-k3s` 6 vCPU·12GB·150GB(dynamic VHDX 2.19GB), k3s v1.35.5+k3s1, Ubuntu 24.04.5 |
| tls-san | 172.30.0.10, eatbid-k3s, 100.100.253.75, 192.168.219.43 |
| 노출 | 호스트 portproxy 0.0.0.0:6443→VM:6443, 2222→22, 방화벽 Tailscale·사설 LAN만 |
| kubeconfig | 개발 PC context `eatbid-prod`(server 100.100.253.75:6443), TLS 검증 통과 |

VHDX·seed ISO는 개발 PC에서 `-ArtifactsOnly`로 만들어 scp(224초). 새 PC Docker Desktop은 기동 실패 상태로
`com.docker.backend`가 13.7GB를 점유해 VM 12GB 할당이 `0x800705AA`로 거부됐다. 프로세스 종료·자동 시작 해제 뒤
가용 12.3GB에서 기동.

## 2. 부트스트랩

`Bootstrap-EatbidCluster.ps1 -TargetContext eatbid-prod -FromInfisical`(EAT-127 브랜치). Infisical
`prod:/platform/kubernetes` 복구 사본으로 Secret 여섯 재생성(첫 실행은 `eatbid-share` 사본 누락으로 멈춰 사본 추가 뒤
재개). platform Application 둘의 첫 sync는 patch를 대기 앞으로 옮겨 통과. 결과: argo-workflows·infisical-secrets-
operator Synced/Healthy, InfisicalSecret 6개, postgres Running.

## 3. 사고: 빈 클러스터로 트래픽 유출

`eatbid` Application을 automated로 적용한 직후 cloudflared가 떠 같은 터널의 커넥터가 둘이 됐고, migration hook
대기 중이라 server·web이 없는 새 클러스터로 간 요청이 traefik 503을 받았다(`/today`·`/api/v1/auctions/1` 6/6 503).
옛 클러스터 server readiness는 200. 조치: syncPolicy null·cloudflared 0은 진행 중 sync가 두 번 되돌려,
`argocd-application-controller` replicas 0으로 고정. 노출 약 10분(17:37~17:47 KST), 실사용자 없음.
재발 방지는 Bootstrap이 Application을 syncPolicy 없이 적용하도록 바꿈(commit `f868c798`).

## 4. 데이터 이전

`Migrate-EatbidPostgres.ps1 -SourceContext eatbid-vm -TargetContext eatbid-prod`. `pg_dumpall` 12,148,429,798 bytes,
kubectl exec 경유 복원, restore.log ERROR 2건("current user cannot be dropped", "role eatbid already exists"; 무해).
전 테이블 행 수 대조(4 schema, 54 테이블) `Compare-Object` 차이 0, DB 8,528MB. 핵심 표:

| 표 | 옛 | 새 |
|---|---|---|
| `ingest.raw_observation` | 164,623 | 164,623 |
| `core.auction_attempt` | 76,977 | 76,977 |
| `mart.build` | 214 | 214 |

## 5. 겹쳐 켜기와 전환

- cloudflared를 뺀 product 렌더를 수동 적용해 server·web을 먼저 띄움(readiness 200). 이때 CronWorkflow가
  suspend:false로 따라 들어와 즉시 suspend:true로 patch(이중 수집 방지).
- 새 cloudflared 1 → `/api/v1/auctions/1` 10/10 200, `/today` 6/6 200, 수신은 전부 새 server(옛 0).
- 18:30 회차 전 옛 클러스터 수집 정지(syncPolicy null, cronwf suspend). 양쪽 행 수 동일 확인.
- 사용자 승인 뒤: 옛 Workflow 3개 Terminate(backfill 2025-11 창 19h, daily-reconcile 11h, poll-open 10h),
  옛 cloudflared 0 → 새 컨트롤러 1 → 원본 application.yaml 적용 → Synced/Healthy/Succeeded, cronwf suspend false.
- 개발 PC의 백필 운영 루프(`operator.sh`, CTX=eatbid-vm) 정지 → CTX=eatbid-prod로 바꿔 재기동.

## 6. 재부팅 실증

`shutdown /r` 18:54:16 KST. 노드 Ready 186초, Argo 셋 Synced/Healthy + `/today` 200까지 188초. 로그인 없음.
portproxy·Tailscale·VM 자동 시작 모두 유지.

## 6.1 전환 중 실패한 수집 회차 (원인 확정)

| Workflow | 실패 | 원인 |
|---|---|---|
| `eatbid-poll-open-1789030800` (18:00 KST) | discover exit 64, `permission denied for schema ingest` | pg_dumpall 복원 뒤 migrator sync가 GRANT를 되돌리기 전에 CronWorkflow가 suspend:false로 들어와 1회 돌았다. 18:53 회차 discover는 성공. |
| `eatbid-poll-open-1789033800` capture(1) | exit 143 (SIGTERM), wait 컨테이너에 `10.43.0.1:443 connection refused` | §6 재부팅 실증(18:54:16 KST)이 capture 파드를 죽였다. 나머지 capture는 재부팅 뒤 semaphore를 받아 계속 진행. |

둘 다 전환 작업이 원인이며 재발 조건이 아니다. poll-open은 다음 회차가 열린 공고를 다시 발견하므로 별도 재실행은 하지 않는다.

## 6.2 백필 운영 루프 재기동

CTX만 바꿔 `Start-Process bash.exe supervisor.sh`로 올렸더니 supervisor 안의 `bash "$BASE/operator.sh"`가
PATH의 `C:\WINDOWS\system32\bash.exe`(WSL)로 풀려 `execvpe(/bin/bash) failed`만 반복했다. supervisor의
호출을 `"${BASH:-/usr/bin/bash}"`로 고치고 Git Bash `usr/bin`을 PATH 앞에 둔 채 재기동해
19:09 KST `SUBMIT 20251101..20251130 건수=16915 workflow=eatbid-backfill-20251101-20251130-ptphk`가 prod에서
Running임을 확인했다.

## 6.3 재부팅이 남긴 semaphore 교착 (2026-09-10 21:00 KST 해소)

§6의 재부팅이 capture 파드를 SIGTERM으로 죽였고(§6.1), 그 노드가 source semaphore 보유자로 남았다. Argo
컨트롤러는 재시작할 때 각 Workflow의 `status.synchronization.holding`에서 보유자를 다시 읽으므로, 죽은 노드가
계속 보유자로 복원되어 자물쇠가 영원히 풀리지 않았다. 같은 노드가 `holding`과 `waiting` 양쪽에 동시에
들어가 자기 자신을 기다리는 모양이었다.

| 항목 | 값 |
|---|---|
| 멈춘 구간 | 18:54 KST(재부팅) ~ 21:00 KST |
| 막힌 것 | `eatbid-poll-open-1789033800`의 남은 capture 8개, `eatbid-backfill-20251101-20251130-ptphk` 전체 |
| 실행 중이던 수집 파드 | 0개 (전부 Pending) |
| 조치 | 막힌 poll-open에 `spec.shutdown: Terminate` patch |
| 결과 | 컨트롤러가 `Lock released … availableLocks=1` 기록 |

Terminate로 잃은 것은 없다. 그 회차는 이미 capture 1개가 영구 실패라 발행에 이르지 못하고, 받아둔 원본은 R2와
`ingest.raw_observation`에 남으며, 열린 공고는 다음 회차가 다시 발견한다.

**자물쇠가 풀려도 대기 중이던 Workflow는 스스로 깨어나지 않았다.** 백필은 `Lock status: 0/1` 문구를 문 채
그대로 있었고 컨트롤러 로그에 그 workflow에 대한 처리가 없었다. annotation을 하나 덮어써(`kubectl annotate wf
… --overwrite`) 재조정을 유도하자 discover가 곧바로 Running으로 넘어갔다. 이 두 단계는
[`collection-runbook.md`](../../operations/collection-runbook.md) §4.4가 절차로 소유한다.

## 7. 남은 것

- EAT-127 4번(PVC 100Gi·Recreate)은 EAT-126 뒤. 지금 새 클러스터 PVC 선언은 여전히 2Gi(local-path라 실제 제한 없음).
- 옛 VM(`eatbid-vm`)은 dev 전환 전까지 수집·터널 없이 살아 있다(EAT-130).
- 다음 release tag 1회가 새 prod에서 사람 없이 끝나는지 확인(acceptance).
