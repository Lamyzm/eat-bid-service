# GitHub Free용 main 권위와 태그 publication 전환 Implementation Plan

> **에이전트 작업자:** REQUIRED SUB-SKILL: 이 계획은 `superpowers:subagent-driven-development`(권장) 또는 `superpowers:executing-plans`로 task 단위 실행한다. 진행 표시는 checkbox(`- [ ]`)로 관리한다.

**Goal:** private GitHub Free를 유지하면서 `main`을 코드·검증·기본 branch의 SSOT로 만들고, canonical annotated tag `release/v<MAJOR>.<MINOR>.<PATCH>`만 image publication과 promotion을 시작하게 한다.

**Architecture:** `main` push와 PR은 read-only `validate.yml`만 실행한다. `build.yml`은 exact release tag push에서 annotated tag와 current `origin/main` HEAD를 검증한 뒤 같은 tag identity로 build·SLSA·Cosign·promotion을 수행한다. `master`는 publication 권위가 아닌 복구 기준으로 보존하며 GitHub default와 cluster Argo 변경은 각각 별도 승인한다.

**Tech Stack:** Git/GitHub CLI, GitHub Actions, Python 3.12, pytest, Cosign/SLSA, Kustomize, Argo CD

**Spec:** `docs/superpowers/specs/2026-09-01-main-r0-execution-boundary-design.md` · **ADR:** `docs/adr/0024-free-github-tag-gated-publication.md` · **Linear:** EAT-16 (parent EAT-15)

## Global Constraints

- repository는 private와 GitHub Free를 유지한다. branch protection, required PR/check와 `master` write freeze를 완료 조건으로 주장하지 않는다.
- 모든 Node/pnpm 검증은 `fnm exec --using=24.20.0`으로 실행해 `v24.20.0`인지 먼저 확인한다. pnpm은 `10.12.1`을 사용하고 lockfile을 변경하지 않는다.
- remote ref/default branch/release tag와 cluster mutation 직전에 exact SHA 또는 diff를 다시 조회하고 사용자 승인을 각각 받는다. force push와 기존 tag 이동·덮어쓰기는 금지한다.
- `master`와 rollback tag는 관찰 단계가 끝나도 자동 삭제하지 않는다. `main` push와 PR에는 publication·promotion 권한을 주지 않는다.
- 테스트 이름, 운영 문서와 commit 제목은 한국어로 작성한다. 모든 계획 파일은 300줄 이하를 유지한다.

---

## 파일 책임 지도

| 경로 | 책임 |
|---|---|
| `.github/workflows/validate.yml` | PR과 `main` push의 결정적 read-only 검증; publication 없음 |
| `.github/workflows/build.yml` | canonical annotated release tag preflight, build·scan·sign·attest·promotion |
| `infra/generate_slsa_provenance.py` | exact tag event/ref, workflow identity와 peeled release commit 기반 SLSA predicate |
| `infra/argocd/application.yaml` | 계속 `main`의 `infra/product`를 소비하는 product GitOps source |
| `infra/tests/test_build_contract.py` | tag trigger·annotated/current-main guard·Cosign regexp·promotion race 회귀 gate |
| `infra/tests/test_slsa_provenance.py` | release tag workflow/SLSA subject와 peeled commit 회귀 gate |
| `infra/tests/test_workflow_contract.py` | Argo Application의 `main`/`infra/product` source 회귀 gate |
| `docs/operations/main-authority-cutover.md` | 무료 플랜 risk, release tag 생성·검증·rollback runbook |
| `docs/operations/ai-code-review.md` | 실제 `main` hook과 read-only validation 상태 |
| `docs/architecture/runtime-and-deployment.md` | tag publication과 repository/cluster Argo 상태 분리 |

### Task 1: read-only snapshot 뒤 원격 main 코드 권위를 확립한다

**Files:**
- External create: `refs/tags/rollback/pre-main-cutover-2026-09-01`
- External create: `refs/heads/main`
- External update: GitHub default branch
- Preserve: `refs/heads/master`

**RED:** 다음 read-only 조회에서 clean local `main`, remote `master`, `origin/main`과 rollback tag의 존재·부재, default branch가 승인된 예상과 하나라도 다르면 mutation 없이 중단한다.

```powershell
fnm exec --using=24.20.0 node --version
fnm exec --using=24.20.0 pnpm --version
git status --short --branch
git rev-parse HEAD
git ls-remote --symref origin HEAD refs/heads/main refs/heads/master refs/tags/rollback/pre-main-cutover-2026-09-01 refs/tags/rollback/pre-main-cutover-2026-09-01^{}
gh api repos/Lamyzm/eat-bid-service --jq '{default_branch:.default_branch,visibility:.visibility}'
```

**GREEN:** 첫 승인 뒤 remote `master` SHA에 rollback annotated tag를 만들고, 그 SHA가 local `main`의 조상임을 확인한 다음 local `main` exact SHA를 `origin/main`에 최초 normal push한다. 두 ref를 재조회한 뒤 두 번째 승인으로 default branch만 `main`으로 바꾸고 `origin/HEAD → main`을 확인한다. 기존 ref가 있으면 덮어쓰지 않고 exact SHA 일치만 확인한다.

