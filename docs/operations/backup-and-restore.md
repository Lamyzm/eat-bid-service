---
id: BACKUP-AND-RESTORE
status: active
canonical_for: postgres-backup-schedule-and-restore-procedure
last_reviewed: 2026-09-10
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
kubectl --context eatbid-vm -n eatbid get cronwf eatbid-db-backup
kubectl --context eatbid-vm -n eatbid get wf -l workflows.argoproj.io/cron-workflow=eatbid-db-backup
```

R2 쪽은 dataplane R2 자격증명으로 rclone을 쓴다. 값은 화면에 찍지 않는다.

```powershell
infisical run --env=prod --path=/runtime/dataplane/r2 --projectId 0d794ce1-e0e3-4e48-83ea-88f2f05f9a65 --command "docker run --rm -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare -e RCLONE_CONFIG_R2_ENDPOINT=%R2_ENDPOINT_URL% -e RCLONE_CONFIG_R2_ACCESS_KEY_ID=%R2_ACCESS_KEY_ID% -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=%R2_SECRET_ACCESS_KEY% rclone/rclone:1.68 lsl r2:%R2_BUCKET%/backup/postgres/hourly"
```

실행이 실패하면 `failed` 파드가 하루 남으므로 `kubectl logs <pod> -c dump` 또는 `-c upload`로 원인을 본다.
실패는 발행·수집과 무관하다(다른 템플릿, semaphore·mutex 없음).

## 4. 복원

### 4.1 일회용 DB로 확인(리허설)

```powershell
docker run -d --name eatbid-restore -e POSTGRES_PASSWORD=restore -p 127.0.0.1:15499:5432 postgres:16-alpine
# 덤프 내려받기(위 rclone으로 copyto ./eatbid.dump)
docker cp .\eatbid.dump eatbid-restore:/tmp/eatbid.dump
docker exec eatbid-restore sh -c "createdb -U postgres eatbid && pg_restore -U postgres -d eatbid --no-owner --no-privileges /tmp/eatbid.dump"
docker exec eatbid-restore psql -U postgres -d eatbid -At -c "select count(*) from core.auction_attempt"
docker rm -f eatbid-restore
```

행 수가 원본의 같은 시각 값과 같아야 한다. `--no-owner --no-privileges`로 복원하므로 역할 권한은
복원 뒤 `db-provisioning` Job이 저장소 상태로 다시 세운다.

### 4.2 운영 클러스터로 복원(재해 복구)

1. 새 클러스터를 [`k3s-hyperv-vm.md`](k3s-hyperv-vm.md) §3대로 세운다. postgres가 Ready이고 migration Job이
   빈 스키마를 만든 상태다.
2. 역할 셋(`eatbid_migrator`·`eatbid_api`·`eatbid_dataplane`)을 `secret-contract.md`의 사람 단계로 만든다.
3. 최신 덤프를 받아 postgres 파드로 복사하고 superuser로 `pg_restore --clean --if-exists --no-owner --no-privileges`.
4. Argo CD sync 한 번. provisioning Job이 권한을 세우고 server readiness가 통과한다.
5. `app`만 살리고 나머지를 R2에서 다시 만들고 싶으면 `pg_restore --schema=app`으로 좁힌 뒤 replay를 쓴다.

## 5. 하지 않는 것

- 덤프를 저장소나 개발 PC에 두지 않는다. 사본은 R2 하나다.
- 백업 파드에 semaphore·mutex·retry를 붙이지 않는다. 다음 정각에 다시 돈다.
- 백업 성공을 복구 가능의 증거로 삼지 않는다. 분기마다 4.1을 한 번 돌린다.
