---
id: EVIDENCE-OPERATIONS-PROD-MOVE-2026-10-10
status: evidence
canonical_for: none
last_reviewed: 2026-10-10
review_trigger: prod-host-change
---

# 운영 클러스터를 RAM 32GB 호스트로 옮긴 실측 (2026-10-10, EAT-322)

관측 시점의 증거다. 절차의 권위는 [`k3s-hyperv-vm.md`](../../operations/k3s-hyperv-vm.md) §2.1·§3~§5이고, 데이터
이전 도구는 `infra/vm/Migrate-EatbidPostgres.ps1`이다. 사용자는 이전을 밤으로 미루지 말고 바로 하라고 결정했다.
호스트의 주소·호스트명·계정은 적지 않는다.

## 1. 새 호스트

| 항목 | 옛 호스트(2026-09-10~) | 새 호스트 |
|---|---|---|
| CPU·RAM | Ryzen 5 5600 6C/12T, 16GB | Ryzen 7 5700X 8C/16T, 32GB |
| 디스크 | 250GB | NVMe 500GB(이전 직전 여유 380GB) |
| VM | 6 vCPU·12GB·150GB | 12 vCPU·24GB 고정·300GB 동적 VHDX |
| k3s | v1.35.5+k3s1 | v1.35.5+k3s1(같은 cloud-init 템플릿, `deploy/prod` 사본) |

같은 날 오전에 새 호스트를 정리했다. 다른 프로젝트의 컨테이너와 데이터를 비우고, Windows 업데이트(재부팅 2회)를
마치고, Docker Desktop 자동 시작을 껐다.

## 2. 시각표 (KST)

| 시각 | 일 |
|---|---|
| 09:29 | 개발 PC Docker로 VHDX(2.19GB)·seed ISO 생성. `-ArtifactsOnly`는 관리자 검사 때문에 쓰지 못해 같은 docker 명령을 직접 실행 |
| 09:31 | 새 호스트에서 `Resize-VHD` 300GB → `New-EatbidVm.ps1` → `Expose-EatbidVm.ps1` |
| 09:34 | cloud-init 완료, 노드 Ready |
| 09:35 | 옛 클러스터 `eatbid` Application syncPolicy null, CronWorkflow 여덟 개 suspend(reference-refresh는 원래 suspend) |
| 09:36 | 부트스트랩 첫 실행이 Windows PowerShell 5.1에서 첫 Secret 존재 검사 중 멈춤 → PowerShell 7로 재실행해 통과 |
| 09:02~11:05 | 옛 클러스터에서 실행 중이던 backfill-advance(418→836 단계, 마지막 project 단계 40분)가 끝나기를 기다림 |
| 11:07~11:23 | 원본 파드 안 `pg_dump -Fc`(우리 스키마 여섯) 7,225,668,359 bytes, 16분 |
| 11:24~11:28 | 첫 복사 실패: `cmd` 파이프로 잇던 받는 쪽 `kubectl exec -i`가 즉시 끝나 0 bytes |
| 11:28~11:39 | 원본 파드 → 새 호스트 파일 659초(약 11MB/s), sha256 일치 |
| 11:39 | 새 호스트 → 대상 파드 `kubectl exec -i` 즉시 끊김. 1MB·64MB 시험도 종료 코드 0인데 내용 불일치. VM 안 리눅스 kubectl도 같음 |
| 11:41~11:43 | 호스트 → VM scp 41초, pgdata 볼륨 디렉터리로 `mv`, 파드 안 sha256 일치 |
| 11:44~12:07 | `pg_restore -j 8` 23분 33초, 오류 0 |
| 12:08 | ANALYZE 5초. 표 80개 정확한 행 수 대조: `app` 13표만 다름(덤프 뒤 가입 1명과 세션) |
| 12:09:52 | 옛 cloudflared 0 — 사이트 중단 시작 |
| 12:10:02~12:10:10 | 개정 스크립트 `-Schemas app -ReplaceSchemas -SkipGlobals`: 54,616 bytes, `app` 18표 행 수 일치 |
| 12:10:25 | 새 클러스터에 automated Application 적용 → migration Job이 `CREATE SCHEMA IF NOT EXISTS "drizzle"`에서 실패 |
| 12:21:23 | 원본 datacl을 그대로 다시 주고 sync 재시도 |
| 12:22 | server·web Ready, eatbid.net `/login` 200. Application 여섯 Synced·Healthy, CronWorkflow Git 값으로 재개 |
| 12:23 | kubectl context 이름 교체(새 `eatbid-prod`, 옛 `eatbid-old`). 운영자 권한 1건 부여([operator-grant.md](../../operations/operator-grant.md)) |
| 12:25 | 새 호스트 재부팅 시험 시작 |

