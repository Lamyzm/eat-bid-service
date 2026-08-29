# Data foundation fixture·replay runbook

이 runbook은 Task 13의 **오프라인 fixture capability**만 검증한다. PowerShell 7에서
`F:\Project\eat-bid-service\.worktrees\data-foundation`을 현재 디렉터리로 두고 실행한다.
`eatbid-pg`, `127.0.0.1:8081`, live eaT/R2/Argo에는 접근하지 않는다.

## 1. frozen dependency 확인

```powershell
git rev-parse --show-toplevel
git branch --show-current
pnpm install --frozen-lockfile
uv sync --project apps/dataplane --frozen
pnpm --filter @eatbid/db build
```

첫 두 명령은 각각 이 worktree의 절대 경로와 `feat/data-foundation`을 출력해야 한다. dependency
명령이 lockfile 변경을 요구하면 진행하지 말고 drift로 처리한다.

## 2. 수동 migration 점검용 PostgreSQL 16 시작

고정 포트·volume을 사용하지 않는다. 아래 세 변수는 이 PowerShell 세션에서만 유지한다.

```powershell
$EatbidTask13Container = "eatbid-task13-$([Guid]::NewGuid().ToString('N'))"
$EatbidTask13Password = [Guid]::NewGuid().ToString('N')
docker run --detach --name $EatbidTask13Container --label eatbid.test-owner=task13 --publish 127.0.0.1::5432 --env POSTGRES_USER=eatbid --env "POSTGRES_PASSWORD=$EatbidTask13Password" --env POSTGRES_DB=eatbid postgres:16-alpine

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
```

container 이름은 매번 고유하고 host port는 Docker가 배정한다. `eatbid-pg`나 공유 volume을
대상으로 삼지 않는다.

## 3. committed migration을 두 번 적용하고 journal 확인

```powershell
pnpm --filter @eatbid/db build
node packages/db/dist/migrate.js
node packages/db/dist/migrate.js

docker exec --env "PGPASSWORD=$EatbidTask13Password" $EatbidTask13Container psql --username eatbid --dbname eatbid --tuples-only --no-align --command "select name from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1"
```

두 migration 실행 모두 `Applied migration 20260829002500_core_projection_lineage`를 출력하고,
journal query도 정확히 `20260829002500_core_projection_lineage`를 반환해야 한다. `db:push`, 수기
DDL, `schema.sql`은 사용하지 않는다.

## 4. fixture capture→publication→core와 replay 실행

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_foundation_slice.py::test_raw_to_core_and_replay_foundation_slice -q
```

이 테스트는 별도의 `eatbid-foundation-<uuid>` PostgreSQL 16 container를 만들고 종료 시 제거한다.
`MemoryRawObjectStore`와 fake `SourceClient`는 transport만 대체하며, production
`run_foundation_slice`, parser, validation, replay, projector와 실제 psycopg repository를 호출한다.

테스트가 다음 read-only SQL 범위를 직접 검사한다. 수동 진단에서는 **Task 13이 소유한 disposable
DB에만** 같은 query를 실행하고, `capture_run_id`, `publication_id`, `observation_id`는 실행 결과의
typed ID를 parameter로 전달한다.

```sql
select mode, status, expected_count, captured_count, published_count
from ingest.run where run_id = :'capture_run_id';

select u.request_unit_id, u.source, u.endpoint, u.request_params,
       u.expected_count, u.observed_count, u.status,
       o.observation_id, o.content_sha256, b.object_key, b.byte_length
from ingest.request_unit u
join ingest.raw_observation o using (run_id, request_unit_id)
join ingest.raw_blob b using (content_sha256)
where u.run_id = :'capture_run_id';

select a.run_id, a.observation_id, a.parser_version, a.status,
       n.normalized_record_id, n.source_entity_id
from ingest.normalization_attempt a
join ingest.normalization_attempt_record e using (normalization_attempt_id)
join ingest.normalized_record n using (normalized_record_id)
where a.run_id in (:'capture_run_id', :'replay_run_id')
order by a.run_id, a.observation_id;

select p.publication_id, p.status, p.expected_count, p.normalized_count,
       p.published_count, p.canonical_fingerprint, pr.normalized_record_id
from ingest.publication p
join ingest.publication_record pr using (publication_id)
where p.publication_id in (:'capture_publication_id', :'replay_publication_id')
order by p.publication_id;

