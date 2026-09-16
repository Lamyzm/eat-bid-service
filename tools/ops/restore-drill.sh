#!/usr/bin/env bash
# 책임: 운영 PostgreSQL 덤프를 이 PC의 일회용 컨테이너에 실제로 복원해 RTO·RPO를 숫자로 만든다(EAT-250, ADR 0046 결정 7).
# 운영은 건드리지 않는다 — R2 읽기와 로컬 Docker만. 자격은 클러스터 Secret에서 셸 변수로만 받고 출력하지 않는다.
#
# 사용:
#   tools/ops/restore-drill.sh download [DUMP]   # DUMP를 생략하면 hourly의 최신 덤프
#   tools/ops/restore-drill.sh start
#   tools/ops/restore-drill.sh restore
#   tools/ops/restore-drill.sh status
#   tools/ops/restore-drill.sh verify
#   tools/ops/restore-drill.sh cleanup
# 절차와 기록은 docs/operations/backup-and-restore.md §4.1이 소유한다.
set -u
phase=${1:-status}
DIR=${EATBID_RESTORE_DIR:-"$HOME/eatbid-restore-drill"}
NAME=${EATBID_RESTORE_CONTAINER:-eatbid-restore}
CONTEXT=${EATBID_KUBE_CONTEXT:-eatbid-prod}
mkdir -p "$DIR"

secret() { kubectl --context "$CONTEXT" -n eatbid get secret eatbid-r2 -o jsonpath="{.data.$1}" | base64 -d; }
rclone() {
  MSYS_NO_PATHCONV=1 docker run --rm -v "$DIR:/dump" \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ENDPOINT="$(secret R2_ENDPOINT_URL)" \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(secret R2_ACCESS_KEY_ID)" \
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(secret R2_SECRET_ACCESS_KEY)" \
    rclone/rclone:1.68 "$@"
}
dump_name() { [ -f "$DIR/dump.name" ] && cat "$DIR/dump.name"; }

case "$phase" in
  download)
    bucket=$(secret R2_BUCKET)
    dump=${2:-$(rclone lsl "r2:${bucket}/backup/postgres/hourly" 2>/dev/null | sort -k2,3 | tail -n 1 | awk '{print $4}')}
    [ -n "$dump" ] || { echo "hourly 덤프를 찾지 못했습니다"; exit 1; }
    echo "$dump" > "$DIR/dump.name"
    echo "download start $(date -u +%FT%TZ) dump=$dump"
    t0=$(date +%s)
    rclone copyto "r2:${bucket}/backup/postgres/hourly/${dump}" "/dump/${dump}" --s3-no-check-bucket --stats-one-line --stats 30s 2>&1 | tail -3
    echo "download done in $(( $(date +%s) - t0 ))s size=$(stat -c %s "$DIR/$dump" 2>/dev/null)"
    ;;
  start)
    docker rm -f "$NAME" >/dev/null 2>&1
    # 복원 전용 설정이다. 운영 값이 아니다 — 일회용 DB라 fsync를 끄고 버퍼를 키워 시간을 잰다.
    MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" -e POSTGRES_PASSWORD=restore -v "$DIR:/dump" -p 127.0.0.1:15499:5432 \
      --shm-size=1g postgres:16-alpine -c shared_buffers=1GB -c maintenance_work_mem=512MB -c max_wal_size=4GB \
      -c synchronous_commit=off -c fsync=off >/dev/null
    for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
    docker exec "$NAME" pg_isready -U postgres
    ;;
  restore)
    dump=$(dump_name); [ -n "$dump" ] || { echo "먼저 download"; exit 1; }
    rm -f "$DIR"/restore.exit "$DIR"/restore.t1
    echo "restore start $(date -u +%FT%TZ)"
    docker exec -d "$NAME" sh -c "date -u +%s > /dump/restore.t0 && createdb -U postgres eatbid && pg_restore -U postgres -d eatbid -j 4 --no-owner --no-privileges /dump/${dump} > /dump/restore.out 2>&1; echo \$? > /dump/restore.exit; date -u +%s > /dump/restore.t1"
    ;;
  status)
    if [ -f "$DIR/restore.exit" ]; then
      echo "restore exit=$(cat "$DIR/restore.exit") seconds=$(( $(cat "$DIR/restore.t1") - $(cat "$DIR/restore.t0") )) error_lines=$(grep -c -i 'error' "$DIR/restore.out")"
    else
      echo "restore running: $(( $(date +%s) - $(cat "$DIR/restore.t0" 2>/dev/null || date +%s) ))s, db size $(docker exec "$NAME" psql -U postgres -At -c "select pg_size_pretty(pg_database_size('eatbid'))" 2>/dev/null)"
    fi
    ;;
  verify)
    docker exec "$NAME" psql -U postgres -d eatbid -At -c "select 'core.auction_attempt', count(*) from core.auction_attempt union all select 'core.bid_submission', count(*) from core.bid_submission union all select 'ingest.run', count(*) from ingest.run union all select 'ingest.raw_observation', count(*) from ingest.raw_observation union all select 'app tables', count(*) from information_schema.tables where table_schema='app'"
    docker exec "$NAME" psql -U postgres -d eatbid -At -c "select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1"
    docker exec "$NAME" psql -U postgres -d eatbid -At -c "select pg_size_pretty(pg_database_size('eatbid'))"
    ;;
  cleanup)
    docker rm -f "$NAME" >/dev/null 2>&1; rm -f "$DIR"/*.dump "$DIR"/restore.* "$DIR"/dump.name; echo "정리했습니다: $DIR"
    ;;
  *) echo "사용: $0 download|start|restore|status|verify|cleanup"; exit 64;;
esac