사이트 중단은 12:10부터 12:22까지 약 12분이다. 그중 11분은 §4의 권한 누락 때문이었다.

## 3. 데이터 대조

- 역할 다섯(`eatbid`·`eatbid_api`·`eatbid_dataplane`·`eatbid_grafana`·`eatbid_migrator`): 속성과 비밀번호 해시가 일치한다.
- 표 80개의 정확한 행 수: `app`을 다시 맞춘 뒤 전부 일치한다. 대표 값은 `core.bid_submission` 56,012,276,
  `core.auction_attempt` 1,178,829, `ingest.raw_observation` 1,788,127이다.
- 데이터베이스 권한(datacl)은 문자열까지 일치한다(재시도 뒤).
- 레거시 `public` 18표(2.9GB)는 옮기지 않았다. 우리 스키마에서 그 표를 쓰는 열 타입·FK·뷰가 0개이고, 코드 참조도
  문서에만 있다. R2 보관본이 권위다.

## 4. 드러난 결함과 고친 것

1. **데이터베이스 단위 권한 누락.** 스키마만 고른 `pg_dump`와 `pg_dumpall --globals-only`에는 `GRANT ... ON DATABASE`가
   실리지 않는다. 9월까지 쓰던 전체 `pg_dumpall`에는 실려 있었다. 이것이 빠져 `eatbid_migrator`가 CREATE 권한 없이
   migration을 돌렸다. 고친 것: 이전 스크립트가 원본 datacl을 읽어 다시 주고, 문자열로 대조한다.
2. **`kubectl exec -i` 입력 손상.** 새 클러스터로 큰 입력을 밀어 넣으면 끊기거나 다른 내용으로 도착하고, 종료 코드는
   0이다. 원본 쪽 출력 방향은 7GB가 해시까지 맞았다. 고친 것: 대상 쪽은 scp와 pgdata 볼륨 `mv`로 넣고, 단계마다
   sha256을 대조한다. 원인(k3s 쪽인지 스트림 프로토콜인지)은 조사하지 않았다. 작은 SQL(역할 globals)은 같은 경로로
   들어갔고 결과가 일치했다.
3. **스키마 한정 덤프의 사각지대.** 덤프 뒤에도 사이트가 옛 클러스터에서 응답해 가입 1건과 사업자 등록이 옛 DB에
   쌓였다. 고친 것: cutover에서 옛 cloudflared를 0으로 내린 직후 `app`만 다시 맞추는 단계를 절차에 넣었다.
4. **호스트 도구.** 호스트 스크립트는 PowerShell 7을 전제로 한다. `pwsh`에서 `ssh-keygen -N '""'`는 `""` 두 글자를
   암호로 만든다. 새 호스트 PATH의 kubectl은 Docker Desktop이 넣은 1.36이었다.

## 5. 재부팅 복구

수용 기준(runbook §5의 5)을 확인했다. 아무도 로그인하지 않은 상태에서 새 호스트를 재부팅했다(12:24 예약, 1분 예고).

| 시각 | 관측 |
|---|---|
| 12:25:02 | eatbid.net 530(원본에 닿지 않음) |
| 12:26:57 | 호스트 부팅 완료(LastBootUpTime) |
| 12:27:48 무렵 | VM 자동 시작(`AutomaticStartDelay` 30초) |
| 12:28:18 | `/login` 200, 중단 시작부터 196초. Application 여섯 Synced·Healthy |

9월 옛 호스트 실측(전체 복구 188초)과 같은 수준이다. Tailscale 무인 모드와 portproxy도 재부팅 뒤 그대로 살아 있었다.

## 6. 남긴 것

옛 클러스터는 되돌리기용으로 남겼다. 상태는 syncPolicy 없음, CronWorkflow 전부 suspend, cloudflared 0이다.
kubectl context는 `eatbid-old`다. 며칠 동안 새 클러스터에서 수집·백필·백업이 실패 없이 도는지 본 뒤에 정리한다.
postgres 설정(`shared_buffers=2GB`)은 12GB 노드 기준 그대로다. 24GB 노드에 맞춰 바꾸는 것은 별도 결정이다.
