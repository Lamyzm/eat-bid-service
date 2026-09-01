# 원격 main 권위 전환 Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** 원격 `main`을 검증·publication·promotion·Argo가 함께 참조하는 유일한 저장소 권위로 전환하고 `master`를 복구 경계로 보존한다.

**Architecture:** publication workflow의 branch, job guard, SLSA/Cosign identity와 promotion target을 한 PR에서 바꾼다. GitHub default/protection과 cluster Argo Application은 저장소 변경과 분리된 승인 단계로 실행하며, 어느 시점에도 두 branch가 동시에 publication 권위를 갖지 않는다.

**Tech Stack:** Git/GitHub CLI, GitHub Actions, Python 3.12, pytest, Cosign/SLSA, Kustomize, Argo CD

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **Linear:** EAT-16 (parent EAT-15)

## Global Constraints

- 모든 Node/pnpm 검증은 `fnm exec --using=24.20.0`으로 실행해 `v24.20.0`인지 먼저 확인하고 PR validation에는 publication·promotion 권한을 주지 않는다.
- pnpm은 `10.12.1`을 사용하고 lockfile을 변경하지 않으며, 원격 GitHub/cluster mutation 직전에 정확한 대상·SHA를 다시 조회하고 사용자 승인을 받는다.
- `master`와 rollback tag는 관찰 단계가 끝날 때까지 삭제·이동하지 않고 테스트 이름·운영 문서·커밋 제목은 한국어로 작성한다.
- 300줄을 넘는 파일은 책임 분리를 검토하고 불가피한 근거를 같은 변경에 기록한다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `.github/workflows/validate.yml` | PR과 `main` push의 결정적 read-only required check |
| `.github/workflows/build.yml` | 보호된 `main` SHA만 build·scan·sign·attest·promotion |
| `infra/generate_slsa_provenance.py` | trusted workflow ref와 protected Git ref 검증 |
| `infra/argocd/application.yaml` | product GitOps branch와 composition root 선언 |
| `infra/tests/test_build_contract.py` | workflow guard·Cosign identity·promotion target 회귀 gate |
| `infra/tests/test_slsa_provenance.py` | SLSA predicate의 exact `main` identity 회귀 gate |
| `infra/tests/test_workflow_contract.py` | Argo Application이 `main`/`infra/product`를 가리키는지 검증 |
| `docs/operations/main-authority-cutover.md` | 외부 설정 전환·검증·rollback runbook |
| `docs/operations/ai-code-review.md` | 더 이상 미래형이 아닌 실제 `main` hook/CI 상태 기록 |

### Task 1: 전환 전 원격 기준점과 origin/main을 봉인한다

**Files:**
- Create: remote branch `refs/heads/main`
- Create: remote annotated tag `refs/tags/rollback/pre-main-cutover-2026-09-01`
- External: GitHub branch protection for `main` and write freeze for `master`

**Interfaces:**
- Consumes: clean local `main` containing this plan, current remote `master` SHA
- Produces: publication code가 아직 `master`를 가리키는 동일 SHA의 protected `origin/main`

- [ ] **Step 1: 도구와 기준 SHA를 검증한다**

```powershell
fnm exec --using=24.20.0 node --version
fnm exec --using=24.20.0 pnpm --version
gh auth status
git status --short --branch
git ls-remote --symref origin HEAD refs/heads/main refs/heads/master refs/tags/rollback/pre-main-cutover-2026-09-01
gh api repos/Lamyzm/eat-bid-service --jq '{default_branch:.default_branch}'
```

Expected: Node `v24.20.0`, pnpm `10.12.1`, clean `main`, default `master`, remote `main`과 rollback tag 없음. 하나라도 다르면 mutation 없이 중단한다.

- [ ] **Step 2: master 복구 tag와 origin/main 생성을 별도 승인받아 실행한다**

```powershell
$RemoteMaster = git ls-remote origin refs/heads/master | ForEach-Object { ($_ -split '\s+')[0] }
$LocalMain = git rev-parse HEAD
git merge-base --is-ancestor $RemoteMaster $LocalMain
git tag --annotate rollback/pre-main-cutover-2026-09-01 $RemoteMaster --message "main 전환 전 원격 master 복구 기준점"
git push origin refs/tags/rollback/pre-main-cutover-2026-09-01
git push origin "${LocalMain}:refs/heads/main"
```

Expected: ancestor 검사 exit 0, tag는 remote master SHA, remote main은 local main SHA와 일치한다. 기존 tag가 발견되면 덮어쓰지 않고 SHA 일치만 확인한다.

- [ ] **Step 3: main validation run의 실제 check 이름을 확인한다**

```powershell
$MainSha = git rev-parse HEAD
gh run list --branch main --commit $MainSha --workflow validate.yml --limit 1
$RunId = gh run list --branch main --commit $MainSha --workflow validate.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $RunId --exit-status
gh api "repos/Lamyzm/eat-bid-service/commits/$MainSha/check-runs" --jq '.check_runs[] | [.name,.conclusion] | @tsv'
```

