# R0 Infisical delivery와 live canary Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** Infisical을 runtime secret value SSOT로 연결하고 schedule이 중지된 manual Argo canary에서 실제 raw release evidence를 만든다.

**Architecture:** External Secrets Operator의 Infisical Kubernetes Auth `SecretStore`가 explicit `ExternalSecret.spec.data`를 native Secret으로 단방향 전달한다. 동일 `source_release_id`를 모든 pipeline stage에 전달하고 page budget 1 canary와 deterministic replay가 통과할 때까지 CronWorkflow는 suspended 상태를 유지한다.

**Tech Stack:** Node 24.20.0, Python 3.12, Infisical Machine Identity, External Secrets Operator v1 API, Kubernetes, Argo Workflows, R2, PostgreSQL 16

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **Linear:** EAT-19 (parent EAT-14)

## Global Constraints

- `docs/superpowers/plans/2026-09-01-main-authority-migration.md`와 `docs/superpowers/plans/2026-09-01-r0-source-release-and-offline.md`가 선행한다.
- Node/pnpm 명령은 `fnm exec --using=24.20.0`으로 실행한다.
- Infisical은 secret value SSOT이며 Git에는 Secret value, machine token, client secret을 넣지 않는다.
- `PushSecret`, `dataFrom`, Universal Auth 장기 client secret과 Infisical Operator를 병존시키지 않는다.
- live eaT/R2/PostgreSQL/Kubernetes mutation 직전에 exact 대상과 page budget을 출력하고 별도 사용자 승인을 받는다.
- canary 실패를 full backfill로 우회하지 않고 모든 CronWorkflow의 `spec.suspend: true`를 유지한다.
- 테스트 이름·주석·문서·커밋은 한국어로 작성하고 300줄 초과 파일은 책임별로 분리한다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `infra/product/secrets` | Infisical Kubernetes Auth store와 explicit DB/R2 mapping |
| `infra/product/workflows/workflow-template.yaml` | release ID/as-of/page budget manual DAG |
| `infra/tests/test_workflow_contract.py` | secret value 부재·ESO·suspend·parameter 회귀 gate |
| `docs/operations/r0-live-canary.md` | 승인·실행·중단·evidence query runbook |
| `docs/operations/data-foundation-gate.md` | actual canary 결과와 남은 금지선 |

### Task 1: Infisical 전달과 manual canary Workflow 계약을 추가한다

**Files:**
- Create: `infra/product/secrets/kustomization.yaml`
- Create: `infra/product/secrets/infisical.secret-store.yaml`
- Create: `infra/product/secrets/dataplane.external-secrets.yaml`
- Modify: `infra/product/kustomization.yaml`
- Modify: `infra/product/workflows/workflow-template.yaml`
- Modify: `infra/tests/test_workflow_contract.py`
- Create: `docs/operations/r0-live-canary.md`

**Interfaces:**
- Produces: Infisical Kubernetes Auth `SecretStore`, explicit DB/R2 `ExternalSecret`, UUID `source-release-id`, ISO `as-of`, positive `page-budget`
- Consumes: offline 계획의 production CLI, externally bootstrapped `eatbid-infisical-kubernetes-auth/identityId`, Infisical `dev:/runtime/dataplane`

- [ ] **Step 1: secret delivery와 canary parameter 실패 테스트를 쓴다**

```python
def test_manual_canary가_release_identity와_page_budget을_모든_stage에_전달한다() -> None:
    template = manifests.workflow_template("eatbid-dataplane")
    assert required_parameters(template) >= {"source-release-id", "as-of", "page-budget"}
    assert all(cron["spec"]["suspend"] is True for cron in manifests.of_kind("CronWorkflow"))


def test_Infisical이_dataplane_secret의_유일한_value_source다() -> None:
    assert manifests.kinds.count("SecretStore") == 1
    assert manifests.kinds.count("ExternalSecret") == 2
    assert manifests.kinds.count("Secret") == 0
    assert external_secret_keys(manifests) == {
        "DATABASE_URL", "R2_ENDPOINT_URL", "R2_BUCKET",
        "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    }
```

- [ ] **Step 2: 실패를 확인하고 Infisical Kubernetes Auth store를 구현한다**

Run: `uv run --project apps/dataplane pytest infra/tests/test_workflow_contract.py -q`

```yaml
apiVersion: external-secrets.io/v1
kind: SecretStore
metadata:
  name: eatbid-infisical-dataplane
  namespace: eatbid
spec:
  provider:
    infisical:
      hostAPI: https://app.infisical.com
      auth:
        kubernetesAuthCredentials:
          identityId:
            name: eatbid-infisical-kubernetes-auth
            key: identityId
      secretsScope:
        projectSlug: eatbid
        environmentSlug: dev
        secretsPath: /runtime/dataplane
        recursive: false
```

