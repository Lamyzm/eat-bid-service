---
id: K3S-HYPERV-VM
status: active
canonical_for: always-on-single-node-cluster-host
last_reviewed: 2026-10-10
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
| VM | `eatbid-k3s`, Gen2, 12 vCPU, 24GB 고정, 300GB 동적 VHDX(2026-10-10 RAM 32GB 호스트로 옮기며 키움, EAT-322). 스크립트 기본값은 4 vCPU·12GB·100GB이므로 `-Cpu`·`-MemoryBytes`·`-DiskBytes`로 준다 |
| 네트워크 | 내부 스위치 `eatbid-vm` + 호스트 NAT `eatbid-vm-nat`(172.30.0.0/24), VM 고정 IP 172.30.0.10, 게이트웨이 172.30.0.1 |
| k3s | `v1.35.5+k3s1`(k3d와 동일), traefik·servicelb 기본값 유지, tls-san 172.30.0.10 |
| 접속 | 호스트에서 `ssh -i ~/.ssh/eatbid-vm eatbid@172.30.0.10`, 다른 PC에서는 §2.1의 portproxy. kubectl context `eatbid-prod` |
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

2026-10-10 RAM 32GB 호스트로 옮길 때(EAT-322) 드러난 것:

- 호스트의 스크립트는 PowerShell 7(`pwsh`, `winget install Microsoft.PowerShell`)로 돌린다. Windows PowerShell
  5.1은 BOM 없는 UTF-8 스크립트의 한글을 ANSI로 읽어 구문을 깨뜨린다. 그리고 `Bootstrap-EatbidCluster.ps1`의
  Secret 존재 검사(`kubectl get secret ... 2>$null`)가 내는 "not found"를 오류로 던져 첫 Secret에서 멈춘다.
- `-ArtifactsOnly`도 관리자 검사와 `Resize-VHD`를 거치므로 관리자 권한이 없는 개발 PC에서는 돌지 않는다. 그때는
  스크립트의 `qemu-img`·`genisoimage` docker 명령을 그대로 실행해 VHDX·seed ISO만 만들어 보낸다. 그다음 새 호스트에서
  `Resize-VHD -SizeBytes <DiskBytes>`로 먼저 키우고 `New-EatbidVm.ps1`을 실행한다. 이미 있는 디스크는 재사용만 하고
  키우지 않는다.
- 부트스트랩은 새 호스트에서 돌렸다. 호스트에 kubectl(`winget install Kubernetes.kubectl`)을 깔고, 옛 운영
  context와 새 클러스터 context(서버 주소는 VM IP)를 함께 담은 kubeconfig를 둔다. 수동 Secret을 옛 클러스터에서
  복사하기 때문이다. 이전 기간에는 새 클러스터를 `eatbid-next`로 부르고, cutover 뒤 `eatbid-prod`로 바꾼다.
- 운영 호스트에서 Docker Desktop의 자동 시작(`HKCU\...\Run`의 `Docker Desktop`)을 지운다. VM에 줄 메모리를 차지한다.

Windows 기본 OpenSSH 서버가 구버전이라 동작하지 않는 기기가 있었다(2026-09-10 운영 PC). 그 경우
winget의 최신 OpenSSH나 다른 sshd를 쓰고 기본 기능은 다시 켜지 않는다. Tailscale은 `--unattended`로 붙여
로그인 없이도 터널이 살아 있게 한다.

## 3. 부트스트랩

```powershell
.\infra\vm\Bootstrap-EatbidCluster.ps1 -RepoRoot (Get-Location).Path
kubectl --context <새 context> get application -n argocd
```