Expected: `아키텍처·테스트·빌드 검증`, `프론트엔드 browser 기반 검증`이 success다.

- [ ] **Step 4: main protection을 적용하고 재조회한다**

GitHub rule은 PR 필수, linear history, conversation resolution, force push/delete 금지, 위 두 check strict 필수로 설정한다. solo repository이므로 승인 인원 수는 0으로 두되 PR 자체는 생략하지 않는다.

```powershell
gh api repos/Lamyzm/eat-bid-service/branches/main/protection
gh api repos/Lamyzm/eat-bid-service/rules/branches/main
```

Expected: required checks 두 개와 force-push/delete 금지가 조회된다. API mutation payload는 실행 직전 현재 설정 snapshot과 함께 Linear worklog에 남긴다.

### Task 2: publication trust identity를 main으로 전환한다

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `infra/generate_slsa_provenance.py`
- Modify: `infra/tests/test_build_contract.py`
- Modify: `infra/tests/test_slsa_provenance.py`

**Interfaces:**
- Consumes: protected `origin/main`
- Produces: `refs/heads/main` 외 context를 fail-closed하는 build/provenance 계약

- [ ] **Step 1: main identity를 요구하는 실패 테스트를 먼저 쓴다**

```python
def test_context_preflight가_main만_publication_ref로_허용한다() -> None:
    guard = str(_job("test")["if"])
    assert "refs/heads/main" in guard
    assert "refs/heads/master" not in guard


def test_Cosign_검증이_main_workflow_identity만_신뢰한다() -> None:
    expected = ".github/workflows/build.yml@refs/heads/main"
    by_id = {step.get("id"): step for step in _steps("build")}
    for step_id in ("verify-signature", "verify-provenance", "verify-sbom"):
        assert expected in str(by_id[step_id]["run"])
```

`infra/tests/test_slsa_provenance.py`의 valid environment도 `GITHUB_REF`, workflow ref, expected predicate를 모두 `refs/heads/main`으로 바꾼다.

- [ ] **Step 2: 실패를 확인한다**

Run: `uv run --project apps/dataplane pytest infra/tests/test_build_contract.py infra/tests/test_slsa_provenance.py -q`

Expected: 기존 `master` literal 때문에 새 assertion이 FAIL한다.

- [ ] **Step 3: 최소 implementation을 적용한다**

```python
# infra/generate_slsa_provenance.py
PROTECTED_REF = "refs/heads/main"
```

`.github/workflows/build.yml`의 trigger branch, test job guard, 세 Cosign identity와 promotion checkout `ref`를 모두 `main`으로 바꾼다. `workflow_dispatch`도 main ref가 아니면 기존 guard에서 거부한다.

- [ ] **Step 4: focused test와 전체 delivery test를 통과시킨다**

```powershell
uv run --project apps/dataplane pytest infra/tests/test_build_contract.py infra/tests/test_slsa_provenance.py -q
uv run --project apps/dataplane pytest infra/tests -q
```

- [ ] **Step 5: 한국어 커밋을 만든다**

```powershell
git add .github/workflows/build.yml infra/generate_slsa_provenance.py infra/tests/test_build_contract.py infra/tests/test_slsa_provenance.py
git commit -m "ci: publication 신뢰 기준을 main으로 전환한다"
```

### Task 3: Argo가 main의 product composition만 보게 한다

**Files:**
- Modify: `infra/argocd/application.yaml`
- Modify: `infra/tests/test_workflow_contract.py`

**Interfaces:**
- Consumes: signed digest가 갱신되는 `infra/product/kustomization.yaml`
- Produces: `targetRevision: main`, `path: infra/product`인 declarative Application

- [ ] **Step 1: 실패 테스트를 쓴다**

```python
def test_live_application이_main의_product_composition을_소비한다() -> None:
    application = yaml.safe_load(LIVE_APPLICATION.read_text(encoding="utf-8"))
    source = application["spec"]["source"]
    assert source == {
        "repoURL": "https://github.com/Lamyzm/eat-bid-service",
        "targetRevision": "main",
        "path": "infra/product",
    }
```

- [ ] **Step 2: 실패를 확인한다**

Run: `uv run --project apps/dataplane pytest infra/tests/test_workflow_contract.py -q`

Expected: 현재 `master`/`infra/k8s/base` 때문에 FAIL한다.

- [ ] **Step 3: Application source만 변경한다**

```yaml
source:
  repoURL: https://github.com/Lamyzm/eat-bid-service
  targetRevision: main
  path: infra/product
```

sync policy와 destination은 변경하지 않는다. CronWorkflow의 `spec.suspend: true`도 유지한다.

- [ ] **Step 4: render와 contract를 검증한다**

