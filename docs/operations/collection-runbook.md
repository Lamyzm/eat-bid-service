---
id: COLLECTION-RUNBOOK
status: active
canonical_for: collection-workflow-recovery-procedures
last_reviewed: 2026-09-18
review_trigger: workflow-template-stage-or-publication-lineage-change
---

# 수집 workflow 운영 runbook

`eatbid-dataplane` WorkflowTemplate의 단계 하나만 다시 돌려 실패한 실행을 복구하는 절차다. 권위는
[`docs/architecture/runtime-and-deployment.md`](../architecture/runtime-and-deployment.md) §2·§3과
[ADR 0015](../adr/0015-canonical-projection-lineage.md)다. 여기 있는 명령은 `kubectl get`·`psql` 읽기와
Workflow 생성뿐이며, 클러스터 manifest 변경(`kubectl apply/patch`)은 Argo CD가 `main`에서 한다.

## 1. 실패한 publication을 재캡처 없이 다시 발행하기 (2026-09-07, EAT-94)

`discover`·`capture`·`normalize`·`validate`가 끝난 뒤 `project` pod만 죽은 경우다. raw·정규화 행과
봉인된 publication manifest는 전부 남아 있고 publication은 `validated`에 머문다 — project transaction이
통째로 되돌아가고 실패 표시(`PROJECTION_CONTRACT`)는 결정적 계약 위반에만 남기 때문이다. 소스는 다시
부르지 않는다.

기본 경로는 §1.2 `replay-pipeline`이다. projector는 잠근 run의 `build_sha`와 다른 build를
`projector version differs from locked run`으로 거부하고 publication을 `failed`로 표시하므로(ADR 0015의
lineage 검사, 완화는 별도 결정), 수정된 새 이미지로 복구하는 한 실패한 publication 자체를 다시 project할
수 없다. 같은 raw를 새 build의 run으로 재정규화·검증·발행하는 것이 replay다. `entrypoint: project`(§1.3)는
run을 만든 이미지와 **같은 `BUILD_SHA`**일 때만 쓰는 부차 경로다.

### 1.1 전제 확인 (읽기 전용)

```sql
select p.status as publication_status, r.status as run_status, r.build_sha, r.parser_version,
       p.expected_count, p.normalized_count, p.published_count
from ingest.publication p
join ingest.run r using (run_id)
where p.publication_id = :'publication_id'::uuid;
```

- 두 status가 모두 `validated`이고 `expected_count = normalized_count`, `published_count = 0`이어야 한다.
  OOM으로 죽은 publication은 이 상태다. `failed`(PROJECTION_CONTRACT)면 원인이 데이터 계약이므로 이
  절차 전에 원인을 먼저 본다.
- source release는 `sealed`여야 한다(`validate`가 Succeeded했다면 이미 그렇다).
- `r.build_sha`를 다시 돌릴 이미지의 `BUILD_SHA`와 비교한다. 다르면 §1.2, 같으면 §1.3도 가능하다.

### 1.2 기본 경로 — `replay-pipeline`으로 새 run을 만들어 발행

대상 관측은 source release의 상세 관측 전체다. release에는 `discover`의 목록 페이지(`bid-list`)도
관측으로 들어 있으므로 endpoint로 거른다. 실패한 publication `fcc570bc…`의 release
`d3ae064e-4dff-53ce-af12-99ebec9ee3c4` 기준:

```sql
select json_agg(o.observation_id order by o.observation_id)
from ingest.source_release_observation so
join ingest.raw_observation o using (observation_id)
where so.source_release_id = 'd3ae064e-4dff-53ce-af12-99ebec9ee3c4' and o.endpoint = 'bid-detail';
```

결과 배열을 `observation-ids-json`에 넣되 **공백 없이 직렬화한다**(psql의 `json_agg`는 `, `로 잇는다 —
PowerShell이면 `ConvertTo-Json -Compress`). **크기 상한은 파라미터 값 하나가 128 KiB(131,072바이트) 미만**이다.
그보다 크면 Argo 컨트롤러가 파드 템플릿을 ConfigMap으로 내리려 하는데 컨트롤러 Role에 configmaps
`create`가 없어 Workflow가 파드를 띄우기도 전에 `Error`로 끝난다(2026-09-16 실측: 16,469건이 공백 포함
131,752바이트라 680바이트 넘겨 실패, run·publication 행은 남지 않음). 같은 값이 컨테이너 env 하나로도
들어가므로 Linux의 인자 문자열 상한(`MAX_ARG_STRLEN`, 128 KiB)과도 같은 선이다. etcd의 1.5 MiB 상한은
그보다 훨씬 뒤에 있어 실제로는 닿지 않는다.
한 release가 그보다 크면 관측 id 구간을 나눠 replay Workflow 여러 개로 내되(각 구간에 새 publication-id),
각 replay는 자기 run·publication을 따로 갖고 같은 canonical revision을 재사용하므로 발행 사실은 중복되지
않는다(ADR 0015). `eatbid-core-publication` mutex가 replay 단계를 직렬화하므로 동시에 내도 된다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: eatbid-replay-d3ae064e-
  namespace: eatbid
