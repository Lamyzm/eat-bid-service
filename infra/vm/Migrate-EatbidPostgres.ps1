<#
.SYNOPSIS
  운영 postgres를 새 클러스터로 옮긴다(EAT-50, EAT-322에서 방식 개정).

.DESCRIPTION
  새 호스트에서 PowerShell 7(pwsh)로 실행한다. 역할은 pg_dumpall --globals-only로, 데이터는 우리 스키마만 pg_dump
  사용자 지정 형식(-Fc)으로 옮긴다. 이어서 pg_restore -j로 병렬 복원하고 ANALYZE한 뒤 표별 정확한 행 수를 대조한다.
  `-ReplaceSchemas`는 대상의 같은 스키마를 먼저 지운다. cutover 직전에 사용자 작성 상태(`app`)만 다시 맞출 때 쓴다.

  왜 평문 pg_dumpall이 아닌가: DB가 41GB가 되면(2026-10-10) 평문 SQL 복원은 표와 색인을 하나씩 다시 만들어 몇
  시간이 걸린다. 사용자 지정 형식은 압축되고 pg_restore가 병렬로 세운다. 덤프는 원본 파드 안에 파일로 쓴다. 파이프로
  받은 사용자 지정 형식에는 데이터 위치가 없어 병렬 복원이 블록을 찾지 못한다.
  왜 대상 쪽은 kubectl exec 입력을 쓰지 않는가: 2026-10-10 새 클러스터(k3s v1.35.5)에서 `kubectl exec -i`로 넣은
  1MB·64MB·7GB가 종료 코드 0인 채 다른 내용으로 도착했다. VM 안의 리눅스 kubectl도 같았다. 원본 쪽 출력 방향은
  7GB가 해시까지 맞았다. 그래서 대상 쪽은 scp로 VM에 보내고, 같은 파일시스템인 pgdata 볼륨 디렉터리로 옮겨
  파드가 그 경로를 읽게 한다. pgdata는 PGDATA 자체라 파일은 `zz-restore-` 접두사로 두고 끝나면 지운다.
  왜 우리 스키마만인가: 레거시 public 18표는 R2에 보관됐고, 우리 스키마의 어떤 열 타입·FK·뷰·코드도 참조하지
  않는다(2026-10-09 판단, 2026-10-10 확인).
  왜 새 호스트인가: 원본 출력은 실행 PC를 거친다. 두 호스트가 같은 LAN이면 그 길이 가장 짧다.

  전제: 호스트에서 VM으로 비밀번호 없는 ssh(`-VmSshKeyPath`)가 된다. 원본 클러스터에 실행 중인 workflow가 없다.
  진행 중인 run을 덤프하면 새 클러스터에서 아무도 닫지 않는 run으로 남는다(docs/operations/k3s-hyperv-vm.md §4).

.EXAMPLE
  pwsh -File .\infra\vm\Migrate-EatbidPostgres.ps1
  pwsh -File .\infra\vm\Migrate-EatbidPostgres.ps1 -Schemas app -ReplaceSchemas -SkipGlobals
#>
[CmdletBinding()]
param(
  [string]$SourceContext = 'eatbid-prod',
  [string]$TargetContext = 'eatbid-next',
  [string]$Namespace = 'eatbid',
  [string]$DatabaseUser = 'eatbid',
  [string]$Database = 'eatbid',
  [string[]]$Schemas = @('core', 'ingest', 'mart', 'app', 'monitoring', 'drizzle'),
  [switch]$ReplaceSchemas,
  [switch]$SkipGlobals,
  [int]$Jobs = 8,
  [string]$WorkDir = 'C:\VMs\eatbid',
  [string]$VmAddress = '172.30.0.10',
  [string]$VmUser = 'eatbid',
  [string]$VmSshKeyPath = "$env:USERPROFILE\.ssh\eatbid-vm-host"
)

