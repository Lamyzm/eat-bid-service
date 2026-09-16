---
id: BACKUP-AND-RESTORE
status: active
canonical_for: postgres-backup-schedule-and-restore-procedure
last_reviewed: 2026-09-16
review_trigger: backup-schedule-retention-r2-layout-or-postgres-major-change
---

# PostgreSQL 백업과 복원

## 1. 결론

운영 PostgreSQL은 매시 5분(KST) `eatbid-db-backup` CronWorkflow가 `pg_dump --format=custom`으로 통째로 떠서
R2 `eatbid-lake` 버킷의 `backup/postgres/`에 둔다. 손실 허용치(RPO)는 1시간이고, 그 사이 관측은 R2 raw와
`daily-reconcile`이 소스에서 다시 받는다. 원본(raw)의 권위는 여전히 R2 `raw/`이며 이 덤프는 `core`·`app`·
`mart`·`ingest`의 현재 상태 사본이다. 원본에서 다시 만들 수 없는 것은 `app`(사용자 상태)뿐이므로 백업의
진짜 목적은 `app` 보존이고, 나머지는 복구 시간을 줄이는 용도다.

WAL 기반 지속 백업(wal-g)은 postgres 이미지 교체가 필요해 다중 노드·CloudNativePG 전환과 함께 다룬다.

## 2. R2 배치와 보존

| 경로 | 주기 | 보존 |
|---|---|---|
| `backup/postgres/hourly/<UTC stamp>.dump` | 매시 | 2일(48h 지난 객체를 매 실행이 지움) |
| `backup/postgres/daily/<UTC stamp>.dump` | KST 03시 회차만 | 30일 |

hourly가 2일인 이유: 손실 허용치가 1시간이므로 시간 단위로 되감을 일은 사고 직후 며칠이고, 그보다 오래된
시점은 daily로 충분하다. 전체 덤프를 매시 쌓으므로 보존이 길면 같은 내용이 그대로 늘어난다. 덤프 1.35GB
기준 7일은 227GB, 2일은 65GB이며 5년치 백필로 덤프가 5GB가 되면 840GB와 240GB로 벌어진다.

파일명의 시각은 UTC이고 스케줄 판정은 KST다. 같은 실행이 두 폴더를 모두 정리하므로 별도 GC job이 없다.
자격증명은 dataplane과 같은 `eatbid-r2` Secret을 쓰며(`backup/` prefix 쓰기), 덤프는 database 소유자 자격
(`eatbid-postgres-bootstrap`)으로 읽는다. `eatbid_migrator`는 `app`·`core`·`ingest`·`mart`만 소유하고
레거시 `public`의 18개 표(2.9GB)는 소유자가 database 소유자라 `LOCK TABLE`에서 거부된다. 재해 복구 대상은
database 전체이므로 읽는 범위를 좁히지 않고 소유자로 읽는다. 둘의 이유는
[`secret-contract.md`](../../infra/product/secret-contract.md)에 있다. 덜 강한 전용 백업 역할은 Drizzle이
role을 만들어야 해 후속이다.

## 3. 백업이 실제로 되는지 보기

```powershell
kubectl --context eatbid-prod -n eatbid get cronwf eatbid-db-backup
kubectl --context eatbid-prod -n eatbid get wf -l workflows.argoproj.io/cron-workflow=eatbid-db-backup
```

R2 쪽은 dataplane R2 자격증명으로 rclone을 쓴다. 값은 화면에 찍지 않는다.

```powershell
infisical run --env=prod --path=/runtime/dataplane/r2 --projectId 0d794ce1-e0e3-4e48-83ea-88f2f05f9a65 --command "docker run --rm -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare -e RCLONE_CONFIG_R2_ENDPOINT=%R2_ENDPOINT_URL% -e RCLONE_CONFIG_R2_ACCESS_KEY_ID=%R2_ACCESS_KEY_ID% -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=%R2_SECRET_ACCESS_KEY% rclone/rclone:1.68 lsl r2:%R2_BUCKET%/backup/postgres/hourly"
```

실행이 실패하면 `failed` 파드가 하루 남으므로 `kubectl logs <pod> -c dump` 또는 `-c upload`로 원인을 본다.
실패는 발행·수집과 무관하다(다른 템플릿, semaphore·mutex 없음).

## 4. 복원

### 4.1 일회용 DB로 확인(리허설)

절차는 `tools/ops/restore-drill.sh`가 소유한다. 운영은 건드리지 않는다 — R2 읽기와 이 PC의 Docker만 쓰고,
R2 자격은 클러스터 Secret에서 셸 변수로만 받는다. 검증 안 된 백업은 백업이 아니므로 이 리허설은 주기적으로
반복한다(§4.3 기록).

```bash
tools/ops/restore-drill.sh download        # hourly의 최신 덤프를 받는다(덤프 이름을 주면 그것을)
tools/ops/restore-drill.sh start           # postgres:16-alpine 일회용 컨테이너(복원 전용 설정, fsync 끔)
tools/ops/restore-drill.sh restore         # createdb + pg_restore -j 4 --no-owner --no-privileges, 분리 실행
tools/ops/restore-drill.sh status          # 진행 중이면 경과 초와 DB 크기, 끝났으면 exit·소요 초·오류 줄 수
tools/ops/restore-drill.sh verify          # 핵심 표 행 수, drizzle 저널 마지막, DB 크기
tools/ops/restore-drill.sh cleanup
```