spec:
  workflowTemplateRef:
    name: eatbid-dataplane
  entrypoint: replay-pipeline
  arguments:
    parameters:
      - name: source-release-id
        value: d3ae064e-4dff-53ce-af12-99ebec9ee3c4
      # replay run·publication의 새 정체성이다. 실패한 publication id를 다시 쓰지 않는다.
      - name: publication-id
        value: <새 UUID v4>
      - name: observation-ids-json
        value: '[…위 SQL의 JSON 배열…]'
      # 네 시각은 오름차순이어야 하며 UTC로 적는다.
      - name: started-at
        value: "2026-09-07T03:00:00Z"
      - name: normalized-at
        value: "2026-09-07T03:00:01Z"
      - name: validated-at
        value: "2026-09-07T03:00:02Z"
      - name: activated-at
        value: "2026-09-07T03:00:03Z"
```

```powershell
kubectl create -n eatbid -f replay.yaml
kubectl get workflow -n eatbid --sort-by=.metadata.creationTimestamp
```

`replay-pipeline` DAG는 `replay` 뒤에 `marts`를 이어 활성 build까지 전환하므로 따로 부를 것이 없다.
`replay` pod는 `eatbid-core-publication` mutex를 잡고, 관측을 하나씩 R2에서 읽어 순차로 재정규화한다.
정규화 결과는 결정적이라 기존 `normalized_record`를 재사용하고, `project`는 batch 스트리밍이라 상주
메모리는 구성원 수에 비례하지 않는다.

Succeeded 뒤 확인(새 publication id로):

```sql
select p.status, p.expected_count, p.published_count, p.projector_version, p.canonical_fingerprint,
       (select count(*) from ingest.publication_record pr
         join core.auction_revision ar using (normalized_record_id)
        where pr.publication_id = p.publication_id) as projected_revisions
from ingest.publication p
where p.publication_id = :'publication_id'::uuid;
```

`status = 'published'`, `published_count = projected_revisions = expected_count`여야 한다.
`core.auction_attempt`는 이 release가 처음 관측한 공고 수만큼 늘어난다(같은 공고를 이미 다른 창이
발행했으면 attempt는 재사용되고 revision만 는다). 원래 publication `fcc570bc…`는 `validated`로 남는다 —
그 run의 build로는 다시 돌리지 않으므로 발행되지 않은 채 진단용으로 보존된다.

### 1.3 부차 경로 — 같은 `BUILD_SHA`일 때 `project`만 다시 돌리기

일시 장애(DB 연결 등)로 죽었고 이미지가 그대로일 때만 쓴다. WorkflowTemplate의 `project` template을
entrypoint로 직접 부른다. template의 `inputs.parameters`는 Workflow `spec.arguments.parameters`에서 같은
이름으로 채워지고, `mode`·`parser-version`·`calc-version`은 template 기본값을 받는다. mutex
`eatbid-core-publication`은 그대로 적용된다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: eatbid-reproject-fcc570bc-
  namespace: eatbid
spec:
  workflowTemplateRef:
    name: eatbid-dataplane
  entrypoint: project
  arguments:
    parameters:
      - name: source-release-id
        value: d3ae064e-4dff-53ce-af12-99ebec9ee3c4
      - name: detail-run-id
        value: 4d6cf15d-7949-5051-abe8-9857d3a2b308
      - name: publication-id
        value: fcc570bc-0301-575c-9164-d3980546d64e
```

세 값은 실패한 workflow의 `discover` task output parameter에서 그대로 옮긴다. discovery run이 아니라
**detail run** id다. Succeeded 뒤 §1.2의 확인 SQL을 이 publication id로 돌린다.

이어서 `marts`를 같은 세 값으로 부른다(`entrypoint: marts`, 파라미터 동일). mart의 `--as-of`는 이
Workflow의 `creationTimestamp`이고 활성 build 전환은 여기서 일어난다(ADR 0034). 두 Workflow를 하나로
묶지 않는 이유는 `workflowTemplateRef`를 쓰는 Workflow가 자기 template을 더할 수 없고 `scheduled-pipeline`
DAG는 `discover`부터 시작하기 때문이다.

## 2. 참가제한지역 라벨을 켜기 — `eat-v3` 기본값 전환과 replay (2026-09-07, EAT-75)

