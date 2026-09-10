<#
.SYNOPSIS
  Hyper-V NAT 뒤의 k3s VM API(6443)와 SSH(22)를 호스트 주소로 노출해 다른 PC에서 kubectl·ssh가 붙게 한다(EAT-129).

.DESCRIPTION
  왜 필요한가: VM은 호스트의 내부 스위치 NAT(172.30.0.0/24) 뒤에 있어 호스트 밖에서는 보이지 않는다.
  운영 이전(Bootstrap·Migrate)과 이후 관리는 개발 PC에서 Tailscale로 호스트에 닿아야 하므로, 호스트가
  Windows portproxy로 6443·2222를 VM에 넘긴다. 공인망에는 열지 않는다 — Tailscale(100.64.0.0/10)과
  사설 LAN에서만 허용하는 방화벽 규칙을 함께 만든다. 재실행해도 같은 상태가 된다.

  k3s 인증서는 이 호스트 주소를 SAN에 갖고 있어야 한다(New-EatbidVm.ps1 -ExtraTlsSan).

.EXAMPLE
  .\infra\vm\Expose-EatbidVm.ps1
#>
[CmdletBinding()]
param(
  [string]$VmIp = '172.30.0.10',
  [int]$ApiPort = 6443,
  [int]$SshPort = 2222,
  [string[]]$AllowedRemoteAddresses = @('100.64.0.0/10', '192.168.0.0/16', '10.0.0.0/8')
)

$ErrorActionPreference = 'Stop'

function Ensure-PortProxy([int]$ListenPort, [int]$ConnectPort) {
  $existing = netsh interface portproxy show v4tov4 | Select-String "0\.0\.0\.0\s+$ListenPort\s"
  if ($existing) { netsh interface portproxy delete v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 | Out-Null }
  netsh interface portproxy add v4tov4 listenport=$ListenPort listenaddress=0.0.0.0 connectport=$ConnectPort connectaddress=$VmIp | Out-Null
  Write-Host "portproxy 0.0.0.0:$ListenPort -> ${VmIp}:$ConnectPort"
}

function Ensure-Firewall([string]$Name, [int]$Port) {
  Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -Name $Name -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress $AllowedRemoteAddresses -Action Allow | Out-Null
  Write-Host "firewall $Name : TCP $Port from $($AllowedRemoteAddresses -join ', ')"
}

Ensure-PortProxy -ListenPort $ApiPort -ConnectPort 6443
Ensure-PortProxy -ListenPort $SshPort -ConnectPort 22
Ensure-Firewall -Name 'eatbid-vm-k3s-api' -Port $ApiPort
Ensure-Firewall -Name 'eatbid-vm-ssh' -Port $SshPort
# IP Helper 서비스가 portproxy를 실제로 수행한다. 꺼져 있으면 규칙만 있고 연결이 안 된다.
Set-Service iphlpsvc -StartupType Automatic
Start-Service iphlpsvc
Write-Host '완료. 다른 PC에서: kubectl --server https://<호스트 IP>:6443 ..., ssh -p 2222 eatbid@<호스트 IP>'
