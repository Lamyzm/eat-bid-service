<#
.SYNOPSIS
  VM의 k3s kubeconfig를 가져와 호스트 kubeconfig에 `eatbid-vm` context로 합친다(EAT-50).

.DESCRIPTION
  cloud-init이 끝날 때까지 ssh로 기다린 뒤 /etc/rancher/k3s/k3s.yaml을 받아 server 주소를 VM 고정 IP로
  바꾸고 ~/.kube/eatbid-vm.yaml에 둔다. 기존 context(k3d 등)는 건드리지 않고 KUBECONFIG 병합으로 합친다.
#>
[CmdletBinding()]
param(
  [string]$VmIp = '172.30.0.10',
  [string]$User = 'eatbid',
  [string]$SshKeyPath = "$env:USERPROFILE\.ssh\eatbid-vm",
  [string]$ContextName = 'eatbid-vm',
  # kubeconfig의 server 주소. 같은 호스트에서는 VM IP, 다른 PC에서 쓰려면 호스트의 Tailscale·LAN IP
  # (Expose-EatbidVm.ps1의 portproxy 주소)를 준다. -ExtraTlsSan에 넣은 값이어야 TLS 검증이 통과한다(EAT-129).
  [string]$ServerAddress = '',
  [int]$TimeoutSeconds = 900
)
if (-not $ServerAddress) { $ServerAddress = $VmIp }

$ErrorActionPreference = 'Stop'
$sshArgs = @('-i', $SshKeyPath, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', "$User@$VmIp")

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ($true) {
  $done = ssh @sshArgs 'test -f /var/lib/eatbid-cloud-init-done && echo ready' 2>$null
  if ($done -eq 'ready') { break }
  if ((Get-Date) -gt $deadline) { throw "cloud-init 완료를 $TimeoutSeconds 초 안에 확인하지 못했다" }
  Start-Sleep -Seconds 10
}

$raw = ssh @sshArgs 'sudo cat /etc/rancher/k3s/k3s.yaml'
if (-not $raw) { throw 'k3s.yaml을 읽지 못했다' }
$kubeDir = Join-Path $env:USERPROFILE '.kube'
New-Item -ItemType Directory -Force $kubeDir | Out-Null
$target = Join-Path $kubeDir "$ContextName.yaml"
$content = ($raw -join "`n").Replace('https://127.0.0.1:6443', "https://${ServerAddress}:6443").Replace('name: default', "name: $ContextName").Replace('cluster: default', "cluster: $ContextName").Replace('user: default', "user: $ContextName").Replace('current-context: default', "current-context: $ContextName")
[IO.File]::WriteAllText($target, $content, [Text.UTF8Encoding]::new($false))

$mainConfig = Join-Path $kubeDir 'config'
$env:KUBECONFIG = "$mainConfig;$target"
$merged = kubectl config view --flatten --raw
[IO.File]::WriteAllText($mainConfig, ($merged -join "`n"), [Text.UTF8Encoding]::new($false))
Remove-Item Env:KUBECONFIG
kubectl --context $ContextName get nodes
Write-Host "context $ContextName 준비 완료. 다음: Bootstrap-EatbidCluster.ps1"