`eat-v3`는 `eat-v2`와 같은 응답을 같은 `auction.v2`로 정규화하되 `ds_areaList.PDLC_NM`을
`location.eligibilityAreas`에 실어 projector가 `core.code_label_observation`을 남기게 한다
([ADR 0038](../adr/0038-additive-ingestion-fields-and-parser-version.md)). 그 라벨이 있어야
`region_mapping`이 행안부 코드와의 `core.code_mapping` 행을 만든다(ADR 0035 결정 6). 순서가 중요하다 —
**템플릿 기본값을 이미지보다 먼저 올리면 옛 이미지가 모르는 version 이름을 받아 `unknown-parser-version`으로
멈춘다**(EAT-95).

### 2.1 순서

1. `eat-v3`를 아는 이미지를 릴리즈하고 Argo CD가 dataplane 이미지를 동기화한 것을 확인한다.
   ```powershell
   kubectl get workflowtemplate eatbid-dataplane -n eatbid -o jsonpath='{.spec.templates[?(@.name=="normalize")].container.image}'
   ```
2. 그 뒤 **별도 커밋**으로 `infra/base/workflows/workflow-template.yaml`의 `parser-version` 기본값을
   `eat-v3`로 올리고 `infra/tests/test_workflow_contract.py`의 기본값 assert를 같이 고친다. 이 커밋은
   EAT-75 branch에 넣지 않았다.
3. 다음 `poll-open`부터 새 관측이 라벨을 싣는다. 확인:
   ```sql
   select count(*) from core.code_label_observation o
   join core.code_value v using (code_value_id)
   join core.code_scheme s using (code_scheme_id)
   where s.namespace = 'eat:eligibility-area';
   ```

### 2.2 이미 발행된 revision의 라벨 — replay 한 번

매핑은 revision이 아니라 코드에 매달리므로 새 수집만으로도 관측된 코드부터 라벨이 쌓인다. 189종을 빨리
채우려면 §1.2의 `replay-pipeline`을 **`parser-version: eat-v3`**로 낸다. `eat-v2`로 replay하면 같은
`(observation, parser_version)` 키에 이미 봉인된 payload가 있어 재사용될 뿐 라벨은 생기지 않고, `eat-v2`
파서 자체는 바이트를 바꾸지 않으므로 비결정 오류도 나지 않는다.

```yaml
  arguments:
    parameters:
      - name: parser-version
        value: eat-v3
      # 나머지는 §1.2와 같다: source-release-id, 새 publication-id, observation-ids-json, 네 시각.
```

replay는 관측마다 새 `normalized_record`·새 `core.auction_revision`을 만들고 원래 eat-v2 발행물은
그대로 둔다(같은 attempt에 revision이 하나 늘어난다). 라벨 수집이 끝나면 `reference-pipeline`의 매핑
단계가 `core.code_mapping`을 채우고, 매핑률은 [`reference-data-coverage.md`](reference-data-coverage.md)
§3에 운영 실측으로 적는다. 그 값이 충분할 때 §4의 mart 전환(새 `calc_version`, `--region-scheme
mois:administrative-region`)을 한다.

## 3. 하지 않는 것

- 실패한 publication의 `status`나 run의 `build_sha`를 SQL로 고치지 않는다. 상태 전이는 CLI transaction만
  하고, `build_sha`를 바꾸면 그 run이 어느 코드로 관측·정규화됐는지의 lineage가 거짓이 된다.
- `project`를 여러 Workflow로 동시에 내지 않는다. mutex가 직렬화하지만 두 번째는 이미 `published`라
  `require_publication_corpus`에서 exit 64로 닫힌다.
- WorkflowTemplate에 `retryStrategy`를 더해 OOM을 재시도로 덮지 않는다. OOM은 `project` 메모리 한도가
  잡아 pod만 죽이며, 원인은 코드나 한도의 문제다(runtime-and-deployment §3).
- `fail-release`를 `onExit` 같은 자동 핸들러에 걸지 않는다. `planned`는 "아직 이어서 할 수 있음"의 정당한
  상태이고 자동으로 닫으면 §4.2의 재개가 막힌다. 포기는 사람이 §4.3으로 정한다.

## 4. capture·normalize 단계가 죽은 실행 복구 (2026-09-10, EAT-122)

`validate`에 이르지 못한 실행은 release가 `planned`로 남는다. 원본은 R2·`raw_observation`에 있고
아무것도 발행되지 않았으므로 데이터가 깨진 상태는 아니다. 무엇을 할지는 죽은 pod의 exit code가 정한다.