bootstrap Secret의 value는 Git에 넣지 않는다. Machine Identity는 `dev:/runtime/dataplane`의 `describeSecret + readValue`만 갖고, `PushSecret`과 `dataFrom`은 만들지 않는다. 두 `ExternalSecret`은 위 다섯 key를 `spec.data`로 하나씩 매핑해 기존 target Secret `eatbid-database-dataplane`, `eatbid-r2`를 만든다.

Kubernetes Auth token은 ESO controller가 제출하므로 실행 전에 실제 ESO controller ServiceAccount의 name/namespace를 조회해 Infisical의 allowed service account와 namespace에 exact 등록한다. workload 분리는 dataplane 전용 Machine Identity와 path-scoped namespace `SecretStore`로 강제하며 dataplane Pod ServiceAccount가 직접 Infisical에 로그인한다고 가정하지 않는다.

- [ ] **Step 3: 동일 release parameter를 모든 stage에 wiring한다**

각 DAG task는 동일 release ID를 사용한다. page budget은 discover에서만 소비하고 나머지 stage는 manifest membership을 읽는다. schedule manifest의 `suspend: true`는 변경하지 않는다.

- [ ] **Step 4: runbook에 승인·중단·read-only evidence query를 작성한다**

canary 범위는 고정된 작은 기간과 page budget 1로 시작한다. runbook은 cluster context/namespace, image digest, bootstrap Secret key 존재 여부, `SecretStore`/`ExternalSecret` Ready condition을 값 비노출로 조회한 뒤 manual Workflow를 submit한다. `argo cron resume` 명령은 넣지 않는다.

- [ ] **Step 5: offline render와 strict lint를 통과시킨다**

```powershell
kubectl kustomize infra/product | Set-Content -LiteralPath "$env:TEMP/eatbid-product.yaml" -Encoding utf8
uv run --project apps/dataplane pytest infra/tests/test_workflow_contract.py -q
uv run --project apps/dataplane python infra/verify_argo_platform.py filter-workflows --input "$env:TEMP/eatbid-product.yaml" | Set-Content -LiteralPath "$env:TEMP/eatbid-workflows.yaml" -Encoding utf8
docker run --rm --volume "$env:TEMP`:/verification:ro" quay.io/argoproj/argocli@sha256:83e93aa9149a51da998c1df4abea7ae2c504e0b0a5892052dc092740f68323e8 lint --offline --strict /verification/eatbid-workflows.yaml
Remove-Item -LiteralPath "$env:TEMP/eatbid-product.yaml","$env:TEMP/eatbid-workflows.yaml"
```

- [ ] **Step 6: 커밋한다**

```powershell
git add infra/product/secrets infra/product/kustomization.yaml infra/product/workflows/workflow-template.yaml infra/tests/test_workflow_contract.py docs/operations/r0-live-canary.md
git commit -m "ops(data): Infisical 기반 R0 수동 canary 계약을 추가한다"
```

### Task 2: offline evidence 뒤 승인된 live canary를 실행한다

**Files:**
- Update: `docs/operations/data-foundation-gate.md`
- External: Infisical dev path, R2 bucket, PostgreSQL, Argo Workflow run
- Update: Linear canary issue handoff comment

**Interfaces:**
- Consumes: main의 signed dataplane digest와 선행 main·offline 계획
- Produces: actual `run_id`, sealed `source_release_id`, raw object hash, canary publication ID 또는 typed failure evidence

- [ ] **Step 1: Node 24.20.0과 전체 offline gate를 실행한다**

```powershell
fnm exec --using=24.20.0 node --version
fnm exec --using=24.20.0 pnpm architecture:check
fnm exec --using=24.20.0 pnpm test
fnm exec --using=24.20.0 pnpm build
uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests -q
uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra
uv run --project apps/dataplane pyright apps/dataplane/src
```

- [ ] **Step 2: live 대상과 page budget 1을 출력해 별도 승인을 받는다**

DB host 이름, R2 bucket 이름, cluster context/namespace, image digest, release as-of와 기간만 표시한다. secret 값과 source raw query/body는 표시하지 않는다.

- [ ] **Step 3: manual canary 한 건을 실행한다**

runbook의 exact `argo submit` 명령을 사용한다. source throttle이면 재시도 폭을 자동 확대하지 않고 typed failure로 종료한다. 실패 release를 sealed/published로 바꾸지 않는다.

- [ ] **Step 4: deterministic replay와 저장소 evidence를 검증한다**

같은 observation membership을 새 replay run으로 처리하고 raw object hash, canonical publication fingerprint가 일치하는지 확인한다. R2 object, DB release/run/publication, Argo node exit code를 하나의 handoff에 연결한다.

- [ ] **Step 5: gate 문서와 한국어 커밋을 만든다**

```powershell
git add docs/operations/data-foundation-gate.md
git commit -m "docs(data): R0 live canary 검증 증거를 기록한다"
```