```powershell
$RemoteMaster = (git ls-remote origin refs/heads/master).Split()[0]
$LocalMain = git rev-parse HEAD
git merge-base --is-ancestor $RemoteMaster $LocalMain
git tag --annotate rollback/pre-main-cutover-2026-09-01 $RemoteMaster --message "main 전환 전 원격 master 복구 기준점"
git push origin refs/tags/rollback/pre-main-cutover-2026-09-01
git push origin "${LocalMain}:refs/heads/main"
git ls-remote origin refs/heads/main refs/heads/master refs/tags/rollback/pre-main-cutover-2026-09-01 refs/tags/rollback/pre-main-cutover-2026-09-01^{}
gh repo edit Lamyzm/eat-bid-service --default-branch main
git remote set-head origin --auto
git symbolic-ref refs/remotes/origin/HEAD
```

**검증:** rollback tag object가 annotated tag이고 peel은 전환 전 remote `master`, `refs/heads/main`은 승인한 local SHA, default는 `main`, `master`는 원래 SHA로 존재해야 한다. `validate.yml`의 두 read-only job 결과도 조회한다.

**Commit:** 없음. remote ref/default 전환은 Git commit 대상이 아니며 exact SHA와 승인 evidence는 한국어 Linear worklog에 남긴다.

### Task 2: canonical release tag publication trust를 TDD로 구현한다

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `infra/generate_slsa_provenance.py`
- Modify: `infra/tests/test_build_contract.py`
- Modify: `infra/tests/test_slsa_provenance.py`

**RED:** 다음 exact test를 먼저 추가·수정하고 focused suite가 기존 `master` trigger/identity 때문에 실패하는지 확인한다.

```python
def test_publication은_canonical_release_tag_push에서만_시작한다() -> None: ...
def test_publication_preflight는_annotated_tag와_current_main_HEAD를_요구한다() -> None: ...
def test_Cosign_검증은_release_tag_workflow_identity에_anchor된다() -> None: ...
def test_promotion은_tagged_main이_움직이면_normal_push전에_거부한다() -> None: ...
def test_SLSA는_release_tag와_peeled_commit을_같은_subject로_사용한다() -> None: ...
```

Run: `uv run --project apps/dataplane pytest infra/tests/test_build_contract.py infra/tests/test_slsa_provenance.py -q`

**GREEN:** 최소 implementation은 다음 계약을 만족한다.

- `build.yml` trigger는 `push.tags: ["release/v*"]`만 두고 branch trigger와 `workflow_dispatch`를 제거한다. job preflight는 event `push`와 full ref exact regexp `^refs/tags/release/v[0-9]+\.[0-9]+\.[0-9]+$`를 다시 검사한다.
- full history와 remote ref를 fetch한 뒤 remote tag object type이 `tag`인지, peeled commit이 현재 `refs/remotes/origin/main` HEAD인지 확인한다. lightweight tag와 stale main tag는 publish 전에 실패한다.
- `github.workflow_ref`, job workflow ref와 SLSA subject는 같은 release tag를 사용한다. image revision, digest metadata와 provenance Git SHA는 preflight가 낸 peeled commit을 사용한다.
- 세 Cosign verify step은 `^https://github\.com/Lamyzm/eat-bid-service/\.github/workflows/build\.yml@refs/tags/release/v[0-9]+\.[0-9]+\.[0-9]+$` anchored identity regexp를 사용한다.
- promotion은 release tag commit과 current remote main HEAD가 같은지 다시 확인하고 `main`을 checkout한다. digest만 바꾼 commit을 `git push origin HEAD:main`으로 normal push하며 race로 main이 움직이면 non-fast-forward로 실패한다.
- architecture, TypeScript/Python test, build와 delivery 검증은 image publish보다 먼저 모두 통과한다. `validate.yml`은 수정하지 않고 read-only를 유지한다.

**검증:** focused suite 뒤 `uv run --project apps/dataplane pytest infra/tests -q`를 실행하고 workflow YAML에서 publish job이 tag preflight와 전체 gate에 의존하는지 직접 읽는다.

**Commit:** `ci: 무료 태그 publication 신뢰 경계를 구현한다`

### Task 3: Argo source를 main의 product composition으로 TDD 전환한다

**Files:**
- Modify: `infra/argocd/application.yaml`
- Modify: `infra/tests/test_workflow_contract.py`

**RED:** 다음 exact test를 먼저 작성하고 현재 `master`/`infra/k8s/base`에서 실패를 확인한다.

```python
def test_live_application은_main의_product_composition을_소비한다() -> None:
    application = yaml.safe_load(LIVE_APPLICATION.read_text(encoding="utf-8"))
    assert application["spec"]["source"] == {
        "repoURL": "https://github.com/Lamyzm/eat-bid-service",
        "targetRevision": "main",
        "path": "infra/product",
    }
```

Run: `uv run --project apps/dataplane pytest infra/tests/test_workflow_contract.py -q`