| 죽은 단계 | exit | 뜻 | 조치 |
|---|---|---|---|
| capture | 69 `TRANSIENT_NETWORK` | 응답 없음, pod 안 재시도 소진 | §4.2 `argo retry` |
| capture | 75 `SOURCE_THROTTLED` | 차단 징후 | 원인 확인 뒤 §4.2, 반복되면 §4.3 |
| discover·capture | 76 `SOURCE_CONTRACT`, 64 `CONFIGURATION` | 계약 위반·설정 오류 | 코드·설정 수정 뒤 새 backfill, 옛 release는 §4.3 |
| capture·normalize | 137 OOM, 143 중단 | 결론 없이 끝남. release는 아직 `planned` | 같은 이미지면 §4.2, 아니면 §4.3 `INTERRUPTED` |
| validate | 65 `DATA_QUARANTINED` | 격리가 있어 발행 불가. release는 **sealed**, publication은 failed | 파서 수정 뒤 §1.2 replay |
| project | 137 OOM, 143 중단 | 결론 없이 끝남. release는 이미 **sealed**라 `fail-release` 대상이 아니다 | §1(replay 또는 같은 이미지의 project 재실행) |

### 4.1 전제 확인 (읽기 전용)

```sql
select sr.release_name, sr.status, r.mode, r.status as run_status, r.failure_category,
       (select count(*) from ingest.request_unit u
         where u.run_id = r.run_id and u.endpoint = 'bid-detail' and u.status = 'captured') as captured,
       (select count(*) from ingest.request_unit u
         where u.run_id = r.run_id and u.endpoint = 'bid-detail') as planned_units
from ingest.source_release sr
join ingest.source_release_run srr using (source_release_id)
join ingest.run r using (run_id)
where sr.status = 'planned'
order by sr.as_of;
```

- `planned` release마다 discovery run(`validated`)과 detail run(`running`)이 하나씩이다.
  `captured < planned_units`면 capture가 덜 끝난 것이다.
- 살아 있는 workflow가 있는지는 `kubectl get workflow -n eatbid --sort-by=.metadata.creationTimestamp`의
  Running 항목과 `release_name`의 시각을 대조한다. 실행 중인 release는 건드리지 않는다.
- 죽은 pod와 exit code는 `kubectl get pods -n eatbid --field-selector=status.phase=Failed`의
  `.status.containerStatuses[0].state.terminated.exitCode`로 읽는다.

### 4.2 같은 이미지에서 실패한 chunk만 다시 돌리기 — `argo retry`

`argo retry`는 Failed·Error 노드와 그 하류만 다시 만들고 Succeeded 노드의 출력은 그대로 쓴다.
`capture`는 같은 run에서 이미 `captured`인 unit을 소스에 다시 묻지 않으므로 다시 도는 chunk도 못 받은
건만 부른다. `argo` CLI가 없으면 controller와 같은 계열의 release를 받는다. `kubectl`만으로는 노드
재실행을 할 수 없다.

```powershell
argo retry -n eatbid <workflow-name>
```

- 실패한 workflow의 dataplane 이미지 digest가 지금 WorkflowTemplate의 것과 **같을 때만** 쓴다. run의
  `build_sha`와 다른 이미지로 이어 가면 `project`가 lineage 검사에서 거부한다(ADR 0015). 다르면 새
  backfill을 낸다.
- Succeeded 뒤 §4.1 SQL에서 `captured = planned_units`, release `sealed`를 확인한다.

### 4.3 이어 갈 수 없는 release를 닫기 — `fail-release`

이미지가 바뀌었거나 원인이 코드·소스 계약이라 같은 run으로 이어 갈 수 없을 때, 운영자가 release를
`failed`로 닫고 `running` run을 같은 category로 끝낸다. 상태 전이는 CLI transaction만 한다(§3).
category는 죽은 pod의 exit code를 그대로 옮기고, OOM·중단처럼 exit 어휘가 없는 종료는 `INTERRUPTED`다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: eatbid-fail-release-
  namespace: eatbid
spec:
  workflowTemplateRef:
    name: eatbid-dataplane
  entrypoint: fail-release
  arguments:
    parameters:
      - name: source-release-id
        value: <planned release id>
      # TRANSIENT_NETWORK · SOURCE_THROTTLED · SOURCE_CONTRACT · DATA_QUARANTINED · CONFIGURATION · INTERRUPTED
      - name: failure-category
        value: TRANSIENT_NETWORK