$ErrorActionPreference = 'Stop'
$sshArgs = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i', $VmSshKeyPath)
$podDataDir = '/var/lib/postgresql/data'
function Write-Step([string]$Message) { Write-Host ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) }
function Get-PostgresPod([string]$Context) {
  kubectl --context $Context -n $Namespace get pods -l app=postgres --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}'
}
function Invoke-Vm([string]$Command) {
  & ssh.exe @sshArgs "$VmUser@$VmAddress" $Command
  if ($LASTEXITCODE -ne 0) { throw "VM 명령 실패(exit=$LASTEXITCODE): $Command" }
}
# 파일을 원본 파드에서 꺼내 대상 파드의 PGDATA에 놓는다. 꺼내기는 kubectl 출력, 넣기는 scp + 같은 파일시스템 mv다.
function Copy-ToTargetPod([string]$SourcePod, [string]$SourcePath, [string]$Name, [string]$ExpectedSha) {
  $hostFile = Join-Path $WorkDir $Name
  cmd.exe /c "kubectl --context $SourceContext -n $Namespace exec $SourcePod -- cat $SourcePath > ""$hostFile"""
  if ($LASTEXITCODE -ne 0) { throw "원본에서 꺼내기 실패: $SourcePath" }
  $hostSha = (Get-FileHash $hostFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ExpectedSha -and $hostSha -ne $ExpectedSha) { throw "호스트 사본 해시가 다르다($hostSha)" }
  & scp.exe @sshArgs $hostFile "${VmUser}@${VmAddress}:/var/tmp/$Name"
  if ($LASTEXITCODE -ne 0) { throw "VM으로 scp 실패: $Name" }
  Invoke-Vm "set -e; d=`$(sudo sh -c 'ls -d /var/lib/rancher/k3s/storage/*_${Namespace}_pgdata'); sudo mv /var/tmp/$Name `"`$d/zz-restore-$Name`"; sudo chmod 644 `"`$d/zz-restore-$Name`""
  $podSha = ((kubectl --context $TargetContext -n $Namespace exec $targetPod -- sha256sum "$podDataDir/zz-restore-$Name") -split '\s+')[0]
  if ($podSha -ne $hostSha) { throw "대상 파드의 해시가 다르다(host=$hostSha pod=$podSha)" }
  Remove-Item $hostFile
  return "$podDataDir/zz-restore-$Name"
}
function Get-RowCounts([string]$Context, [string]$Pod) {
  $schemaList = ($Schemas | ForEach-Object { "'$_'" }) -join ','
  $query = "select string_agg(format('select %L, count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' union all ' order by schemaname, tablename) from pg_tables where schemaname in ($schemaList)"
  $unionSql = kubectl --context $Context -n $Namespace exec $Pod -- psql -U $DatabaseUser -d $Database -At -c $query
  kubectl --context $Context -n $Namespace exec $Pod -- psql -U $DatabaseUser -d $Database -At -F '|' -c "$unionSql order by 1"
  if ($LASTEXITCODE -ne 0) { throw "행 수 조회 실패($Context)" }
}

$running = kubectl --context $SourceContext -n $Namespace get wf -l workflows.argoproj.io/phase=Running -o name
if ($running) { throw "원본 클러스터에 실행 중인 workflow가 있다. 끝난 뒤 다시 실행한다: $($running -join ', ')" }
$sourcePod = Get-PostgresPod $SourceContext
$targetPod = Get-PostgresPod $TargetContext
if (-not $sourcePod -or -not $targetPod) { throw "postgres pod를 찾지 못했다(source=$sourcePod target=$targetPod)" }
New-Item -ItemType Directory -Force $WorkDir | Out-Null
Write-Step "source=$SourceContext/$sourcePod target=$TargetContext/$targetPod schemas=$($Schemas -join ',')"

if (-not $SkipGlobals) {
  # 역할과 비밀번호가 먼저 있어야 소유자·권한이 복원된다. 대상의 POSTGRES_USER는 이미 있어 그 CREATE ROLE은 실패가 정상이다.
  kubectl --context $SourceContext -n $Namespace exec $sourcePod -- sh -c "pg_dumpall -U $DatabaseUser --globals-only > /tmp/eatbid-globals.sql"
  $globalsPath = Copy-ToTargetPod $sourcePod '/tmp/eatbid-globals.sql' 'eatbid-globals.sql' ''
  $globalsLog = kubectl --context $TargetContext -n $Namespace exec $targetPod -- psql -U $DatabaseUser -d postgres -v ON_ERROR_STOP=0 -q -f $globalsPath 2>&1
  $roleErrors = $globalsLog | Where-Object { $_ -match 'ERROR' -and $_ -notmatch 'already exists' }
  if ($roleErrors) { $roleErrors | Write-Host; throw '역할 복원에 예상 밖 오류가 있다' }
  Write-Step '역할 복원 완료'

  # 데이터베이스 단위 권한(CONNECT·CREATE)은 globals에도, 스키마만 뜬 덤프에도 실리지 않는다. 2026-10-10 이전에서
  # 이것이 빠졌다. 그래서 migration Job이 `CREATE SCHEMA IF NOT EXISTS "drizzle"`에서 권한 거부로 멈췄고 사이트가
  # 12분 503이었다. 원본의 datacl을 그대로 옮기고 문자열로 대조한다. datacl이 NULL(기본값)이면 옮길 것이 없다.
  $aclQuery = "select string_agg(stmt, ' ' order by ord) from (select 0 as ord, format('REVOKE ALL ON DATABASE %I FROM PUBLIC;', d.datname) as stmt from pg_database d where d.datname = current_database() and d.datacl is not null union all select 1, format('GRANT %s ON DATABASE %I TO %s;', a.privilege_type, d.datname, case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end) from pg_database d cross join lateral aclexplode(d.datacl) a where d.datname = current_database() and a.grantee <> d.datdba) s"
  $aclStatements = kubectl --context $SourceContext -n $Namespace exec $sourcePod -- psql -U $DatabaseUser -d $Database -At -c $aclQuery
  if ($aclStatements) {
    kubectl --context $TargetContext -n $Namespace exec $targetPod -- psql -U $DatabaseUser -d postgres -v ON_ERROR_STOP=1 -q -c $aclStatements
    if ($LASTEXITCODE -ne 0) { throw '데이터베이스 권한 복원 실패' }
  }
  # datacl 문자열은 GRANT 순서를 따라 항목 순서가 바뀐다. 그래서 (대상, 권한, 위임 가능)을 정렬해 비교한다.
  $aclCheck = "select coalesce(string_agg(x, ',' order by x), '') from (select format('%s:%s:%s', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type, a.is_grantable) as x from pg_database d cross join lateral aclexplode(d.datacl) a where d.datname = '$Database') s"
  $sourceAcl = kubectl --context $SourceContext -n $Namespace exec $sourcePod -- psql -U $DatabaseUser -d postgres -At -c $aclCheck
  $targetAcl = kubectl --context $TargetContext -n $Namespace exec $targetPod -- psql -U $DatabaseUser -d postgres -At -c $aclCheck
  if ($sourceAcl -ne $targetAcl) { throw "데이터베이스 권한이 다르다(source=$sourceAcl target=$targetAcl)" }
  Write-Step "데이터베이스 권한 일치 $targetAcl"
}

