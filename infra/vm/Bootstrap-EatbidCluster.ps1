<#
.SYNOPSIS
  새 k3s 클러스터에 Argo CD와 수동 Secret 넷을 올리고 저장소의 Application 셋을 적용한다(EAT-50).

.DESCRIPTION
  저장소가 진실이다. 여기서 하는 것은 Argo CD 설치, Argo가 스스로 만들 수 없는 수동 Secret 넷의 복사,
  그리고 infra/platform·infra/argocd의 Application 적용뿐이다. 나머지(web·server·postgres·cloudflared·
  Argo Workflows·Infisical operator·InfisicalSecret)는 Argo CD가 main의 manifest로 세운다.

  수동 Secret 넷과 왜 수동인가:
    argocd/repo-eatbid              private GitHub repo 자격증명 — Argo 자신이 읽어야 해서 Argo 밖에 있다
    eatbid/eatbid-infisical-operator Infisical universal auth — 나머지 비밀값을 받아오는 열쇠라 사본이 될 수 없다
    eatbid/ghcr-pull                image pull 자격증명 — Infisical operator보다 먼저 필요하다
    eatbid/cloudflared-creds        터널 자격증명 — 터널 ID가 tunnel.yaml에 박혀 있어 같은 값이어야 한다
  값은 SourceContext(현재 k3d 클러스터)에서 그대로 복사한다. 복구 사본은 Infisical prod:/platform/kubernetes.

.EXAMPLE
  .\infra\vm\Bootstrap-EatbidCluster.ps1 -RepoRoot F:\Project\eat-bid-service