```

```powershell
kubectl create -n eatbid -f fail-release.yaml
```

Succeeded 뒤:

```sql
select sr.status, sr.failure_category, r.mode, r.status as run_status, r.failure_category as run_category
from ingest.source_release sr
join ingest.source_release_run srr using (source_release_id)
join ingest.run r using (run_id)
where sr.source_release_id = :'source_release_id'::uuid;
```

release는 `failed`, detail run은 같은 category의 `failed`, discovery run은 `validated` 그대로여야 한다.
같은 category로 다시 내면 멱등하게 같은 결과를 돌려주고, 다른 category나 이미 `sealed`인 release는
거부된다. 닫은 release의 창은 새 backfill로 다시 낸다.

### 4.3.1 봉인 뒤 멎은 run 닫기 — `close-stalled-run`

`fail-release`는 `planned` release만 닫는다. capture까지 성공해 release가 **봉인된 뒤** 프로세스가
사라지면 그 run은 어느 경로로도 닫히지 않고 `running`으로 남아 `backfill-progress` 위반이 영원히 열려
있다. 2026-09-19에 그런 run이 넷이었다.

**넷의 이유가 서로 달랐다는 것이 이 절차의 전제다.**

| 무엇이 남았나 | 참인 것 | `--outcome` |
| -- | -- | -- |
| 닫는 코드가 없던 시절의 코드목록 run | 투영은 실제로 끝났다 | `published` |
| 운영자가 workflow를 멈춰 생긴 run | 일이 끝나지 않았다 | `failed` + `INTERRUPTED` |
| 사람 승인을 기다리는 참조 파일 run | 아직 살아 있는 결정이다(ADR 0035) | **닫지 않는다** |

한 규칙으로 뭉쳐 닫으면 셋 중 둘에 거짓을 적는다. 무엇이 참인지 **확인한 사람이** `--outcome`으로
말한다. 확인 없이 부르지 않는다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: eatbid-close-stalled-run-
  namespace: eatbid
spec:
  workflowTemplateRef:
    name: eatbid-dataplane
  entrypoint: close-stalled-run
  arguments:
    parameters:
      - name: run-id
        value: <ingest.run의 run_id>
      # published | failed
      - name: outcome
        value: failed
      # failed일 때만 적는다. published에 적으면 거부된다.
      - name: failure-category
        value: INTERRUPTED
```

닫기 전에 무엇이 참인지 본다. 투영 결과가 실제로 들어갔는지는 그 lane이 만드는 행을 세어 확인한다.

```sql
select r.run_id, r.mode, r.started_at, max(o.fetched_at) as last_observation_at
from ingest.run r left join ingest.raw_observation o using (run_id)
where r.status = 'running'
group by r.run_id, r.mode, r.started_at
order by r.started_at;
```

명령은 **닫는 순간 전진을 한 번 더 본다.** 기대와 같은 90분 기준이며, 그 사이에 되살아난 run은 거부된다.
이미 닫힌 run도 거부된다. 둘 다 사람이 옛 목록을 보고 산 실행을 죽이는 것을 막는 자리다.

### 4.3.2 도는 workflow를 멈출 때 — 멈추는 것도 상태를 바꾸는 일이다

사고 중에 자원을 되찾으려고 도는 workflow를 멈추는 일이 있다. **그 조치 자체가 교착을 만든다.**

2026-09-19에 외부 사용자가 화면을 못 보자 도는 backfill을 `shutdown: Stop`으로 멈췄다. 그 workflow가
`eatbid-source-backfill` 자리 넷을 **붙잡은 채** 끝났고, 다음 회차가 **21시간** 대기만 했다. 아무도
몰랐다 — 대기는 실패가 아니라서 어떤 기대도 울리지 않는다.

덧붙여 그 조치는 **원인도 아니었다.** 3초 시간 초과의 원인은 `shared_buffers` 128MB였다. 즉 효과 없는
조치가 더 큰 정지를 만들었다.

**멈추기 전에.** 그것이 정말 원인인지 먼저 잰다. 급하다고 추측으로 상태를 바꾸면 고치지 못한 채 새
문제만 더한다.

**멈춘 뒤에 반드시.** 자물쇠가 풀렸는지 그 자리에서 확인한다.

```powershell
kubectl -n eatbid get wf <stopped-workflow> -o jsonpath='{.status.synchronization}'
kubectl -n eatbid get wf <waiting-workflow> -o jsonpath='{.status.synchronization}'
```

멈춘 workflow의 노드 id가 다른 workflow의 `waiting.holders`에 남아 있으면 교착이다. 그때는 §4.4로 푼다.
`shutdown: Stop`은 workflow를 끝내지만 controller의 자물쇠 기억까지 지우지는 않는다.

### 4.4 재부팅·컨트롤러 재시작이 남긴 semaphore 교착 풀기 (2026-09-10, EAT-129)

노드 재부팅이나 controller 재시작이 capture 파드를 죽이면, 죽은 노드가 source semaphore 보유자로 남아
이후 모든 수집이 대기한다. Argo controller는 시작할 때 각 Workflow의 `status.synchronization.holding`에서
보유자를 다시 읽으므로 controller를 다시 재시작해도 같은 보유자가 복원되어 스스로는 풀리지 않는다.