select aa.auction_attempt_id, aa.source_system, aa.external_bid_id,
       ar.auction_revision_id, ar.normalized_record_id, ar.observation_id,
       ao.organization_id
from core.auction_attempt aa
join core.auction_revision ar using (auction_attempt_id)
join core.auction_organization ao using (auction_revision_id)
where aa.source_system = 'eat' and aa.external_bid_id = :'external_bid_id';

select s.namespace, v.code, r.code_value_id, r.role
from core.auction_revision_code_value r
join core.code_value v using (code_value_id)
join core.code_scheme s using (code_scheme_id)
join core.auction_revision ar using (auction_revision_id)
where ar.normalized_record_id = :'normalized_record_id'
order by s.namespace, v.code, r.role;
```

capture와 replay publication은 서로 다른 UUID여야 하고, 두 attempt edge는 같은
`normalized_record_id`를 가리켜야 한다. replay run에는 새 `raw_observation`이 없어야 하며 두
publication의 `canonical_fingerprint`가 같아야 한다.

동일 bytes가 raw content address 하나와 observation 여러 개를 만드는 별도 행동 증거:

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_capture.py::test_same_body_is_one_blob_and_two_append_only_observations -q
```

## 5. quarantine/source-contract 실패와 기존 core 보존 확인

```powershell
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_foundation_slice.py::test_foundation_stops_on_source_contract_before_projection -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_normalize_validate.py::test_quarantine_blocks_publication -q
uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_normalize_validate.py::test_request_count_mismatch_fails_monotonically_and_preserves_existing_core_rows -q
```

세 테스트는 실패 run/publication이 `failed`가 되고 canonical write가 생기지 않으며, 먼저 존재하던
core 행이 유지되는 것을 검사한다. rollback으로 증거를 지우거나 failed publication을 다시 활성화하지
않는다.

## 6. dormant product manifest를 오프라인 렌더

```powershell
@'
import re
import subprocess

import yaml

completed = subprocess.run(
    ["kubectl", "kustomize", "infra/product"],
    check=True,
    capture_output=True,
)
render = completed.stdout.decode("utf-8")
documents = [item for item in yaml.safe_load_all(render) if item]
assert not any(item.get("kind") == "CronJob" for item in documents)
cron_workflows = [item for item in documents if item.get("kind") == "CronWorkflow"]
assert len(cron_workflows) == 2
assert all(item["spec"]["suspend"] is True for item in cron_workflows)
assert "hostPath" not in render
assert re.search(r"postgres(?:ql)?://[^\s]+", render, re.IGNORECASE) is None
product_images = [
    value
    for item in documents
    for value in re.findall(r"ghcr\.io/lamyzm/eatbid-[^\s\"']+", yaml.safe_dump(item))
]
assert product_images
assert all("@sha256:" in value for value in product_images)
print("offline product render policy: PASS")
'@ | uv run --project apps/dataplane python -
```

이 명령은 manifest를 렌더할 뿐 cluster에 제출·sync하지 않는다. `argo submit`, `kubectl apply`,
`argocd app sync`, CronWorkflow resume는 이 runbook의 명령이 아니다.

## 7. 정확한 cleanup

```powershell
if (-not $EatbidTask13Container.StartsWith('eatbid-task13-')) { throw "Refusing unexpected cleanup target" }
$EatbidTask13Owner = docker inspect --format '{{ index .Config.Labels "eatbid.test-owner" }}' $EatbidTask13Container
if ($EatbidTask13Owner -ne 'task13') { throw "Refusing container without Task 13 ownership label" }
docker rm --force $EatbidTask13Container
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

삭제 대상은 이 세션에서 생성한 이름 하나뿐이며 volume은 만들지 않았다. 제거한 container는 복구할
데이터를 소유하지 않는 disposable test resource다.

## 8. 외부 실행 금지선

- live eaT list/detail request: **NOT RUN — Task 14 approval gate**
- live R2 object write/read: **NOT RUN — Task 14 approval gate**
- dataplane image publish/sign: **NOT RUN — Task 14 approval gate**
- Argo Workflow submit/sync/resume: **NOT RUN — Task 14 approval gate**

현재 `eatbid discover|capture|normalize|validate|project|replay` CLI는 production composition root가
아니며 placeholder exit 64다. Task 14와 사용자 승인이 끝나기 전에는 이를 성공 실행 증거로 기록하지
않는다.
