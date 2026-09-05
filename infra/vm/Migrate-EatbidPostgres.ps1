<#
.SYNOPSIS
  k3d 클러스터의 postgres를 VM 클러스터의 postgres로 옮긴다(EAT-50).

.DESCRIPTION
  pg_dumpall(역할 포함) → 파일 → 대상에서 psql 복원. 대상 postgres는 Argo가 만든 Deployment이며 Infisical
  prod:/runtime/postgres의 값으로 기동한다. 복원은 superuser(POSTGRES_USER)로 하므로 eatbid_api·
  migrator·dataplane 역할과 권한(EAT-49 수동 grant 포함)이 그대로 따라온다.
  두 클러스터가 동시에 서비스하는 cutover 창에서는 마지막에 한 번 더 돌려 차이를 없앤다.
#>
[CmdletBinding()]
param(
  [string]$SourceContext = 'k3d-eatbid',
  [string]$TargetContext = 'eatbid-vm',
  [string]$Namespace = 'eatbid',
  [string]$DumpPath = 'C:\VMs\eatbid\eatbid-pg-dumpall.sql'
)

$ErrorActionPreference = 'Stop'

kubectl --context $TargetContext -n $Namespace rollout status deploy/postgres --timeout=600s

$sourcePod = kubectl --context $SourceContext -n $Namespace get pods -l app=postgres --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}'
$targetPod = kubectl --context $TargetContext -n $Namespace get pods -l app=postgres --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}'
if (-not $sourcePod -or -not $targetPod) { throw "postgres pod를 찾지 못했다(source=$sourcePod target=$targetPod)" }

Write-Host "dump: $SourceContext/$sourcePod → $DumpPath"
kubectl --context $SourceContext -n $Namespace exec $sourcePod -- sh -c 'pg_dumpall -U "$POSTGRES_USER" --clean --if-exists' | Set-Content -Path $DumpPath -Encoding utf8
$size = (Get-Item $DumpPath).Length
if ($size -lt 1MB) { throw "덤프가 너무 작다($size bytes)" }

Write-Host "restore: $TargetContext/$targetPod"
Get-Content $DumpPath -Raw | kubectl --context $TargetContext -n $Namespace exec -i $targetPod -- sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=0 -q' | Out-Null

$check = 'select (select count(*) from public.school_auctions) as school_auctions, (select count(*) from core.auction_attempt) as auction_attempt'
Write-Host 'source:'; kubectl --context $SourceContext -n $Namespace exec $sourcePod -- sh -c "psql -U `"`$POSTGRES_USER`" -d eatbid -At -c `"$check`""
Write-Host 'target:'; kubectl --context $TargetContext -n $Namespace exec $targetPod -- sh -c "psql -U `"`$POSTGRES_USER`" -d eatbid -At -c `"$check`""