**증상.** `kubectl get wf`는 Running인데 실행 중인 수집 파드가 하나도 없고, 모든 capture 노드가
`Waiting for eatbid/ConfigMap/eatbid-workflow-limits/eatbid-source-limit lock. Lock status: 0/1`이다.

`powershell
kubectl -n eatbid get wf <workflow-name> -o jsonpath='{.status.synchronization}'
`

`holding`의 보유자 노드 id가 이미 Failed인 노드면 교착이다. 같은 id가 `waiting`에도 함께 있으면 확실하다.

**1단계 — 자물쇠를 쥔 workflow를 종료한다.** 그 run은 이미 capture 하나가 영구 실패라 발행에 이르지 못한다.
원본은 R2와 `ingest.raw_observation`에 남고 열린 공고는 다음 회차가 다시 발견하므로 잃는 것이 없다.
JSON 인용이 shell마다 깨지므로 patch는 파일로 넘긴다.

`powershell
'{"spec":{"shutdown":"Terminate"}}' | Set-Content -NoNewline shutdown.json
kubectl -n eatbid patch wf <workflow-name> --type merge --patch (Get-Content shutdown.json -Raw)
`

controller 로그에 `Lock released … availableLocks=1`이 찍히면 풀린 것이다.

**2단계 — 대기하던 workflow를 깨운다.** 자물쇠가 풀려도 대기 중이던 workflow는 스스로 다시 시도하지 않고
controller가 그 workflow를 처리하지도 않는다. annotation을 덮어써 재조정을 유도한다.

`powershell
kubectl -n eatbid annotate wf <waiting-workflow> "eatbid.dev/nudge=$(Get-Date -Format o)" --overwrite
`

Pending이던 노드가 Running으로 바뀌고 파드가 뜨는지 확인한다. 남은 `planned` release는 §4.1로 확인하고
§4.2 또는 §4.3으로 정리한다.

**2단계로 안 풀리면 — 자물쇠 주인을 지우고 controller를 재시작한다 (2026-09-20 실측).**

위 두 단계는 자물쇠를 쥔 workflow가 **살아 있을 때**의 절차다. 이미 `Failed`로 끝난 workflow가 자물쇠를
쥐고 있으면 `shutdown`을 더 걸 것이 없고 annotate로도 안 깨어난다. controller가 시작할 때 각 Workflow의
`status.synchronization.holding`에서 보유자를 복원하므로 재시작만으로도 같은 보유자가 돌아온다.

그래서 **읽을 대상 자체를 없앤 뒤** 재시작한다. 순서가 거꾸로면 효과가 없다.

```powershell
kubectl -n eatbid delete wf <자물쇠를 쥔 끝난 workflow>
kubectl -n eatbid rollout restart deployment/argo-workflows-workflow-controller
kubectl -n eatbid rollout status deployment/argo-workflows-workflow-controller
```

지우기 전에 잃을 것이 없는지 본다. 그 workflow의 관측은 R2와 `ingest.raw_observation`에 남고, 창의 진도는
`ingest.backfill_coverage`가 따로 말한다. 지워지는 것은 Workflow 객체와 그 파드뿐이다.

재시작 뒤 대기하던 workflow의 `status.synchronization`에 `holding`이 생기고 파드가 뜨면 풀린 것이다.
### 4.5 발행이 실패한 창은 전진이 건너뛴다 — `failed-publication-window` (2026-09-16, EAT-235, ADR 0053)

`validate`가 `DATA_QUARANTINED`(65)로 끝나면 release는 sealed, publication은 failed다. 같은 창을 다시 받아도
같은 원본이 같은 자리에서 다시 격리되므로(2026-03 창이 매시 16,469건을 두 번 다시 받았다) 전진 CronWorkflow는
`ingest.backfill_coverage.failed_publications > 0`인 창을 고르지 않는다. 대신 `check-expectations`가
`failed-publication-window` 위반을 창마다 하나씩 열어 두고, 그 위반은 replay가 성공해 창이 완결될 때까지 닫히지
않는다. 대상은 전진이 보는 달 전체 창뿐이며 poll-open의 하루 창은 보지 않는다(EAT-240). 할 일은 재수집이 아니다:

1. 격리 사유를 본다(읽기 전용). `select quarantine_reason, count(*) from ingest.normalization_attempt where run_id = '<detail run>' and status = 'quarantined' group by 1`.
2. 사유가 계약 쪽이면 파서·계약을 고치고 릴리스한다. 원본이 정말 계약 밖이면 그 관측은 격리로 남는 것이 맞고,
   그때는 창을 어떻게 닫을지 별도 결정이다(부분 발행은 하지 않는다).
