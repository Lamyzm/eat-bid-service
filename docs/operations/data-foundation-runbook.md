# Data foundation fixture·replay runbook

이 runbook은 Task 13의 오프라인 fixture capability만 검증한다. PowerShell 7에서 이
worktree 최상단을 현재 디렉터리로 두고 실행한다. `eatbid-pg`, `127.0.0.1:8081`, live
eaT/R2/Argo에는 접근하지 않는다.

## 1. frozen dependency 확인

```powershell
git rev-parse --show-toplevel
git branch --show-current
pnpm install --frozen-lockfile
uv sync --project apps/dataplane --frozen
pnpm --filter @eatbid/db build
```

worktree 경로와 `feat/data-foundation`이 출력되어야 한다. lockfile 변경이 필요하면 중단한다.

## 2. 소유권이 표시된 disposable PostgreSQL에서 end-to-end 실행

아래 블록 전체를 한 번에 실행한다. PostgreSQL 16의 이름·password·host port는 매번 새로
만들며, production fixture runner가 **이 컨테이너**를 migration 후 직접 채운다. `finally`는
성공/실패와 무관하게 정확히 이 세션이 만든 컨테이너 하나만 제거한다.

```powershell
$EatbidTask13Container = "eatbid-task13-$([Guid]::NewGuid().ToString('N'))"
$EatbidTask13Password = [Guid]::NewGuid().ToString('N')
$EatbidTask13Created = $false

try {
  docker run --detach --name $EatbidTask13Container --label eatbid.test-owner=task13 --publish 127.0.0.1::5432 --env POSTGRES_USER=eatbid --env "POSTGRES_PASSWORD=$EatbidTask13Password" --env POSTGRES_DB=eatbid postgres:16-alpine
  if ($LASTEXITCODE -ne 0) { throw "Task 13 PostgreSQL start failed" }
  $EatbidTask13Created = $true

  $EatbidTask13Ready = $false
  1..30 | ForEach-Object {
    if ((docker exec $EatbidTask13Container pg_isready --username eatbid --dbname eatbid) -match 'accepting connections') {
      $EatbidTask13Ready = $true
      return
    }
    Start-Sleep -Seconds 1
  }
  if (-not $EatbidTask13Ready) { throw "Task 13 PostgreSQL did not become ready" }

  $EatbidTask13PortLine = docker port $EatbidTask13Container 5432/tcp
  $EatbidTask13Port = [int](($EatbidTask13PortLine -split ':')[-1])
  $env:DATABASE_URL = "postgresql://eatbid:$EatbidTask13Password@127.0.0.1:$EatbidTask13Port/eatbid"
  $env:EATBID_TASK13_DATABASE_URL = $env:DATABASE_URL

  pnpm --filter @eatbid/db build
  node packages/db/dist/migrate.js
  node packages/db/dist/migrate.js
  $LatestJournal = docker exec --env "PGPASSWORD=$EatbidTask13Password" $EatbidTask13Container psql --username eatbid --dbname eatbid --tuples-only --no-align --command "select name from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1"
  if ($LatestJournal.Trim() -ne '20260829002500_core_projection_lineage') {
    throw "Unexpected migration journal: $LatestJournal"
  }

  $EvidenceJson = uv run --project apps/dataplane python apps/dataplane/tests/integration/run_foundation_fixture.py
  if ($LASTEXITCODE -ne 0) { throw "Foundation fixture runner failed" }
  $Evidence = $EvidenceJson | ConvertFrom-Json
  if ($Evidence.capture_run_id -eq $Evidence.replay_run_id) { throw "Capture/replay identity split failed" }
  Write-Output $EvidenceJson

  $Sql = @'
select mode, status, expected_count, captured_count, published_count
from ingest.run where run_id = :'capture_run_id'::uuid;

select u.request_unit_id, u.source, u.endpoint, u.request_params,
       u.expected_count, u.observed_count, u.status,
       o.observation_id, o.content_sha256, b.object_key, b.byte_length
from ingest.request_unit u
join ingest.raw_observation o using (run_id, request_unit_id)
join ingest.raw_blob b using (content_sha256)
where u.run_id = :'capture_run_id'::uuid
  and o.observation_id = :'observation_id'::bigint;

select a.run_id, a.observation_id, a.parser_version, a.status,
       n.normalized_record_id, n.source_entity_id
from ingest.normalization_attempt a
join ingest.normalization_attempt_record e using (normalization_attempt_id)
join ingest.normalized_record n using (normalized_record_id)
where a.run_id in (:'capture_run_id'::uuid, :'replay_run_id'::uuid)
order by a.run_id, a.observation_id;

select p.publication_id, p.status, p.expected_count, p.normalized_count,
       p.published_count, p.canonical_fingerprint, pr.normalized_record_id
from ingest.publication p
join ingest.publication_record pr using (publication_id)
where p.publication_id in (
  :'capture_publication_id'::uuid, :'replay_publication_id'::uuid
)
order by p.publication_id;

select aa.auction_attempt_id, aa.source_system, aa.external_bid_id,
       ar.auction_revision_id, ar.normalized_record_id, ar.observation_id,
       ao.organization_id
from core.auction_attempt aa
join core.auction_revision ar using (auction_attempt_id)
join core.auction_organization ao using (auction_revision_id)
where aa.source_system = 'eat'
  and aa.external_bid_id = :'external_bid_id';

select s.namespace, v.code, r.code_value_id, r.role
from core.auction_revision_code_value r
join core.code_value v using (code_value_id)
join core.code_scheme s using (code_scheme_id)
join core.auction_revision ar using (auction_revision_id)
where ar.normalized_record_id = :'normalized_record_id'::bigint
order by s.namespace, v.code, r.role;
'@
  $Sql | docker exec --interactive --env "PGPASSWORD=$EatbidTask13Password" $EatbidTask13Container psql --username eatbid --dbname eatbid --set=ON_ERROR_STOP=1 --set="capture_run_id=$($Evidence.capture_run_id)" --set="capture_publication_id=$($Evidence.capture_publication_id)" --set="replay_run_id=$($Evidence.replay_run_id)" --set="replay_publication_id=$($Evidence.replay_publication_id)" --set="observation_id=$($Evidence.observation_id)" --set="normalized_record_id=$($Evidence.normalized_record_id)" --set="external_bid_id=$($Evidence.external_bid_id)"
  if ($LASTEXITCODE -ne 0) { throw "Read-only evidence SQL failed" }
}
finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:EATBID_TASK13_DATABASE_URL -ErrorAction SilentlyContinue
  if ($EatbidTask13Created) {
    if (-not $EatbidTask13Container.StartsWith('eatbid-task13-')) {
      throw "Refusing unexpected cleanup target"
    }
    $Owner = docker inspect --format '{{ index .Config.Labels "eatbid.test-owner" }}' $EatbidTask13Container
    if ($Owner -ne 'task13') { throw "Refusing container without Task 13 ownership label" }
    docker rm --force $EatbidTask13Container
  }
}
```

