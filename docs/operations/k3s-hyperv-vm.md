---
id: K3S-HYPERV-VM
status: active
canonical_for: always-on-single-node-cluster-host
last_reviewed: 2026-09-05
review_trigger: cluster-host-or-k3s-version-change
---

# 항상 켜진 클러스터 — Hyper-V Ubuntu VM의 k3s runbook

## 1. 결론

운영 클러스터는 이 PC의 Hyper-V VM `eatbid-k3s`(Ubuntu 24.04, 단일 노드 k3s)다. Docker Desktop의 k3d는
로그인 세션에 묶여 재부팅·로그아웃마다 클러스터가 죽고, 그 동안 Argo CD 배포·Argo Workflows 수집·
cloudflared 터널(사이트)이 전부 멈춘다. CI(GitHub Actions)는 영향이 없지만 CD와 24시간 수집은 항상
켜진 클러스터가 전제다(EAT-50, 사용자 결정 2026-09-04).

VM은 호스트 부팅 시 자동 시작되고 k3s는 systemd 서비스라 로그인이 필요 없다. 남는 한계는 PC가 켜져
있어야 한다는 것뿐이며, 별도 머신으로 갈 때는 VM 이미지를 그대로 옮긴다.

| 항목 | 값 |
| -- | -- |
| VM | `eatbid-k3s`, Gen2, 4 vCPU, 12GB 고정, 100GB 동적 VHDX |
| 네트워크 | 내부 스위치 `eatbid-vm` + 호스트 NAT `eatbid-vm-nat`(172.30.0.0/24), VM 고정 IP 172.30.0.10, 게이트웨이 172.30.0.1 |
| k3s | `v1.35.5+k3s1`(k3d와 동일), traefik·servicelb 기본값 유지, tls-san 172.30.0.10 |
| 접속 | `ssh -i ~/.ssh/eatbid-vm eatbid@172.30.0.10`, kubectl context `eatbid-vm` |
| 산출물 위치 | `C:\VMs\eatbid\`(cloud 이미지, VHDX, seed ISO, 덤프) |

## 2. 만들기 (관리자 PowerShell, 저장소 루트에서)

```powershell
# PowerShell에서 -N '""'는 빈 passphrase가 아니라 문자 ""를 passphrase로 넘긴다(2026-09-05 실수). -N ""가 맞다.
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\eatbid-vm -N "" -C eatbid-vm
curl.exe -L -o C:\VMs\eatbid\noble-server-cloudimg-amd64.img https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
.\infra\vm\New-EatbidVm.ps1 -SshPublicKeyPath $env:USERPROFILE\.ssh\eatbid-vm.pub
.\infra\vm\Get-EatbidVmKubeconfig.ps1
```

`New-EatbidVm.ps1`은 스위치·NAT·디스크·seed ISO를 이미 있으면 재사용하고 VM이 있으면 멈춘다. 이미지
변환(qemu-img)과 seed ISO(genisoimage)는 Docker 컨테이너(`alpine:3.20`)로 만든다. cloud-init 템플릿은
`infra/vm/cloud-init/`이고 `${SSH_PUBLIC_KEY}`·`${VM_IP}`·`${GATEWAY_IP}`·`${K3S_VERSION}`을 스크립트가
치환한다.

### 2.1 다른 PC에 세울 때 (EAT-129, 2026-09-10)

옛 클러스터와 새 VM이 서로 다른 PC에 있으면 각 VM은 자기 호스트의 NAT 뒤라 서로 보이지 않는다. 관리
트래픽은 Tailscale로 호스트에 닿고, 호스트가 portproxy로 VM에 넘긴다. 공개 트래픽은 여전히 Cloudflare
Tunnel이며 이 절과 무관하다.

호스트의 Tailscale IP·LAN IP·호스트명·ssh 계정은 이 저장소에 적지 않는다. 저장소가 공개라 한 번 적히면 되돌릴 수
없고, 그 값들은 절차를 이해하는 데 필요하지 않다(EAT-191). 실제 값은 운영자가 Infisical이나 개인 메모에서 읽어
아래 `<...>` 자리에 넣는다.

새 PC(관리자 PowerShell, `infra/vm`만 복사해도 된다):

```powershell
# 호스트의 Tailscale IP와 LAN IP를 인증서 SAN에 넣는다. 나중에 바꾸려면 VM을 다시 만든다.
.\infra\vm\New-EatbidVm.ps1 -SshPublicKeyPath C:\Users\<user>\.ssh\eatbid-vm.pub -ExtraTlsSan <호스트 Tailscale IP>,<호스트 LAN IP>
.\infra\vm\Get-EatbidVmKubeconfig.ps1 -ContextName eatbid-prod -ServerAddress <호스트 Tailscale IP>
.\infra\vm\Expose-EatbidVm.ps1        # 0.0.0.0:6443→VM:6443, 0.0.0.0:2222→VM:22, Tailscale·사설 LAN만 허용
```

새 PC에 Docker가 없거나 기동하지 않으면(2026-09-10 실측) VHDX·seed ISO를 Docker가 있는 PC에서 만들어
복사한다. 같은 인자에 `-ArtifactsOnly`를 붙여 `-WorkDir`에 산출물만 만들고, 두 파일을 새 PC의 `C:\VMs\eatbid`로
`scp`한 뒤 새 PC에서 같은 명령을 `-ArtifactsOnly` 없이 실행하면 Docker 검사 없이 VM만 만든다. 공개키는 새
PC의 것을 써야 그 PC에서 VM에 ssh가 된다. Docker Desktop이 깔려만 있고 기동에 실패한 상태면
`com.docker.backend`가 메모리 10GB 넘게 물고 VM 시작이 `0x800705AA`로 거부된다(2026-09-10 실측 13.7GB).
운영 PC에서는 Docker Desktop을 지우거나 서비스·자동 시작을 끈다.

개발 PC(Tailscale 같은 계정): 새 PC의 `~/.kube/eatbid-prod.yaml`을 받아 `KUBECONFIG` 병합으로 합치고
`kubectl --context eatbid-prod get nodes`가 TLS 검증을 통과하면 3절부터는 개발 PC에서 `-TargetContext
eatbid-prod`로 진행한다. VM에 직접 ssh는 `ssh -p 2222 -i ~/.ssh/eatbid-vm eatbid@<호스트 IP>`이며 키는 VM을
만들 때 넣은 공개키의 짝이어야 한다.

Windows 기본 OpenSSH 서버가 구버전이라 동작하지 않는 기기가 있었다(2026-09-10 운영 PC). 그 경우
winget의 최신 OpenSSH나 다른 sshd를 쓰고 기본 기능은 다시 켜지 않는다. Tailscale은 `--unattended`로 붙여
로그인 없이도 터널이 살아 있게 한다.

## 3. 부트스트랩

```powershell
.\infra\vm\Bootstrap-EatbidCluster.ps1 -RepoRoot (Get-Location).Path
kubectl --context eatbid-vm get application -n argocd
```

Argo CD `v3.5.1`을 upstream manifest로 설치하고, Argo가 스스로 만들 수 없는 수동 Secret 다섯
(`argocd/repo-eatbid`, `ghcr-pull`, `eatbid-infisical-operator`, `cloudflared-creds`, `eatbid-auth`)을
옛 클러스터에서 복사한 뒤 `infra/platform`·`infra/argocd`의 Application 셋을 적용한다.
나머지는 Argo CD가 `main`의 `infra/product`로 세운다. 이유는 스크립트 머리말에 있다.

옛 클러스터가 없을 때(재해 복구)는 `-FromInfisical`로 Infisical `prod:/platform/kubernetes`의 복구 사본에서
다시 만든다. 사본은 `Export-EatbidManualSecrets.ps1`이 올리며 2026-09-10 이전에는 이 경로에
`INFISICAL_CLIENT_ID/SECRET` 둘만 있었다(EAT-127). 사본 형식은 `K8S_SECRET_<NS>_<NAME>` = 정리된 Secret
manifest JSON의 base64이고, `eatbid-infisical-operator`는 두 identity 값으로 조립한다. Secret 값을 회전하면
Export를 다시 돌린다.

postgres는 Infisical `prod:/runtime/postgres`(`POSTGRES_USER`·`POSTGRES_PASSWORD`·`POSTGRES_DB=eatbid`)가
있어야 뜬다. 운영자 identity는 읽기 전용이라 이 폴더는 사용자가 만든다. 값은 옛 클러스터와 같은
`eatbid` 사용자여야 덤프 복원 뒤 역할이 맞는다.

권한은 더 이상 사람이 psql로 넣지 않는다. `eatbid-db-provisioning` hook Job이 sync-wave 2에서
`infra/product/db-provisioning.sql`을 실행해 `eatbid_api`·`eatbid_dataplane`의 권한을 매 sync마다
같은 상태로 세운다(wave 0 postgres·Secret·ConfigMap → 1 migration → 2 provisioning → 3 server·web).
사람이 하는 일은 **역할 셋을 만드는 것 하나**뿐이다. 빈 데이터베이스로 시작한다면 4절의 덤프 복원
대신 superuser로 `eatbid_migrator`·`eatbid_api`·`eatbid_dataplane`을
`CREATE ROLE ... LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`으로 만들고
그 비밀번호를 Infisical `prod:/runtime/migrator`·`/runtime/server`·`/runtime/dataplane`의
`DATABASE_URL`과 맞춘다. 절차 전체는 [`infra/product/secret-contract.md`](../../infra/product/secret-contract.md)에 있다.

## 4. 데이터 이전

```powershell
.\infra\vm\Migrate-EatbidPostgres.ps1
```

`pg_dumpall --clean --if-exists`로 역할과 비밀번호까지 옮기고 두 쪽의 행 수를 나란히 찍는다. 원본
레이크는 R2가 권위라 옮기지 않는다. 덤프에 실린 권한은 이제 참고값일 뿐이고, 복원 뒤 첫 sync에서
provisioning Job이 저장소의 상태로 다시 세운다.

## 5. cutover (사용자 확인 뒤)

cloudflared는 같은 터널 자격증명으로 두 클러스터에서 동시에 붙을 수 있다. 그래서 순서는 "겹쳐 켜고 →
확인하고 → 옛 것을 끈다"이며 중단 창이 없다.

0. 4절 이전이 끝난 뒤에야 새 클러스터의 자동 sync를 켠다. 부트스트랩은 `eatbid` Application을 syncPolicy 없이
   적용해 두므로 여기서 원본을 다시 적용한다: `kubectl --context <새 context> apply -f infra/argocd/application.yaml`.
   순서를 바꿔 automated로 먼저 적용하면 cloudflared가 server·web보다 먼저 떠서 같은 터널의 요청 일부가 빈
   클러스터로 가 503이 난다(2026-09-10 실측, EAT-129).
1. VM의 `cloudflared`·`server`·`web`이 Ready인지 확인한다: `kubectl --context eatbid-vm get pods -n eatbid`.
2. eatbid.net을 몇 번 호출해 두 클러스터가 번갈아 응답하는지, 오류가 없는지 본다.
3. 마지막 덤프·복원을 한 번 더 돌린다(4절). 이 시점부터 옛 클러스터에는 쓰지 않는다.
4. 옛 클러스터를 내린다. 순서는 자동 sync 해제 → 수집 CronWorkflow suspend → 실행 중 Workflow 종료 →
   cloudflared 0이다. 수집을 먼저 멈추지 않으면 겹쳐 켜진 동안 두 DB가 갈린다(2026-09-10 실측: 18:30 회차 직전).
   ```powershell
   kubectl --context <옛> -n argocd patch application eatbid --type merge -p '{"spec":{"syncPolicy":null}}'
   kubectl --context <옛> -n eatbid patch cronwf eatbid-poll-open --type merge -p '{"spec":{"suspend":true}}'
   kubectl --context <옛> -n eatbid patch cronwf eatbid-daily-reconcile --type merge -p '{"spec":{"suspend":true}}'
   kubectl --context <옛> -n eatbid patch wf <실행 중> --type merge -p '{"spec":{"shutdown":"Terminate"}}'
   kubectl --context <옛> -n eatbid scale deploy/cloudflared --replicas=0
   ```
   그 뒤 새 클러스터에 0번의 automated Application을 적용한다. 새 클러스터에 부트스트랩 뒤 수동으로 넣은
   CronWorkflow suspend는 이 sync가 Git 값(false)으로 되돌려 수집이 새 클러스터에서 재개된다.
5. 새 호스트를 재부팅해 로그인 없이 `kubectl --context <새> get application -n argocd`가 Synced·Healthy이고
   eatbid.net이 응답하는지 확인한다. 이것이 수용 기준이다(2026-09-10 새 PC: 노드 Ready 186초, 전체 복구 188초).
6. 다음 release tag로 build → 승격 커밋 → Argo sync가 사람 없이 끝나는 것을 확인한다. 옛 VM은 지우지 않고
   dev로 전환한다(EAT-130). 개발 PC에서 백필 운영 루프를 쓰고 있었다면 그 스크립트의 kubectl context를
   새 클러스터로 바꿔 다시 띄운다.

되돌리기: 6 이전이면 옛 클러스터의 cloudflared replicas를 1로 올리고 VM의 cloudflared를 0으로 내린다.

## 6. 운영 함정

- VM IP는 고정이지만 호스트 NAT(`eatbid-vm-nat`)가 사라지면 VM이 밖으로 못 나간다. `Get-NetNat`로 확인하고
  없으면 `New-EatbidVm.ps1`을 다시 돌린다(NAT만 다시 만든다).
- k3s 버전을 올리는 것은 별도 결정이다. cloud-init의 `${K3S_VERSION}`은 만들 때만 쓰이고 그 뒤는 VM 안에서
  `INSTALL_K3S_VERSION`으로 다시 설치한다.
- Docker Desktop은 이제 개발 도구일 뿐이다. 꺼져 있어도 운영에 영향이 없어야 하며, 있다면 이 문서가
  틀린 것이다.