Argo CD `v3.5.1`을 upstream manifest로 설치하고, Argo가 스스로 만들 수 없는 수동 Secret 다섯
(`argocd/repo-eatbid`, `ghcr-pull`, `eatbid-infisical-operator`, `cloudflared-creds`, `eatbid-auth`)을
옛 클러스터에서 복사한 뒤 `infra/platform`(argo-workflows·infisical-secrets-operator·openobserve·fluent-bit·grafana)과
`infra/argocd`의 Application을 적용한다.
나머지는 Argo CD가 `deploy/prod`의 `infra/envs/prod`로 세운다. 이유는 스크립트 머리말에 있다.

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
# 두 호스트가 같은 LAN이면 새 호스트에서 실행한다. 덤프가 실행 PC를 거치기 때문이다.
pwsh -File .\infra\vm\Migrate-EatbidPostgres.ps1 -SourceContext eatbid-prod -TargetContext eatbid-next
```

먼저 옛 클러스터의 자동 sync를 풀고 CronWorkflow를 suspend한 뒤, 실행 중이던 workflow가 끝나기를 기다린다(§5의
4번 명령). 스크립트도 실행 중 workflow가 있으면 멈춘다. 진행 중인 run을 덤프하면 새 클러스터에서 아무도 닫지 않는
run으로 남기 때문이다.

역할과 비밀번호는 `pg_dumpall --globals-only`로 옮긴다. 데이터베이스 단위 권한(datacl)은 원본에서 읽어 그대로 다시
준다. 이 권한은 globals에도 스키마 덤프에도 실리지 않는다. 2026-10-10에는 이것이 빠져 migration Job이
`CREATE SCHEMA IF NOT EXISTS "drizzle"`에서 권한 거부로 멈췄고, 사이트가 12분 동안 503이었다.

데이터는 우리 스키마 여섯(core·ingest·mart·app·monitoring·drizzle)만 원본 파드 안에서 `pg_dump -Fc` 파일로 만든다.
대상까지의 경로는 다음과 같다.

- 원본 파드에서 호스트로는 `kubectl exec ... cat` 출력으로 받는다. 7GB가 sha256까지 맞았다.
- 호스트에서 VM으로는 scp로 보낸다. 같은 PC 안의 가상 스위치라 7GB에 41초가 걸렸다.
- VM에서는 같은 파일시스템인 pgdata 볼륨 디렉터리로 `mv`하고, 대상 파드가 그 경로를 읽는다.

대상 쪽을 `kubectl exec -i` 입력으로 넣지 않는 이유가 있다. 새 클러스터(k3s v1.35.5)에서 1MB 이상 입력이 종료
코드 0인 채 다른 내용으로 도착했다. 호스트의 Windows kubectl도, VM 안의 리눅스 kubectl도 같았다. 이 경로에는
호스트에서 VM으로 비밀번호 없는 ssh 키가 필요하다. 호스트에서 `ssh-keygen -N ''`로 만들고(`pwsh`에서 `-N '""'`는
`""` 두 글자가 암호가 된다) 공개키를 VM의 `authorized_keys`에 더한다.

그다음 `pg_restore -j 8`로 병렬 복원하고 ANALYZE한 뒤, 표마다 정확한 행 수를 두 쪽에서 대조한다. 2026-10-10 실측은
덤프 7.2GB에 16분, 복원에 23분이었다. 2026-09-10까지 쓰던 평문 `pg_dumpall`은 DB가 커지자 색인을 하나씩 다시
만드느라 너무 느려 바꿨다(EAT-322).

레거시 `public` 표는 R2에 보관돼 있고 의존이 없어 옮기지 않는다. 원본 레이크도 R2가 권위라 옮기지 않는다. 덤프에
실린 권한은 참고값이다. 복원 뒤 첫 sync에서 provisioning Job이 저장소의 상태로 다시 세운다.

덤프 뒤에도 사이트는 옛 클러스터에서 계속 응답하므로, 가입·설정 같은 사용자 작성 상태가 그 사이 옛 DB에 쌓인다.
그래서 cutover에서 옛 cloudflared를 0으로 내린 직후 `-Schemas app -ReplaceSchemas -SkipGlobals`로 `app`만 다시
맞춘다(§5). 수집은 suspend돼 있으므로 나머지 스키마는 변하지 않는다.

## 5. cutover (사용자 확인 뒤)

cloudflared는 같은 터널 자격증명으로 두 클러스터에서 동시에 붙을 수 있다. 그래서 순서는 "겹쳐 켜고 →
확인하고 → 옛 것을 끈다"이며 중단 창이 없다.

2026-10-10(EAT-322)에는 순서가 달랐다. 덤프 전에 옛 클러스터의 자동 sync를 풀고 CronWorkflow 아홉 개를 모두
suspend해 수집 쓰기를 먼저 멈췄다. 그래서 겹쳐 켜기 대신 다음 순서를 따랐다.

1. 옛 cloudflared를 0으로 내린다.
2. `app`만 다시 맞춘다(§4).
3. 새 클러스터에 automated Application을 적용한다.
4. server·web·cloudflared가 Ready이고 eatbid.net이 200인지 확인한다.

중단은 12분이었는데, 그중 11분은 데이터베이스 권한이 빠진 탓이었다(§4). 권한까지 옮겼다면 중단 창은 migration·
provisioning·이미지 기동에 드는 몇 분이다. 사용자 작성 상태가 갈라지지 않으므로, 중단 창이 짧은 지금은 이 순서가
겹쳐 켜기보다 안전하다.

0. 4절 이전이 끝난 뒤에야 새 클러스터의 자동 sync를 켠다. 부트스트랩은 `eatbid` Application을 syncPolicy 없이
   적용해 두므로 여기서 원본을 다시 적용한다: `kubectl --context <새 context> apply -f infra/argocd/prod.application.yaml`.
   순서를 바꿔 automated로 먼저 적용하면 cloudflared가 server·web보다 먼저 떠서 같은 터널의 요청 일부가 빈
   클러스터로 가 503이 난다(2026-09-10 실측, EAT-129).
1. VM의 `cloudflared`·`server`·`web`이 Ready인지 확인한다: `kubectl --context <새 context> get pods -n eatbid`.
2. eatbid.net을 몇 번 호출해 두 클러스터가 번갈아 응답하는지, 오류가 없는지 본다.
3. 마지막 덤프·복원을 한 번 더 돌린다(4절). 이 시점부터 옛 클러스터에는 쓰지 않는다.
4. 옛 클러스터를 내린다. 순서는 자동 sync 해제 → 모든 CronWorkflow suspend(2026-10-11부터 열 개. 개찰 결과 줄·백필·재처리·
   mart·백업도 DB에 쓴다) → 실행 중 Workflow가 끝나기를 기다리기(종료하면 진행 중 run이 남는다) → cloudflared 0이다. 수집을 먼저 멈추지 않으면 겹쳐 켜진 동안 두 DB가 갈린다(2026-09-10 실측: 18:30 회차 직전).
   ```powershell
   kubectl --context <옛> -n argocd patch application eatbid --type merge -p '{"spec":{"syncPolicy":null}}'
   kubectl --context <옛> -n eatbid patch cronwf eatbid-poll-open --type merge -p '{"spec":{"suspend":true}}'
   kubectl --context <옛> -n eatbid patch cronwf eatbid-daily-reconcile --type merge -p '{"spec":{"suspend":true}}'
   kubectl --context <옛> -n eatbid patch cronwf eatbid-poll-results --type merge -p '{"spec":{"suspend":true}}'
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
