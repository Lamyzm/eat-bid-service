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

1. VM의 `cloudflared`·`server`·`web`이 Ready인지 확인한다: `kubectl --context eatbid-vm get pods -n eatbid`.
2. eatbid.net을 몇 번 호출해 두 클러스터가 번갈아 응답하는지, 오류가 없는지 본다.
3. 마지막 덤프·복원을 한 번 더 돌린다(4절). 이 시점부터 옛 클러스터에는 쓰지 않는다.
4. 옛 클러스터의 cloudflared를 내린다: `kubectl --context k3d-eatbid -n eatbid scale deploy/cloudflared --replicas=0`.
   Argo selfHeal이 되살리지 않도록 옛 클러스터의 Application `eatbid`는 먼저 `automated`를 끈다
   (`kubectl --context k3d-eatbid -n argocd patch application eatbid --type merge -p '{"spec":{"syncPolicy":null}}'`).
5. 호스트를 재부팅해 로그인 없이 `kubectl --context eatbid-vm get application -n argocd`가 Synced·Healthy이고
   eatbid.net이 응답하는지 확인한다. 이것이 수용 기준이다.
6. 다음 release tag(v0.1.8)로 build → 승격 커밋 → Argo sync가 사람 없이 끝나는 것을 확인한 뒤
   `k3d cluster delete eatbid`로 옛 클러스터를 지운다. kubeconfig의 `k3d-eatbid` context도 지운다.

되돌리기: 6 이전이면 옛 클러스터의 cloudflared replicas를 1로 올리고 VM의 cloudflared를 0으로 내린다.

## 6. 운영 함정

- VM IP는 고정이지만 호스트 NAT(`eatbid-vm-nat`)가 사라지면 VM이 밖으로 못 나간다. `Get-NetNat`로 확인하고
  없으면 `New-EatbidVm.ps1`을 다시 돌린다(NAT만 다시 만든다).
- k3s 버전을 올리는 것은 별도 결정이다. cloud-init의 `${K3S_VERSION}`은 만들 때만 쓰이고 그 뒤는 VM 안에서
  `INSTALL_K3S_VERSION`으로 다시 설치한다.
- Docker Desktop은 이제 개발 도구일 뿐이다. 꺼져 있어도 운영에 영향이 없어야 하며, 있다면 이 문서가
  틀린 것이다.