두 migration 호출과 journal은 `20260829002500_core_projection_lineage`를 가리켜야 한다.
capture/replay publication은 서로 다른 UUID와 같은 fingerprint를 가져야 하고, replay run에는 새
raw observation이 없어야 한다. SQL 값은 runner가 출력한 typed evidence를 `psql --set`으로
바인딩하며 문자열 보간으로 WHERE 절을 조립하지 않는다. `db:push`, 수기 DDL, 고정 port/volume은
사용하지 않는다.

## 3. 자동화된 fixture·failure 증거

pytest fixture는 자기 전용 DB를 만들고 종료하므로 위 수동 DB를 남겨 두지 않는다. 수동 SQL은
반드시 2절 runner가 채운 DB에 실행한다.

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_foundation_slice.py -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_capture.py::test_same_body_is_one_blob_and_two_append_only_observations -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_normalize_validate.py::test_quarantine_blocks_publication -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_normalize_validate.py::test_request_count_mismatch_fails_monotonically_and_preserves_existing_core_rows -q
```

이 증거는 동일 bytes의 content-address 재사용, quarantine/source-contract의 monotonic failure,
기존 active core 보존을 검사한다.

## 4. dormant product manifest 오프라인 렌더

```powershell
@'
import re
import subprocess
import yaml

completed = subprocess.run(["kubectl", "kustomize", "infra/product"], check=True, capture_output=True)
render = completed.stdout.decode("utf-8")
documents = [item for item in yaml.safe_load_all(render) if item]
assert not any(item.get("kind") == "CronJob" for item in documents)
cron_workflows = [item for item in documents if item.get("kind") == "CronWorkflow"]
assert len(cron_workflows) == 2
assert all(item["spec"]["suspend"] is True for item in cron_workflows)
assert "hostPath" not in render
assert re.search(r"postgres(?:ql)?://[^\s]+", render, re.IGNORECASE) is None
images = re.findall(r"ghcr\.io/lamyzm/eatbid-[^\s\"']+", render)
assert images and all("@sha256:" in image for image in images)
print("offline product render policy: PASS")
'@ | uv run --project apps/dataplane python -
```

렌더만 수행한다. `argo submit`, `kubectl apply`, `argocd app sync`, CronWorkflow resume는 금지다.

## 5. 외부 실행 금지선

- live eaT list/detail request: **NOT RUN — Task 14 approval gate**
- live R2 object write/read: **NOT RUN — Task 14 approval gate**
- dataplane image publish/sign: **NOT RUN — Task 14 approval gate**
- Argo Workflow submit/sync/resume: **NOT RUN — Task 14 approval gate**

현재 CLI는 production composition root가 아니며 placeholder exit 64다. Task 14와 사용자 승인 전에는
성공 실행 증거로 기록하지 않는다.