```powershell
kubectl kustomize infra/product | Set-Content -LiteralPath "$env:TEMP/eatbid-main-product.yaml" -Encoding utf8
uv run --project apps/dataplane pytest infra/tests/test_workflow_contract.py -q
uv run --project apps/dataplane python infra/verify_argo_platform.py filter-workflows --input "$env:TEMP/eatbid-main-product.yaml" | Set-Content -LiteralPath "$env:TEMP/eatbid-main-workflows.yaml" -Encoding utf8
docker run --rm --volume "$env:TEMP`:/verification:ro" quay.io/argoproj/argocli@sha256:83e93aa9149a51da998c1df4abea7ae2c504e0b0a5892052dc092740f68323e8 lint --offline --strict /verification/eatbid-main-workflows.yaml
Remove-Item -LiteralPath "$env:TEMP/eatbid-main-product.yaml","$env:TEMP/eatbid-main-workflows.yaml"
```

- [ ] **Step 5: 한국어 커밋을 만든다**

```powershell
git add infra/argocd/application.yaml infra/tests/test_workflow_contract.py
git commit -m "ops: Argo가 main의 product 구성을 추적하게 한다"
```

### Task 4: cutover runbook과 현재형 문서를 맞춘다

**Files:**
- Create: `docs/operations/main-authority-cutover.md`
- Modify: `docs/operations/ai-code-review.md`
- Modify: `docs/architecture/runtime-and-deployment.md`

**Interfaces:**
- Consumes: Task 2~3의 exact branch/path/identity
- Produces: A0~A7 조회·mutation·rollback 명령과 관찰 증거 양식

- [ ] **Step 1: runbook에 네 개의 원자적 권위 집합을 기록한다**

```text
GitHub default/protection = main
publication/SLSA/Cosign/promotion = refs/heads/main
repository Argo source = main + infra/product
cluster Argo desired revision = main의 promoted digest commit
```

각 절에는 mutation 전 조회, 성공 판정, rollback 명령, 사용자 승인 gate를 함께 둔다. `master` 삭제 명령은 넣지 않는다.

- [ ] **Step 2: 미래형 문구를 현재 전환 조건으로 고친다**

`ai-code-review.md`의 “원격은 여전히 master” 문구를 제거하고, feature branch opt-in 예시 base를 `origin/main`으로 바꾼다. runtime 문서에는 cluster Application 적용 전 repository manifest만 바뀐 상태를 구분한다.

- [ ] **Step 3: 문서 drift와 전체 gate를 검증한다**

```powershell
fnm exec --using=24.20.0 pnpm architecture:check
uv run --project apps/dataplane pytest infra/tests -q
git diff --check
```

- [ ] **Step 4: 한국어 커밋을 만든다**

```powershell
git add docs/operations/main-authority-cutover.md docs/operations/ai-code-review.md docs/architecture/runtime-and-deployment.md
git commit -m "docs: main 권위 전환과 복구 절차를 기록한다"
```

### Task 5: PR merge와 외부 cutover를 증거로 닫는다

**Files:**
- External: GitHub PR/default/protection, GHCR attestations, cluster Argo Application
- Update: Linear 구현 issue handoff comment

**Interfaces:**
- Consumes: Task 2~4의 green commits
- Produces: default·publication·Argo가 동일한 `main` SHA/digest를 참조하는 관찰 증거

- [ ] **Step 1: 전체 검증 후 PR을 만든다**

```powershell
fnm exec --using=24.20.0 pnpm architecture:check
fnm exec --using=24.20.0 pnpm test
fnm exec --using=24.20.0 pnpm build
uv run --project apps/dataplane pytest infra/tests -q
git status --short --branch
```

PR base는 `main`, 제목과 본문은 한국어, 구현 issue identifier와 acceptance별 evidence를 포함한다.

- [ ] **Step 2: master write를 동결하고 PR을 merge한다**

`master`의 새 direct push/PR merge를 막은 상태를 재조회한 뒤에만 merge한다. merge 직전 remote main SHA가 PR base SHA와 다르면 rebase와 전체 검증을 다시 수행한다.

- [ ] **Step 3: main publication을 검증한다**

```powershell
$PublishedSha = gh api repos/Lamyzm/eat-bid-service/commits/main --jq .sha
gh run list --branch main --workflow build.yml --commit $PublishedSha --limit 1
```

네 image의 digest, Cosign certificate identity, SLSA resolved dependency SHA와 promotion commit parent를 확인한다. 하나라도 다르면 default/Argo를 바꾸지 않는다.

- [ ] **Step 4: default branch와 cluster Argo를 각각 승인받아 전환한다**

```powershell
gh repo edit Lamyzm/eat-bid-service --default-branch main
git remote set-head origin --auto
kubectl apply --server-side --field-manager=eatbid-main-cutover --filename infra/argocd/application.yaml
```

Argo 명령 전 현재 cluster context, namespace와 Application diff를 출력한다. 자동 sync 후 desired Git SHA와 네 promoted digest가 publication evidence와 같아야 한다.

- [ ] **Step 5: rollback rehearsal과 관찰 기록을 남긴다**

실제 rollback mutation은 하지 않고 runbook의 복구 기준 tag가 remote master와 일치하는지, default/protection·publication identity·Argo target을 한 세트로 되돌릴 명령이 유효한지 dry-run/조회로 검증한다. `origin/HEAD → main`과 dual publication 부재를 Linear에 기록한다.
