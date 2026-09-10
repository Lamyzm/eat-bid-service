<#
.SYNOPSIS
  Argo CD가 스스로 만들 수 없는 수동 Secret을 클러스터에서 읽어 Infisical prod:/platform/kubernetes에 복구 사본으로 둔다(EAT-127).

.DESCRIPTION
  왜 필요한가: 2026-09-10 실측에서 prod:/platform/kubernetes에는 INFISICAL_CLIENT_ID/SECRET 둘뿐이었다. 나머지
  수동 Secret(argocd/repo-eatbid, ghcr-pull, cloudflared-creds, eatbid-auth)은 운영 VM 안에만 있어 VM이 죽으면
  새 클러스터를 세울 수 없었다. Bootstrap-EatbidCluster.ps1이 source 클러스터 없이도 이 사본에서 Secret을
  다시 만들 수 있게 여기서 값을 올린다.

  저장 형식: Infisical secret 이름 K8S_SECRET_<NAMESPACE>_<NAME>(대문자, '-'는 '_'), 값은 정리된 Secret
  manifest(JSON: apiVersion·kind·type·metadata.name/namespace/labels·data)의 base64. base64 한 덩어리로 두는
  이유는 CLI 인자로 JSON 따옴표를 안전하게 넘기기 어렵고, 복원 쪽은 decode 뒤 kubectl apply만 하면 되기 때문이다.

  목록은 main의 manifest가 실제로 요구하는 Secret만 담는다. eatbid-share는 EAT-126이 2026-09-10 계약에서 뺐으므로
  여기서도 뺐다. Infisical에 남은 K8S_SECRET_EATBID_EATBID_SHARE 사본은 복원 대상이 아니며 지워도 된다.

.EXAMPLE
  .\infra\vm\Export-EatbidManualSecrets.ps1 -SourceContext eatbid-vm
#>
[CmdletBinding()]
param(
  [string]$SourceContext = 'eatbid-vm',
  [string]$ProjectId = '0d794ce1-e0e3-4e48-83ea-88f2f05f9a65',
  [string]$Environment = 'prod',
  [string]$SecretsPath = '/platform/kubernetes'
)

$ErrorActionPreference = 'Stop'

$manual = @(
  @{ Namespace = 'argocd'; Name = 'repo-eatbid' },
  @{ Namespace = 'eatbid'; Name = 'ghcr-pull' },
  @{ Namespace = 'eatbid'; Name = 'cloudflared-creds' },
  @{ Namespace = 'eatbid'; Name = 'eatbid-auth' }
)

foreach ($item in $manual) {
  $json = kubectl --context $SourceContext -n $item.Namespace get secret $item.Name -o json | ConvertFrom-Json
  $clean = [ordered]@{
    apiVersion = 'v1'; kind = 'Secret'; type = $json.type
    metadata = [ordered]@{ name = $item.Name; namespace = $item.Namespace; labels = $json.metadata.labels }
    data = $json.data
  }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($clean | ConvertTo-Json -Depth 6 -Compress)))
  $key = ('K8S_SECRET_{0}_{1}' -f $item.Namespace, $item.Name).ToUpperInvariant().Replace('-', '_')
  # 값은 화면에 찍지 않는다. 길이만 남겨 무엇이 올라갔는지 확인한다.
  infisical secrets set "$key=$encoded" --env=$Environment --path=$SecretsPath --projectId $ProjectId | Out-Null
  Write-Host ("{0} <- {1}/{2} ({3} bytes)" -f $key, $item.Namespace, $item.Name, $encoded.Length)
}

Write-Host "완료. 확인: infisical secrets --env=$Environment --path=$SecretsPath --projectId $ProjectId"
