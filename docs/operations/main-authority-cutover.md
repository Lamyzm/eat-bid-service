---
id: MAIN-AUTHORITY-CUTOVER
status: active
canonical_for: main-branch-authority-and-release-tag-publication
last_reviewed: 2026-09-11
review_trigger: build-trigger-argo-source-or-default-branch-change
---

# main 권위 전환과 release tag 발행 runbook

## 1. 결론

코드 권위는 `main`, 발행 권위는 불변 annotated tag `release/v<MAJOR>.<MINOR>.<PATCH>` 하나다.
근거는 [ADR 0024](../adr/0024-free-github-tag-gated-publication.md)이며 실행 계약은
[`docs/superpowers/plans/2026-09-01-main-authority-migration.md`](../superpowers/plans/2026-09-01-main-authority-migration.md)다.

`main` push와 pull request는 읽기 전용 `validate.yml`만 실행하고 image를 발행하지 않는다.
`workflow_dispatch`는 build workflow에 존재하지 않는다.

## 2. 남는 위험

private GitHub Free에는 branch protection API가 없다. 그래서 다음을 완료 조건으로 주장하지 않는다.

- 서버가 강제하는 protected `main`
- required pull request와 required status check
- `master` write freeze

서버가 막지 못하는 대신 세 겹으로 막는다. 로컬 `.githooks` pre-push, 읽기 전용 `validate.yml`,
그리고 build workflow의 tag preflight다. 앞의 둘은 우회할 수 있고 마지막 하나만 우회할 수 없다.
직접 `main`에 push해도 이미지는 발행되지 않으며, 발행은 tag를 만들어야만 시작된다.

`validate.yml`이 실제로 무엇을 검사하는지, 그리고 그 `validate.yml`이 `main` push에서 실패하면 무엇을
하는지는 [`ci-gate-failure-response.md`](ci-gate-failure-response.md)가 권위 문서다.

`master`와 `rollback/pre-main-cutover-2026-09-01` tag는 관찰 기간이 끝나도 자동으로 지우지 않는다.

## 3. A0 전환 (한 번만 수행)

전환 전에 read-only 조회로 승인 대상 SHA를 먼저 고정한다. clean worktree, remote `master` 존재,
local/remote rollback tag 부재, remote `main` 부재 중 하나라도 다르면 mutation 없이 중단한다.

```powershell
function Assert-Native($Step, $Code) { if ($Code -ne 0) { throw "$Step 실패(exit=$Code)" } }
$RollbackTag = "rollback/pre-main-cutover-2026-09-01"
$Status = git status --porcelain=v1; Assert-Native "worktree 조회" $LASTEXITCODE
if ($Status) { throw "worktree가 clean하지 않음" }
$ApprovedLocalMain = git rev-parse HEAD; Assert-Native "local main SHA 조회" $LASTEXITCODE
$ApprovedRemoteMaster = (git ls-remote origin refs/heads/master -split '\s+')[0]
git merge-base --is-ancestor $ApprovedRemoteMaster $ApprovedLocalMain; Assert-Native "조상 관계 검증" $LASTEXITCODE
$RemoteRefs = @(git ls-remote origin refs/heads/main "refs/tags/$RollbackTag")
if ($RemoteRefs.Count -ne 0) { throw "생성 대상 remote ref가 이미 존재함" }
[pscustomobject]@{ RemoteMaster=$ApprovedRemoteMaster; LocalMain=$ApprovedLocalMain }
```

**승인 gate 1.** 위 두 SHA를 사용자에게 제시하고 승인을 받는다. 승인 뒤에는 조회 결과로 변수를
다시 만들지 않고 승인 화면의 literal 값만 복사한다.

승인 뒤 현재 값이 승인 값과 exact equality인지 다시 확인하고, 승인된 remote `master` SHA로
annotated rollback tag를 만든 뒤 tag object type과 peel을 검증한다. 그 다음에만 push한다.

```powershell
git tag --annotate $RollbackTag $ApprovedRemoteMaster --message "main 전환 전 원격 master 복구 기준점"
if ((git cat-file -t "refs/tags/$RollbackTag") -ne 'tag') { throw "annotated tag가 아님" }
if ((git rev-parse "refs/tags/$RollbackTag^{}") -ne $ApprovedRemoteMaster) { throw "peel 불일치" }
git push origin "refs/tags/$RollbackTag"
git push origin "${ApprovedLocalMain}:refs/heads/main"
```

**승인 gate 2.** 현재 default branch를 제시하고 승인을 받은 뒤에만 전환한다.

```powershell
gh repo edit Lamyzm/eat-bid-service --default-branch main
git remote set-head origin --auto
if ((git symbolic-ref refs/remotes/origin/HEAD) -ne 'refs/remotes/origin/main') { throw "origin/HEAD가 main이 아님" }
```

