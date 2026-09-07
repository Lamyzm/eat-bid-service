---
id: COLLECTION-RUNBOOK
status: active
canonical_for: collection-workflow-recovery-procedures
last_reviewed: 2026-09-07
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

결과 배열을 `observation-ids-json`에 그대로 넣는다. **크기 상한에 주의한다.** Argo는 Workflow 객체를
etcd에 두고 1.5 MiB를 넘으면 status 갱신을 거부한다. 파라미터는 `spec.arguments`와 replay task의
`inputs`, node status에 몇 번 복사되므로 16,410건(약 130 KB)은 들어가지만 그 열 배는 들어가지 않는다.
한 release가 그보다 크면 관측 id 구간을 나눠 replay Workflow 여러 개로 내되, 각 replay는 자기 run·
publication을 따로 갖고 같은 canonical revision을 재사용하므로 발행 사실은 중복되지 않는다(ADR 0015).

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
2. 그 뒤 **별도 커밋**으로 `infra/product/workflows/workflow-template.yaml`의 `parser-version` 기본값을
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
