<#
.SYNOPSIS
  eatbid 단일 노드 k3s VM을 Hyper-V에 만든다(EAT-50).

.DESCRIPTION
  왜 스크립트인가: 손으로 만든 VM은 이 기계에만 있는 미기록 자산이 된다. 스위치·NAT·디스크·seed ISO·VM
  설정을 전부 여기서 만들어 새 기계에서도 같은 결과가 나오게 한다. 관리자 PowerShell에서 실행한다.

  단계: (1) 내부 스위치 + 호스트 NAT, (2) Ubuntu cloud 이미지를 VHDX로 변환·확장(Docker의 qemu-img),
  (3) cloud-init NoCloud seed ISO(Docker의 genisoimage), (4) Gen2 VM 생성·자동 시작 설정·기동.
  이미 있는 산출물은 건너뛰어 재실행해도 안전하다. VM이 이미 있으면 멈춘다.

.EXAMPLE
  .\infra\vm\New-EatbidVm.ps1 -SshPublicKeyPath $env:USERPROFILE\.ssh\eatbid-vm.pub
#>
[CmdletBinding()]
param(
  [string]$WorkDir = 'C:\VMs\eatbid',
  [string]$VmName = 'eatbid-k3s',
  [string]$SwitchName = 'eatbid-vm',
  [string]$NatName = 'eatbid-vm-nat',
  [string]$SubnetPrefix = '172.30.0.0/24',
  [string]$GatewayIp = '172.30.0.1',
  [string]$VmIp = '172.30.0.10',
  [int]$Cpu = 4,
  [long]$MemoryBytes = 12GB,
  [long]$DiskBytes = 100GB,
  [string]$K3sVersion = 'v1.35.5+k3s1',
  [string]$CloudImage = 'noble-server-cloudimg-amd64.img',
  # 호스트 밖(다른 PC)에서 kubectl이 붙을 주소. 호스트의 Tailscale IP·LAN IP를 넣으면 k3s 인증서 SAN에
  # 들어가 Expose-EatbidVm.ps1의 portproxy 경유 접속이 TLS 검증을 통과한다(EAT-129).
  [string[]]$ExtraTlsSan = @(),
  # VHDX·seed ISO만 만들고 VM은 만들지 않는다. Docker가 없는 기기(2026-09-10 새 PC는 Docker Desktop이 기동하지
  # 않았다)에서는 산출물을 다른 PC에서 만들어 복사한 뒤 이 스크립트를 다시 돌리면 Docker 없이 VM만 만든다.
  [switch]$ArtifactsOnly,
  [Parameter(Mandatory = $true)][string]$SshPublicKeyPath
)

$ErrorActionPreference = 'Stop'
$cloudInitDir = Join-Path $PSScriptRoot 'cloud-init'
$vhdx = Join-Path $WorkDir "$VmName.vhdx"
$seedIso = Join-Path $WorkDir "$VmName-seed.iso"
$image = Join-Path $WorkDir $CloudImage

function Assert-Admin {
  $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Hyper-V 자원을 만들려면 관리자 PowerShell이 필요하다'
  }
}

function Assert-Docker {
  docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker가 필요하다(qemu-img·genisoimage를 컨테이너로 쓴다)' }
}

function Ensure-Network {
  if (-not (Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue)) {
    New-VMSwitch -Name $SwitchName -SwitchType Internal | Out-Null
    Write-Host "switch $SwitchName 생성"
  }
  $adapter = Get-NetAdapter | Where-Object { $_.Name -like "*($SwitchName)*" } | Select-Object -First 1
  if (-not $adapter) { throw "스위치 $SwitchName 의 호스트 어댑터를 찾지 못했다" }
  if (-not (Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object IPAddress -eq $GatewayIp)) {
    New-NetIPAddress -IPAddress $GatewayIp -PrefixLength 24 -InterfaceIndex $adapter.ifIndex | Out-Null
    Write-Host "호스트 게이트웨이 $GatewayIp 설정"
  }
  if (-not (Get-NetNat -Name $NatName -ErrorAction SilentlyContinue)) {
    New-NetNat -Name $NatName -InternalIPInterfaceAddressPrefix $SubnetPrefix | Out-Null
    Write-Host "NAT $NatName ($SubnetPrefix) 생성"
  }
}