**성공 판정.** rollback tag가 annotated이고 peel이 전환 전 remote `master`, `refs/heads/main`이 승인한
local SHA, default branch가 `main`, `refs/heads/master`가 원래 SHA로 그대로 존재한다.

## 4. release tag 발행

발행 전에 전체 gate를 로컬에서 통과시킨다. 하나라도 실패하면 승인 요청도 tag 생성도 하지 않는다.

```powershell
fnm exec --using=24.20.0 pnpm architecture:check
fnm exec --using=24.20.0 pnpm test
fnm exec --using=24.20.0 pnpm build
uv run --project apps/dataplane pytest infra/tests -q
```

그 다음 clean tree, local/remote `main` 일치, local/remote tag 부재를 확인하고 tag 이름과 release
commit을 고정한다. tag 이름은 `^release/v[0-9]+\.[0-9]+\.[0-9]+$`를 만족해야 한다.

```powershell
$ReleaseTag = "release/v<MAJOR>.<MINOR>.<PATCH>"
$ApprovedReleaseCommit = (git ls-remote origin refs/heads/main -split '\s+')[0]
if ((git rev-parse HEAD) -ne $ApprovedReleaseCommit) { throw "local/remote main 불일치" }
if (@(git ls-remote origin "refs/tags/$ReleaseTag").Count -ne 0) { throw "remote release tag가 이미 존재함" }
[pscustomobject]@{ ReleaseTag=$ReleaseTag; ReleaseCommit=$ApprovedReleaseCommit }
```

**승인 gate 3.** tag 이름과 release commit을 제시하고 승인을 받는다.

```powershell
git tag --annotate $ReleaseTag $ApprovedReleaseCommit --message "eatbid $ReleaseTag 릴리즈"
if ((git cat-file -t "refs/tags/$ReleaseTag") -ne 'tag') { throw "annotated tag가 아님" }
if ((git rev-parse "refs/tags/$ReleaseTag^{}") -ne $ApprovedReleaseCommit) { throw "peel 불일치" }
git push origin "refs/tags/$ReleaseTag"
```

lightweight tag는 preflight가 거부한다. `git tag`를 `--annotate` 없이 쓰지 마라.

## 5. 발행 증거 확인

workflow가 끝나면 다음 다섯 가지가 모두 같은 release commit에서 파생됐는지 확인한다.

| 증거 | 확인 대상 |
|---|---|
| workflow identity | run의 `workflow_ref`가 `.github/workflows/build.yml@refs/tags/<release tag>` |
| preflight | `resolve-release-commit`이 낸 commit이 승인한 release commit |
| Cosign | 세 verify step이 anchored identity regexp로 통과 |
| SLSA | predicate의 `gitCommit`이 release commit, `workflow.ref`가 tag ref |
| promotion | promote commit의 parent가 release commit, `main`에 normal push |

`main` push나 `workflow_dispatch`로 시작된 publication run이 존재하지 않아야 한다. build workflow에
그 trigger 자체가 없으므로 하나라도 보이면 workflow가 변조된 것이다.

## 6. cluster Argo 전환

repository의 `infra/argocd/application.yaml`을 커밋하는 것과 클러스터의 Application을 바꾸는 것은
서로 다른 단계다. apply 전에 context·namespace·diff를 조회해 고정한다.

```powershell
$ApprovedContext = kubectl config current-context
$ApprovedDiff = @(kubectl diff --filename infra/argocd/application.yaml 2>&1)
$DiffBytes = [Text.Encoding]::UTF8.GetBytes(($ApprovedDiff -join "`n"))
[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($DiffBytes))
```

**승인 gate 4.** context와 diff hash를 제시하고 승인을 받은 뒤, 같은 값이 유지되는지 재확인하고
apply한다.

```powershell
kubectl apply --server-side --field-manager=eatbid-main-cutover --filename infra/argocd/application.yaml
```

migration은 PreSync hook이므로 첫 sync 전에 `pgdata` snapshot 또는 `pg_dump`를 확보한다.
두 CronWorkflow는 `spec.suspend: true`를 유지하므로 이 apply만으로 수집이 시작되지는 않는다.

## 7. rollback

기존 tag를 옮기거나 덮어쓰지 않는다. 잘못된 발행은 새 semver tag로 정정한다.

| 되돌릴 대상 | 방법 |
|---|---|
| cluster Argo source | `infra/argocd/application.yaml`을 이전 source로 되돌려 같은 승인 절차로 apply |
| 제품 digest | 이전 promote commit의 `infra/product/kustomization.yaml`을 복원하는 새 commit |
| GitHub default branch | `gh repo edit Lamyzm/eat-bid-service --default-branch master` |
| 코드 기준점 | `rollback/pre-main-cutover-2026-09-01` tag가 가리키는 전환 전 remote `master` commit |

rollback은 조회와 dry-run으로 먼저 rehearsal하고, 실제 mutation은 같은 승인 gate를 다시 거친다.