#>
[CmdletBinding()]
param(
  [string]$TargetContext = 'eatbid-vm',
  [string]$SourceContext = 'k3d-eatbid',
  [string]$ArgoCdVersion = 'v3.5.1',
  [Parameter(Mandatory = $true)][string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Copy-Secret([string]$Namespace, [string]$Name) {
  if (kubectl --context $TargetContext -n $Namespace get secret $Name -o name 2>$null) {
    Write-Host "secret $Namespace/$Name 이미 있음"; return
  }
  $json = kubectl --context $SourceContext -n $Namespace get secret $Name -o json | ConvertFrom-Json
  $clean = [ordered]@{
    apiVersion = 'v1'; kind = 'Secret'; type = $json.type
    metadata = [ordered]@{ name = $Name; namespace = $Namespace; labels = $json.metadata.labels }
    data = $json.data
  }
  ($clean | ConvertTo-Json -Depth 6) | kubectl --context $TargetContext apply -f - | Out-Null
  Write-Host "secret $Namespace/$Name 복사"
}

kubectl --context $TargetContext get nodes | Out-Null

foreach ($ns in 'argocd', 'eatbid') {
  kubectl --context $TargetContext create namespace $ns --dry-run=client -o yaml | kubectl --context $TargetContext apply -f - | Out-Null
}

# Argo CD는 upstream manifest를 버전 고정으로 설치한다. k3d 클러스터와 같은 v3.5.1이다.
# server-side apply인 이유: applicationsets CRD가 262144바이트 annotation 한도를 넘어 client-side apply가 거부한다.
kubectl --context $TargetContext -n argocd apply --server-side --force-conflicts -f "https://raw.githubusercontent.com/argoproj/argo-cd/$ArgoCdVersion/manifests/install.yaml" | Out-Null
kubectl --context $TargetContext -n argocd rollout status deploy/argocd-server --timeout=600s
kubectl --context $TargetContext -n argocd rollout status deploy/argocd-repo-server --timeout=600s

Copy-Secret -Namespace argocd -Name repo-eatbid
Copy-Secret -Namespace eatbid -Name ghcr-pull
Copy-Secret -Namespace eatbid -Name eatbid-infisical-operator
Copy-Secret -Namespace eatbid -Name cloudflared-creds
# server가 읽는 auth Secret은 InfisicalSecret 선언이 없는 수동 자산이다(옛 클러스터에서 손으로 만들어졌고
# 2026-09-05 부트스트랩에서 server CreateContainerConfigError로 드러났다). Infisical 경로로 옮기는 것은 후속이다.
# `eatbid-share`는 어떤 코드도 읽지 않아 2026-09-10에 계약에서 뺐다(EAT-126).
Copy-Secret -Namespace eatbid -Name eatbid-auth

# migration Job·server·web은 default ServiceAccount로 돌고 manifest에 imagePullSecrets가 없다. 옛 클러스터는 이
# SA를 손으로 패치해 두었고 그것이 미기록 자산이었다. 여기서 같은 패치를 기록된 절차로 남긴다.
# 후속: infra/product manifest가 imagePullSecrets를 직접 선언하면 이 패치는 지운다.
kubectl --context $TargetContext -n eatbid patch serviceaccount default -p '{"imagePullSecrets":[{"name":"ghcr-pull"}]}' | Out-Null

# platform(Argo Workflows·Infisical operator) → product(eatbid) 순서. product는 InfisicalSecret CRD를 쓰므로
# operator가 먼저 있어야 한다. Argo CD가 재시도하므로 순서는 시작 시간만 줄인다.
kubectl --context $TargetContext apply -f (Join-Path $RepoRoot 'infra\platform\infisical-secrets-operator.application.yaml')
kubectl --context $TargetContext apply -f (Join-Path $RepoRoot 'infra\platform\argo-workflows.application.yaml')
# 새 클러스터에서는 eatbid Application의 PreSync hook(migration Job)이 본 동기화가 만들 InfisicalSecret보다
# 먼저 돌아 migrator Secret이 없어 멈춘다. 옛 클러스터는 이전 sync가 남긴 Secret이 있어 드러나지 않던 순서
# 문제다. 그래서 InfisicalSecret 선언을 Application보다 먼저 적용한다. operator가 이미 있어야 하므로 platform
# sync 뒤에 온다. Argo가 같은 manifest를 다시 관리하므로 중복 소유는 아니다.
kubectl --context $TargetContext -n argocd wait application/infisical-secrets-operator --for=jsonpath='{.status.health.status}'=Healthy --timeout=600s | Out-Null
kubectl --context $TargetContext apply -f (Join-Path $RepoRoot 'infra\product\secrets.yaml') | Out-Null

# 같은 순서 문제의 두 번째 얼굴: PreSync migration Job은 DB가 있어야 하는데 postgres Deployment는 본 동기화가
# 만든다. 빈 클러스터에서는 Job이 먼저 돌아 backoff로 실패하고 sync가 멈춘다. 그래서 렌더된 product
# manifest에서 postgres Deployment·Service·PVC만 먼저 적용하고 Ready를 기다린다. 값은 Argo가 관리하는 것과
# 같은 manifest이므로 이후 sync에서 drift가 없다. 근본 해결(migration을 Sync phase + sync-wave로)은 EAT-51.
$rendered = kubectl kustomize (Join-Path $RepoRoot 'infra\product')
$postgresOnly = @()
$current = @()
foreach ($line in ($rendered + '---')) {
  if ($line -eq '---') {
    $doc = $current -join "`n"
    if ($doc -match '(?m)^kind: (Deployment|Service|PersistentVolumeClaim)$' -and $doc -match '(?m)^  name: (postgres|pgdata)$') { $postgresOnly += $doc }
    $current = @()
  } else { $current += $line }
}
if ($postgresOnly.Count -ne 3) { throw "postgres 리소스 셋을 렌더에서 찾지 못했다(찾은 수: $($postgresOnly.Count))" }
($postgresOnly -join "`n---`n") | kubectl --context $TargetContext apply -f - | Out-Null
kubectl --context $TargetContext -n eatbid rollout status deploy/postgres --timeout=600s

kubectl --context $TargetContext apply -f (Join-Path $RepoRoot 'infra\argocd\application.yaml')

# platform Application 둘은 automated 정책이 없다(운영 승인 뒤 수동 sync가 설계). 새 클러스터의 첫 sync는
# 부트스트랩의 일부이므로 여기서 한 번 시작한다. 이후 chart 버전 변경은 승인 뒤 같은 방식으로 sync한다.
foreach ($app in 'infisical-secrets-operator', 'argo-workflows') {
  kubectl --context $TargetContext -n argocd patch application $app --type merge -p '{"operation":{"initiatedBy":{"username":"bootstrap"},"sync":{"prune":true}}}' | Out-Null
}

Write-Host '적용 완료. 동기화 확인: kubectl --context eatbid-vm get application -n argocd'
Write-Host '다음: postgres가 뜨면 Migrate-EatbidPostgres.ps1 로 데이터를 옮기고, 그 뒤 cutover 절차(docs/operations/k3s-hyperv-vm.md)'