function Ensure-Disk {
  if (Test-Path $vhdx) { Write-Host "디스크 재사용: $vhdx"; return }
  Assert-Docker
  if (-not (Test-Path $image)) { throw "cloud 이미지가 없다: $image (https://cloud-images.ubuntu.com/noble/current/)" }
  # 컨테이너 안 경로는 /work다. Docker Desktop이 C:를 기본 공유하므로 WorkDir는 C: 아래여야 한다.
  docker run --rm -v "${WorkDir}:/work" alpine:3.20 sh -c "apk add --no-cache qemu-img >/dev/null 2>&1 && qemu-img convert -f qcow2 -O vhdx -o subformat=dynamic /work/$CloudImage /work/$VmName.vhdx"
  if ($LASTEXITCODE -ne 0) { throw 'qemu-img 변환 실패' }
  Resize-VHD -Path $vhdx -SizeBytes $DiskBytes
  Write-Host "디스크 생성·확장: $vhdx ($([math]::Round($DiskBytes/1GB))GB)"
}

function Ensure-SeedIso {
  if (Test-Path $seedIso) { Write-Host "seed ISO 재사용: $seedIso"; return }
  Assert-Docker
  $publicKey = (Get-Content $SshPublicKeyPath -Raw).Trim()
  if ($publicKey -notmatch '^ssh-') { throw "ssh 공개키 형식이 아니다: $SshPublicKeyPath" }
  $seedDir = Join-Path $WorkDir 'seed'
  New-Item -ItemType Directory -Force $seedDir | Out-Null
  # cloud-init YAML의 tls-san 목록 항목과 같은 들여쓰기(8칸)로 한 줄씩 붙인다. 비어 있으면 자리표시자만 지운다.
  $extraSan = ($ExtraTlsSan | Where-Object { $_ } | ForEach-Object { "        - $_" }) -join "`n"
  $replacements = @{
    '${SSH_PUBLIC_KEY}' = $publicKey
    '${VM_IP}' = $VmIp
    '${GATEWAY_IP}' = $GatewayIp
    '${K3S_VERSION}' = $K3sVersion
    '${EXTRA_TLS_SAN}' = $extraSan
  }
  foreach ($name in 'user-data', 'meta-data', 'network-config') {
    $content = Get-Content (Join-Path $cloudInitDir $name) -Raw
    foreach ($key in $replacements.Keys) { $content = $content.Replace($key, $replacements[$key]) }
    # cloud-init은 LF만 안전하다. Windows 체크아웃의 CRLF를 여기서 지운다.
    [IO.File]::WriteAllText((Join-Path $seedDir $name), $content.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
  }
  docker run --rm -v "${WorkDir}:/work" alpine:3.20 sh -c "apk add --no-cache cdrkit >/dev/null 2>&1 && genisoimage -quiet -output /work/$VmName-seed.iso -volid cidata -joliet -rock /work/seed"
  if ($LASTEXITCODE -ne 0) { throw 'seed ISO 생성 실패' }
  Write-Host "seed ISO 생성: $seedIso"
}

function New-EatbidVirtualMachine {
  if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) { throw "VM $VmName 이 이미 있다. 다시 만들려면 먼저 Remove-VM 하라" }
  New-VM -Name $VmName -Generation 2 -MemoryStartupBytes $MemoryBytes -VHDPath $vhdx -SwitchName $SwitchName | Out-Null
  Set-VM -Name $VmName -ProcessorCount $Cpu -StaticMemory -CheckpointType Disabled `
    -AutomaticStartAction Start -AutomaticStartDelay 30 -AutomaticStopAction ShutDown
  # Ubuntu cloud 이미지는 UEFI Secure Boot를 Microsoft UEFI CA로 통과한다. 끄지 않는다.
  Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
  Add-VMDvdDrive -VMName $VmName -Path $seedIso
  $disk = Get-VMHardDiskDrive -VMName $VmName
  Set-VMFirmware -VMName $VmName -FirstBootDevice $disk
  Start-VM -Name $VmName
  Write-Host "VM $VmName 기동. cloud-init이 k3s $K3sVersion 을 설치한다(수 분). 다음: Get-EatbidVmKubeconfig.ps1"
}

Assert-Admin
New-Item -ItemType Directory -Force $WorkDir | Out-Null
# Docker는 산출물이 없을 때만 필요하다(Ensure-Disk·Ensure-SeedIso 안에서 검사).
Ensure-Disk
Ensure-SeedIso
if ($ArtifactsOnly) { Write-Host "산출물만 만들었다: $vhdx, $seedIso. 대상 PC의 WorkDir로 복사한 뒤 같은 인자로 다시 실행한다"; return }
Ensure-Network
# 함수 이름은 Hyper-V cmdlet(New-VM)과 대소문자만 다르면 자기 재귀가 되므로 반드시 구분되는 이름을 쓴다.
New-EatbidVirtualMachine