`verify`의 행 수를 운영의 같은 시각 값과 대조한다. 덤프 시각 뒤에 시작한 run이 있으면 그만큼 어긋나는 것이
정상이다. `--no-owner --no-privileges`로 복원하므로 역할 권한은 복원 뒤 `db-provisioning` Job이 저장소
상태로 다시 세운다. 컨테이너 설정(`fsync=off` 등)은 리허설 시간을 재기 위한 것이지 운영 값이 아니다.

### 4.3 리허설 기록

| 날짜 | 덤프 | 크기 | 내려받기 | 복원 | 대조 | 비고 |
|---|---|---|---|---|---|---|
| 2026-09-16 (EAT-250) | `hourly/20260916T121404Z.dump` | 4.20 GB (DB 33 GB) | 453초 | 489초, `pg_restore -j 4`, 오류 0 | `core.auction_attempt` 154,904 · `core.bid_submission` 9,891,757 · `ingest.run` 689 · `ingest.raw_observation` 451,766 — 운영과 정확히 같음. 저널 마지막 `20260916104017_ingest_source_hold`, 스키마 5개 | 이 PC(Docker Desktop, postgres:16-alpine, fsync 끔). 복원 뒤 DB 30 GB |

이 기록이 말하는 숫자:

- **RPO** — 덤프는 매시 5분 KST에 시작해 약 9분 걸린다. 최악의 손실은 약 70분(한 시간 + 덤프 시간)이다.
  리허설 시점의 실제 나이는 10분이었다.
- **RTO(데이터 부분)** — 내려받기 7.5분 + 복원 8.2분, 약 16분. 이 PC 기준이며 VM의 디스크와 네트워크는
  다르다. §4.2의 "새 클러스터 세우기"는 아직 리허설하지 않았으므로 전체 RTO는 모른다. 다음 리허설의 대상이다.
- 첫 리허설(2026-09-16)까지 이 백업은 한 번도 복원된 적이 없었다. 매시 성공하는 백업과 복원 가능한 백업은
  다른 것이고, 이 표가 둘을 구분한다.

### 4.2 운영 클러스터로 복원(재해 복구)

1. 새 클러스터를 [`k3s-hyperv-vm.md`](k3s-hyperv-vm.md) §3대로 세운다. postgres가 Ready이고 migration Job이
   빈 스키마를 만든 상태다.
2. 역할 셋(`eatbid_migrator`·`eatbid_api`·`eatbid_dataplane`)을 `secret-contract.md`의 사람 단계로 만든다.
3. 최신 덤프를 받아 postgres 파드로 복사하고 superuser로 `pg_restore --clean --if-exists --no-owner --no-privileges`.
4. Argo CD sync 한 번. provisioning Job이 권한을 세우고 server readiness가 통과한다.
5. `app`만 살리고 나머지를 R2에서 다시 만들고 싶으면 `pg_restore --schema=app`으로 좁힌 뒤 replay를 쓴다.

## 4.9 실행 로그는 파드보다 오래 산다

`podGC: OnPodSuccess`와 `ttlStrategy`가 파드를 지우므로 `kubectl logs`로는 성공 직후에만 읽을 수 있다.
2026-09-10에 성공한 백업 회차의 로그를 그래서 못 읽었다. 이제 Argo가 실행 로그를 R2에 남긴다(EAT-172).

| 항목 | 값 |
|---|---|
| 위치 | `workflow-logs/<연>/<월>/<workflow 이름>/<pod 이름>` |
| 버킷 | `eatbid-lake` (raw와 같은 버킷, 접두사로 분리) |
| 켜는 곳 | `infra/platform/argo-workflows.application.yaml`의 `artifactRepository` |

지난 회차의 로그를 읽으려면 rclone으로 그 접두사를 본다. 이 경로는 불변 raw 증거와 성질이 다르므로
`raw/`와 섞지 않는다. 보존 규칙과 삭제 권한을 따로 줄 수 있어야 한다.

```powershell
rclone lsl "r2:eatbid-lake/workflow-logs/2026/09/<workflow 이름>"
```

Argo 문서는 이 기능 대신 전용 로그 시스템을 권한다. 맞는 말이고 EAT-173·EAT-174가 그 방향이다. 그때까지
증거가 사라지는 것을 두고 볼 이유가 없어 먼저 켠다.

## 5. 하지 않는 것

- 덤프를 저장소나 개발 PC에 두지 않는다. 사본은 R2 하나다. 리허설이 개발 PC에 받은 덤프는 `restore-drill.sh cleanup`이
  지우며, 리허설 사이에 남겨 두지 않는다.
- 백업 파드에 semaphore·mutex·retry를 붙이지 않는다. 다음 정각에 다시 돈다.
- 백업 성공을 복구 가능의 증거로 삼지 않는다. 달마다 §4.1을 한 번 돌리고 §4.3에 적는다. 첫 리허설은 2026-09-16이었고
  그 전까지는 한 번도 복원된 적이 없었다.