$schemaArgs = ($Schemas | ForEach-Object { "-n $_" }) -join ' '
Write-Step '덤프'
kubectl --context $SourceContext -n $Namespace exec $sourcePod -- sh -c "rm -f /tmp/eatbid.dump && pg_dump -U $DatabaseUser -d $Database -Fc $schemaArgs -f /tmp/eatbid.dump && ls -l /tmp/eatbid.dump"
if ($LASTEXITCODE -ne 0) { throw "pg_dump 실패(exit=$LASTEXITCODE)" }
$sourceSha = ((kubectl --context $SourceContext -n $Namespace exec $sourcePod -- sha256sum /tmp/eatbid.dump) -split '\s+')[0]
Write-Step '복사'
$dumpPath = Copy-ToTargetPod $sourcePod '/tmp/eatbid.dump' 'eatbid.dump' $sourceSha
Write-Step "sha256 일치 $sourceSha"

if ($ReplaceSchemas) {
  $drop = ($Schemas | ForEach-Object { "drop schema if exists $_ cascade;" }) -join ' '
  kubectl --context $TargetContext -n $Namespace exec $targetPod -- psql -U $DatabaseUser -d $Database -v ON_ERROR_STOP=1 -q -c $drop
  if ($LASTEXITCODE -ne 0) { throw '대상 스키마 삭제 실패' }
  Write-Step "대상 스키마를 지웠다: $($Schemas -join ',')"
}

Write-Step "복원: pg_restore -j $Jobs"
kubectl --context $TargetContext -n $Namespace exec $targetPod -- sh -c "pg_restore -U $DatabaseUser -d $Database -j $Jobs $dumpPath > /tmp/eatbid-restore.log 2>&1; echo restore-exit=`$?; tail -3 /tmp/eatbid-restore.log"
$restoreErrors = kubectl --context $TargetContext -n $Namespace exec $targetPod -- sh -c "grep -c 'pg_restore: error' /tmp/eatbid-restore.log || true"
if ([int]$restoreErrors -gt 0) { throw "pg_restore 오류 $restoreErrors 건. 대상 파드의 /tmp/eatbid-restore.log를 본다" }

# pg_restore는 통계를 만들지 않는다. 비우면 첫 조회들이 잘못된 실행 계획을 탄다.
Write-Step 'ANALYZE'
kubectl --context $TargetContext -n $Namespace exec $targetPod -- vacuumdb -U $DatabaseUser -d $Database --analyze-only -j $Jobs -q
if ($LASTEXITCODE -ne 0) { throw "vacuumdb --analyze-only 실패(exit=$LASTEXITCODE)" }

Write-Step '표별 행 수 대조'
$sourceCounts = Get-RowCounts $SourceContext $sourcePod
$targetCounts = Get-RowCounts $TargetContext $targetPod
$sourceCounts | Set-Content (Join-Path $WorkDir "rowcounts-$($Schemas -join '-').txt")
$diff = Compare-Object $sourceCounts $targetCounts
if ($diff) { $diff | Format-Table -AutoSize | Out-String | Write-Host; throw '행 수가 다른 표가 있다' }
Write-Step ("행 수 일치: 표 {0}개" -f $sourceCounts.Count)

kubectl --context $SourceContext -n $Namespace exec $sourcePod -- rm -f /tmp/eatbid.dump /tmp/eatbid-globals.sql
kubectl --context $TargetContext -n $Namespace exec $targetPod -- sh -c "rm -f $podDataDir/zz-restore-*"
Write-Step '완료. 다음: docs/operations/k3s-hyperv-vm.md §5 cutover'