3. 새 이미지가 배포된 뒤 §1.2 `replay-pipeline`으로 그 release를 다시 발행한다. revision이 생기면 view의
   `is_complete`가 참이 되어 위반이 해소되고 전진은 다음 창으로 간다
### 4.6 소스가 우리를 막으면 보류가 정시 실행을 멈춘다 — `source-hold` (2026-09-16, EAT-244, ADR 0055)

`capture`가 403·429를 보면 run은 `SOURCE_THROTTLED`(75)로 닫히고 **같은 자리에서 `ingest.source_hold`에 보류가
적힌다**. 길이는 지난 24시간의 보류 수로 15분 → 30분 → 60분 → … → 24시간이다. 보류가 열려 있는 동안:

- 전진 CronWorkflow의 `decide`는 `has-window=false`를 내고 `run`을 건너뛴다. Workflow는 성공으로 끝난다.
- poll-open·daily-reconcile의 `discover`는 소스를 부르기 전에 exit 75로 끝난다. run·release는 만들지 않는다.
  Workflow는 실패로 남고 `cron-workflow:eatbid-poll-open` 위반이 critical로 열린다.
- `source-hold` 기대(critical)가 보류 자체를 위반으로 든다. 풀리면 해소된다.

할 일은 재시도가 아니다:

1. 보류를 읽는다(읽기 전용). `select hold_id, detail, held_at, release_after from ingest.source_hold where released_at is null order by held_at desc limit 5`.
2. `detail`의 응답 코드와 `held_by_run_id`로 그 run의 관측(`ingest.raw_observation`)을 보고 소스가 무엇을 돌려줬는지 R2 raw로 확인한다.
3. 소스 정책 위반이 우리 쪽 요청량이면 세마포어·페이지 크기·주기를 고쳐 릴리스한다. 보류는 시각이 지나면 스스로 풀린다 —
   손으로 `released_at`을 쓰지 않는다(수동 운영 쓰기 금지). 급하면 그것이 곧 "사람이 푸는 Workflow 진입점"이 필요하다는 뜻이고 별도 결정이다.
4. 사람이 부르는 `backfill-pipeline`·`replay-pipeline`은 보류를 보지 않는다. replay는 소스를 부르지 않으므로 보류 중에도 안전하다.

### 4.7 계약 빈틈을 한 번에 모으기 — `contract-scan` (2026-09-16, EAT-251)

같은 부류의 격리(음수 사정률, 음수 투찰금액)가 달마다 하나씩 나오면 달마다 ADR·릴리스·replay를 반복한다. 이미
R2에 있는 raw에 지금 파서를 한 번 돌리면 남은 빈틈을 미리 모을 수 있다. 소스 호출 0회, DB 쓰기 0회다.

```powershell
argo submit --from workflowtemplate/eatbid-dataplane -n eatbid --entrypoint contract-scan `
  -p parser-version=eat-v3 -p limit=20000 -p window-start=20250901 -p window-end=20250930