**GREEN:** `infra/argocd/application.yaml`의 source만 `targetRevision: main`, `path: infra/product`로 바꾼다. destination과 sync policy, product `CronWorkflow.spec.suspend: true`는 바꾸지 않는다. 이 task는 repository manifest만 수정하며 cluster에 apply하지 않는다.

**검증:** focused test, `kubectl kustomize infra/product`, strict offline Argo lint와 전체 `infra/tests`를 실행한다. render 임시 파일은 repository 밖에 둔다.

**Commit:** `ops: Argo가 main의 product 구성을 추적하게 한다`

### Task 4: 무료 플랜 cutover·release·rollback runbook을 확정한다

**Files:**
- Create: `docs/operations/main-authority-cutover.md`
- Modify: `docs/operations/ai-code-review.md`
- Modify: `docs/architecture/runtime-and-deployment.md`

**RED:** 세 문서를 직접 읽어 protected main, required PR/check, `master` write freeze, main-push publication과 `workflow_dispatch` publication을 완료 조건으로 말하는 stale 문구를 목록화한다. 인간용 문서에 grep 기반 테스트를 추가하지 않는다.

**GREEN:** runbook은 다음을 exact 명령·성공 판정·사용자 승인 gate와 함께 기록한다.

- private GitHub Free에서 direct `main` push를 서버가 막지 못하는 residual risk와 read-only validation의 한계
- A0 snapshot, rollback annotated tag, `origin/main` 최초 push와 default `main` 전환
- 새 canonical `release/v<semver>` annotated tag가 current remote main HEAD를 가리키는지 생성 전·push 후 검증하는 절차
- workflow ref, Cosign anchored identity regexp, SLSA peeled commit, 네 image digest와 promotion parent evidence
- cluster context와 Application diff 조회 뒤 별도 승인으로 Argo apply하는 절차
- GitHub default, release tag/digest evidence와 Argo target을 함께 되돌리는 rollback; 기존 release tag를 이동하지 않고 정정은 새 semver tag로 발행하는 규칙

`ai-code-review.md`는 `origin/main` 기반 현재형 hook/validation을 기록하고 required check라고 부르지 않는다. runtime 문서는 tag publication과 `main` promotion, repository manifest 변경과 live cluster apply를 분리한다.

**검증:** 세 문서를 다시 읽고 `git diff --check`, 문서 code fence 짝수와 각 계획 파일 300줄 이하를 확인한다.

**Commit:** `docs: 무료 태그 릴리즈와 복구 절차를 기록한다`

### Task 5: 전체 검증 뒤 release tag publication과 Argo cutover를 증거로 닫는다

**Files:**
- External create: 새 `refs/tags/release/v<MAJOR>.<MINOR>.<PATCH>`
- External verify: GitHub Actions run, GHCR signature·attestation·digest, promotion commit
- External update: cluster Argo Application
- Update: Linear EAT-16 handoff comment

**RED:** clean tree, current local/remote `main` exact SHA, tag 미존재, `main` validate와 아래 전체 검증 중 하나라도 실패하면 release tag를 만들지 않는다. PR merge는 필수 조건이 아니다.

```powershell
fnm exec --using=24.20.0 pnpm architecture:check
fnm exec --using=24.20.0 pnpm test
fnm exec --using=24.20.0 pnpm build
uv run --project apps/dataplane pytest infra/tests -q
git status --short --branch
git ls-remote origin refs/heads/main refs/tags/release/v<MAJOR>.<MINOR>.<PATCH> refs/tags/release/v<MAJOR>.<MINOR>.<PATCH>^{}
```

**GREEN:** exact tag 이름과 remote main SHA를 사용자에게 제시해 승인을 받은 뒤 그 commit에 annotated tag를 만들고 tag ref만 push한다. workflow 완료 후 tag object/peel, workflow ref, Cosign identity regexp, SLSA Git SHA, 네 image digest와 promotion commit parent가 모두 같은 release commit에서 파생됐는지 확인한다. promotion 이후 remote main SHA가 새 digest commit인지 확인한 다음 cluster context·namespace·Application diff를 제시해 별도 승인을 받고 `infra/argocd/application.yaml`을 apply한다.

```powershell
$ReleaseTag = "release/v<MAJOR>.<MINOR>.<PATCH>"
$ReleaseCommit = (git ls-remote origin refs/heads/main).Split()[0]
git tag --annotate $ReleaseTag $ReleaseCommit --message "eatbid $ReleaseTag 릴리즈"
git push origin "refs/tags/$ReleaseTag"
git ls-remote origin "refs/tags/$ReleaseTag" "refs/tags/$ReleaseTag^{}"
kubectl apply --server-side --field-manager=eatbid-main-cutover --filename infra/argocd/application.yaml
```

**검증:** Argo desired Git SHA와 네 promoted digest가 publication evidence와 같고 `main`/`master` push나 `workflow_dispatch` publication run이 없음을 확인한다. rollback은 조회·dry-run으로 rehearsal하되 실제 mutation과 기존 tag 이동은 하지 않는다.

**Commit:** 없음. release tag, GitHub/registry evidence와 cluster apply는 Git commit 대상이 아니며 결과를 한국어 Linear handoff에 기록한다.