```

- `window-start`·`window-end`를 비우면 발행에 이르지 못한 상세 관측 전부(정규화 안 됨·격리·revision 없음)를
  `limit`까지 본다. 창을 주면 그 창의 release에 속한 관측만 본다.
- 결과는 workflow output parameter `scanned`·`quarantined`·`reasons`(사유별 건수와 예시 공고 id 다섯)와
  stdout이다. `ingest.normalization_attempt`에는 남지 않는다 — 실제 정규화 시도가 아니다.
- 읽는 법: `reasons`의 한 줄이 곧 `quarantine_reason` 한 부류다. 계약 쪽이면 그 부류들을 하나의 ADR·릴리스로
  묶어 고치고, 그 뒤 실패 창들을 §1.2 replay로 닫는다. 소스가 정말 계약 밖이면 격리가 맞고 창을 어떻게 닫을지는
  별도 결정이다.
- 검증: 2025-09 창(EAT-246)에 돌리면 음수 사정률 7건과 `EFT_ALL_AMT` 음수 1건이 그대로 나와야 한다.
.
### 4.9 막힌 창은 예약이 스스로 다시 시도한다 — `replay-advance` (2026-09-18, EAT-274)

발행이 실패한 창을 사람이 창마다 닫던 것을 기계로 옮겼다. 2026-09-17에 세 창(2025-03·04·09, 51,597건)을
손으로 닫으면서 절차가 확립됐고, 백필이 2021-09까지 내려가는 동안 같은 일이 계속 생긴다.

- 네 시간마다 25분에 `eatbid-replay-advance`가 돈다. 다시 시도할 창이 없으면 아무것도 하지 않고 성공한다.
- **고르는 규칙은 하나다.** 실패한 publication을 만든 `build_sha`가 지금 이미지의 것과 다를 때만 고른다.
  같은 이미지로 다시 돌리면 결과가 같으므로 무한 반복이 생기지 않는다. 바꿔 말해 **파서나 계약을 고쳐
  배포하는 것이 곧 "이 창을 다시 시도한다"는 승인**이다. 손으로 제출할 일이 없다.
- 이미 발행에 성공한 release는 후보에서 빠진다. 한 창이 여러 번 실패한 뒤 성공했다면 그 창은 닫힌 것이고
  실패 기록은 진단용으로 남는다.
- `replay`에 관측 id를 주지 않으면 그 release의 상세 관측 전부가 대상이다. 예약 경로가 그렇게 부른다.
  사람이 부분 재처리를 할 때만 `--observation-id`를 준다(§1.2).

계약을 고쳐 배포했는데도 같은 창이 계속 실패하면 원인이 그 계약이 아니다. §4.7 `contract-scan`으로 사유를
모으고 남은 부류를 본다.

### 4.8 물린 mart build의 행 회수 — `reap-marts` (2026-09-17, EAT-254)

mart는 발행마다 새 build로 통째 다시 만들고 이전 활성 build를 `superseded`로 물린다(ADR 0034). 물린 build의
행은 `retain_until`(회차 요약·낙찰률 분포 1일, 열린 공고 스냅샷 7일)까지만 필요하다. 2026-09-16 실측은 build
901개 중 활성 3개, 만료 629개, mart 20GB였다.

- 매일 04:30 KST `eatbid-mart-reap` CronWorkflow가 `reap-marts`를 부른다. 시한이 지난 superseded build의 mart
  행과 보유율 행을 build마다 한 transaction으로 지우고 원장 `mart.build` 행은 계보로 남긴다. 어떤 수집 DAG에도
  들지 않고 mutex도 잡지 않는다.
- 결과는 workflow output parameter `reaped-builds`·`deleted-rows`와 stdout이다. 같은 날 다시 불러도 이미 행이
  없는 build는 보고에 실리지 않는다.
- 회수가 하루 넘게 밀리면 기대 `mart-reap-lag`이 연다. cron 회차가 죽었거나 suspend됐는지를 본다.
- 손으로 부를 때:

  ```powershell
  argo submit --from workflowtemplate/eatbid-dataplane -n eatbid --entrypoint reap-marts
  ```

- 지운 행의 디스크는 PostgreSQL 안에서 재사용된다(autovacuum). 파일 크기를 줄여 OS에 돌려주는 것은 `VACUUM FULL`
  이고 그동안 그 표를 잠그므로 별도 결정이다 — 이 절차는 그것을 하지 않는다.

### 4.9 품목 라벨에 어휘 밖 낱말이 나타났다 — `item-vocabulary-gap` (2026-09-17, EAT-255)

품목 원자 어휘(`eatbid:auction-item`, 원자 8개)는 2026-09-16 전수 실측에서 라벨 조각 90,906개를 빠짐없이 덮었다.
그래도 빌더는 어휘 밖 조각을 **조용히 버리지 않는다** — 다리표(`open_auction_snapshot_item`)에 행을 만들지 않는
대신 `mart.build_vocabulary_gap`에 조각과 행 수를 build마다 남기고, `check-expectations`가 활성 스냅샷 build에 그
행이 있으면 조각마다 위반 하나를 연다. 위반이 열린 동안 그 행들은 화면에서 `품목 미상`으로 보이고 품목 필터에 안
걸린다. 할 일:

1. 조각을 본다(읽기 전용). `select fragment, row_count from mart.build_vocabulary_gap gap join mart.build b using (build_id) where b.status = 'active' and b.mart_name in ('open_auction_snapshot', 'org_round_summary')`. 스냅샷과 회차 요약이 같은 규칙으로 다리표를 채우므로 둘 다 본다(EAT-256).
2. 원천이 새 원자를 보내기 시작한 것이면 `packages/db/src/seeds/auction-items.ts`와 `packages/contracts/src/values/auction-item.ts`,
   `apps/dataplane/src/eatbid/source/eat/code_schemes.py`의 목록을 함께 늘린다(셋이 같은 여덟을 읽는지 단위 시험이 고정한다).
   묶음 이름(`축산`)이나 오타처럼 원자가 아닌 것은 어휘에 넣지 않는다 — 그 판단은 설계 문서 §4.6(제목 추정) 층의 일이다.
3. 시드가 든 이미지가 배포되면 다음 build부터 다리 행이 생기고 격리 행이 사라져 위반이 닫힌다. 재수집·replay는 필요 없다
   (원본 라벨은 `item_label`에 그대로 있다).

