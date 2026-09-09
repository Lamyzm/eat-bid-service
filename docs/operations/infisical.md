---
status: active
last_reviewed: 2026-09-05
review_trigger: infisical-project-environment-path-auth-or-secret-delivery-change
---

# Infisical 비밀관리 운영

이 문서는 사람, Codex, Claude Code가 eatbid의 비밀을 같은 위치에서 찾고 같은 방식으로
주입하기 위한 권위 있는 runbook이다. 실제 비밀값은 절대 이 문서, Git, Linear, agent prompt,
shell history에 기록하지 않는다.

## 1. 권위와 현재 적용 범위

| 질문 | 권위 |
|---|---|
| 현재 비밀값, 버전, 접근권한, 회전 상태 | Infisical |
| 필요한 key 이름, 형식, 발급처, 목적, 소비자 | 향후 `@eatbid/config` Zod catalog; 구현 전까지 이 문서 |
| 배포 구조와 secret delivery 결정 | Accepted ADR와 `docs/architecture/runtime-and-deployment.md` |

현재 즉시 적용하는 범위는 로컬 개발·agent tooling secret이다. 첫 항목은 Linear workflow의
`LINEAR_API_KEY`다. Kubernetes runtime을 SOPS+age에서 Infisical+External Secrets Operator로
바꾸는 일은 별도 ADR과 infrastructure issue 전에는 실행하지 않는다.

## 2. Infisical 계층의 의미

### 홈 화면의 제품 메뉴

Infisical 홈의 항목들은 secret을 종류별로 나누어 넣는 저장소가 아니라 서로 다른 문제를 해결하는
보안 제품이다.

| 제품 | 저장·처리 대상 | eatbid 판정 |
|---|---|---|
| Secrets Management | API key, password, token, connection string, application configuration | **지금 사용**. `LINEAR_API_KEY`, DB, R2, 외부 API credential은 모두 여기 |
| Certificate Manager | CA와 X.509 TLS/mTLS/code-signing certificate의 발급·갱신·폐기 | 현재 보류. 자체 CA, workload mTLS 또는 certificate inventory가 필요할 때 평가 |
| KMS | 외부로 추출되지 않는 암호키로 encrypt/decrypt 또는 sign/verify API 수행 | 현재 보류. env/API key 저장소가 아니며 application field encryption 요구가 생길 때 평가 |
| Secret Scanning | Git repository, history, local directory, CI에서 노출된 credential 탐지 | 후속 도입 후보. 저장·주입 기능이 아니라 누출 탐지 방어선 |
| Privileged Access Manager | DB·SSH·Kubernetes 등에 사람의 privileged session을 gateway로 중개·기록 | 현재 보류. 운영 인력이 늘고 production 수동 접속을 통제해야 할 때 평가 |
| Secret Sharing | 제한된 횟수·기간의 링크로 사람에게 값을 일회성 전달 | runtime/shared folder 대체 금지; 예외적 사람 간 전달에만 사용 |

따라서 지금 생성할 것은 **Secrets Management project `eatbid` 하나뿐**이다. 같은
`LINEAR_API_KEY`를 KMS, Secret Sharing, Secrets Management에 중복 저장하지 않는다.

공식 제품 설명:

- [Infisical 전체 제품 지도](https://infisical.com/docs/documentation/getting-started/introduction)
- [Secrets Management](https://infisical.com/docs/documentation/platform/secrets-mgmt/overview)
- [Certificate Management](https://infisical.com/docs/documentation/platform/pki/overview)
- [Infisical KMS](https://infisical.com/docs/documentation/platform/kms/overview)
- [Secret Scanning](https://infisical.com/docs/documentation/platform/secret-scanning/overview)
- [Privileged Access Management](https://infisical.com/docs/documentation/platform/pam/overview)

### Secrets Management 내부 계층

Infisical의 기본 계층은 다음과 같다.

```text
Organization
  └─ Secrets Management Project
       └─ Environment
            └─ Folder / secret path
                 └─ Secret
```

- **Organization**: billing과 조직 수준 identity의 경계다. eatbid는 `Personal Org` 하나를 사용한다.
- **Project**: 가장 큰 격리 경계다. 공식 문서는 application, service 또는 repository와 대응시키는
  방식을 일반적인 선택으로 제시한다. project 사이에는 secret import/reference가 되지 않는다.
- **Environment**: 값이 사용되는 배포 단계를 뜻한다. eatbid는 `dev`, `staging`, `prod`만 사용한다.
- **Path**: 한 environment 안에서 service, tooling, platform consumer를 구분하는 namespace다.
- **Secret**: `(project, environment, path, key)`로 위치가 완전히 결정되는 실제 credential이다.

공식 근거:

- [Infisical organization structure blueprint](https://infisical.com/docs/documentation/guides/organization-structure)
- [Environment와 path scoping](https://infisical.com/docs/documentation/platform/secrets-mgmt/concepts/access-control)
- [Secrets Management project](https://infisical.com/docs/documentation/platform/secrets-mgmt/project)

## 3. eatbid 고정 구조

### Project

초기에는 monorepo와 대응하는 Secrets Management project **`eatbid` 하나**를 사용한다. 다음 중
하나가 실제로 발생할 때만 새 project로 분리한다.

- 서로 다른 관리자가 project admin을 가져야 한다.
- 한 identity가 다른 영역의 metadata조차 보아서는 안 된다.
- 별도 audit/retention/approval 정책이 필요하다.
- cross-project import가 불가능해지는 비용보다 격리 이득이 크다.

`web`, `server`, `dataplane`, `platform`, `agents`라는 이름으로 미리 project를 쪼개지 않는다.

### Environments

| slug | 의미 | 허용 소비자 |
|---|---|---|
| `dev` | 로컬 개발, k3d, 개발용 외부 integration | 사람, 제한된 dev/agent identity |
| `staging` | 운영 전 검증 환경 | staging workload와 배포 identity |
| `prod` | 실제 고객·운영 데이터 환경 | production workload; 사람과 agent는 기본 접근 없음 |

`infra`, `ci`, `agent`, `local`을 environment로 만들지 않는다. 이들은 배포 단계가 아니라
소비자 또는 실행 방식이므로 path와 identity로 표현한다.

### Paths

```text
/
├─ runtime/
│  ├─ web/
│  ├─ server/
│  ├─ dataplane/
│  └─ shared/
├─ platform/
│  ├─ github/
│  ├─ argo/
│  ├─ kubernetes/
│  └─ cloudflare/
└─ tooling/
   ├─ linear/
   └─ local/
```

경로 선택 규칙:

- 애플리케이션 프로세스가 실행 중 읽는 값은 `/runtime/{consumer}`다.
- 인프라를 생성·배포·관리하는 credential은 `/platform/{system}`이다.
- 개발자 workflow와 AI agent가 쓰는 외부 도구 credential은 `/tooling/{system}`이다.
- `/runtime/shared`는 값, 발급 주체, 권한, 회전 주기, 소비자가 정말 같은 경우에만 사용한다.
- root `/`에는 secret을 만들지 않는다.
- path depth는 기본 두 단계로 제한한다. 권한 경계가 추가로 필요할 때만 세 번째 단계를 만든다.

예시:

| 위치 | key | 이유 |
|---|---|---|
| `dev:/tooling/linear` | `LINEAR_API_KEY` | 로컬 agent workflow만 사용 |
| `dev:/runtime/server` | `DATABASE_URL` | 개발 server runtime 전용 |
| `prod:/runtime/server` | `DATABASE_URL` | production server와 값·권한 분리 |
| `prod:/runtime/dataplane` | `R2_ACCESS_KEY_ID` | production 수집 workload 전용 |
| `prod:/platform/cloudflare` | `CLOUDFLARE_API_TOKEN` | Cloudflare resource 관리 전용 |

R2 bucket을 읽고 쓰는 dataplane credential은 `/runtime/dataplane`이고, R2 bucket 자체를 생성하는
Cloudflare admin credential은 `/platform/cloudflare`다. 이름이 비슷해도 권한과 소비자가 다르므로
합치지 않는다.

## 4. Key 이름과 metadata 계약

key는 대문자 `UPPER_SNAKE_CASE`를 사용하고 실행 프로세스가 실제로 읽는 환경변수 이름과 같게 한다.
모호한 `TOKEN`, `KEY`, `SECRET`은 금지하고 `LINEAR_API_KEY`, `R2_SECRET_ACCESS_KEY`처럼 발급 주체와
용도를 드러낸다.

모든 secret은 다음 정보를 가진다.

| 필드 | 기록 위치 | 필수 내용 |
|---|---|---|
| value | Infisical value | 실제 credential; 다른 곳에 복사 금지 |
| comment | Infisical comment | catalog ID, 상세 목적, 발급 URL, 공식 문서 URL, 폐기 URL |
| metadata | Infisical metadata | `catalog_id`, `owner`, `consumer`, `issuer`, `rotation_policy` |
| tags | Infisical tags | `runtime|platform|tooling`, `manual-rotation|auto-rotation`, provider |
| reminder | Infisical reminder | provider가 자동 회전을 지원하지 않을 때만 주기와 조치 |
| schema | Git Zod catalog | prefix, URL, enum, 길이; 실제 value/default 금지 |

comment 형식:

```text
catalog_id: linear.agent-workflow.api-key
purpose: Linear issue claim과 handoff comment를 위한 최소권한 credential
issue_url: https://linear.app/eatbid/settings/account/security
docs_url: https://linear.app/developers/graphql
revoke_url: https://linear.app/eatbid/settings/account/security
owner: developer-workflow
consumer: tools/agent-workflow
rotation: compromise-or-scope-change
```

Infisical은 comment, tags, metadata, rotation reminder를 지원한다. 장문의 계약은 향후 Git의
Zod catalog가 권위가 되고 Infisical에는 catalog ID와 검색에 필요한 요약만 mirror한다.

- [Secret comments와 tags](https://infisical.com/docs/documentation/platform/secrets-mgmt/project)
- [Secret metadata·comment·reminder API](https://infisical.com/docs/api-reference/endpoints/secrets/create)
- [Zod 4 metadata registry](https://zod.dev/metadata)

## 5. 공유, import와 reference

Infisical의 **Shared Secret**은 외부 전달용 일회성 링크 기능이며 `/runtime/shared`와 다른 개념이다.
애플리케이션 공통값에는 Secret Sharing 링크를 사용하지 않는다.

folder import/reference는 같은 project 안에서만 사용한다. 기본은 복제 없이 consumer path에 직접
저장하는 것이다. import가 필요하면 다음 조건을 모두 만족해야 한다.

- base secret과 consumer secret의 값과 회전 수명주기가 같다.
- consumer identity가 base path에도 접근해도 된다.
- 같은 key 충돌이 없다. import 순서의 `last one wins`에 의존하지 않는다.
- import chain은 한 단계만 사용한다.
- `/runtime/shared` 전체를 모든 workload에 import하지 않는다.

reference는 client가 base와 dependent secret 양쪽에 읽기 권한이 없으면 해소되지 않는다. 자세한
동작은 [Infisical secret reference와 import](https://infisical.com/docs/documentation/platform/secret-reference)를
따른다.

## 6. 사람의 로컬 사용법

### 최초 한 번

```powershell
infisical login
infisical init
```

`infisical init`은 저장소 루트에 `.infisical.json`을 만든다. 이 파일에는 비밀값이 없으므로 공식
문서에 따라 Git에 커밋할 수 있다. project ID나 environment slug는 secret으로 취급하지 않는다.

현재 저장소에는 `.infisical.json`을 아직 추가하지 않았다. 루트 설정 파일의 소유 이슈가 정해질
때까지는 다음 public project ID를 명시한다.

```text
eatbid project ID: 0d794ce1-e0e3-4e48-83ea-88f2f05f9a65
```

이 Windows host는 npm의 `@infisical/cli` `0.43.128`을 사용한다. 2026-08-31 재설치 당시 npm shim이
0바이트 extensionless 파일을 가리켜 아무 출력 없이 종료되는 문제가 있어 PowerShell/cmd shim을 실제
`bin/infisical.exe`로 연결했다. npm update 후 문제가 재발하면 먼저 `infisical --version`이 버전을
출력하는지 확인하고, secret이나 로그인 문제로 오진하지 않는다.

### 프로세스 실행

항상 project, environment, path, command를 명시한다.

```powershell
infisical run --projectId=0d794ce1-e0e3-4e48-83ea-88f2f05f9a65 --env=dev --path=/tooling/linear --secret-overriding=false -- node tools/agent-workflow/cli.mjs doctor
infisical run --projectId=0d794ce1-e0e3-4e48-83ea-88f2f05f9a65 --env=dev --path=/runtime/server --secret-overriding=false -- pnpm --filter @eatbid/server dev
```

monorepo의 하위 디렉터리에서 실행할 때는 project config 위치를 명시한다.

```powershell
$repoRoot = git rev-parse --show-toplevel
infisical run --project-config-dir="$repoRoot" --env=dev --path=/runtime/server --secret-overriding=false -- pnpm dev
```

원칙:

- `infisical run`으로 대상 child process에만 주입한다.
- `printenv`, `env`, `Get-ChildItem Env:` 또는 값을 출력하는 debug command와 함께 실행하지 않는다.
- `infisical secrets get ... --plain`을 agent prompt나 사람이 보는 terminal에서 실행하지 않는다.
- automation에서는 personal override가 끼어들지 않도록 `--secret-overriding=false`를 사용한다.
- `--watch`는 secret 변경 때 command를 재시작하므로 production에서 사용하지 않는다.
- session 만료는 `infisical login` 한 번으로 복구한다. 현재는 이를 이유로 장기 machine credential을
  로컬에 추가하지 않는다.

공식 CLI 근거:

- [Infisical CLI quickstart와 `.infisical.json`](https://infisical.com/docs/cli/usage)
- [`infisical run` flags](https://infisical.com/docs/cli/commands/run)
- [`infisical secrets`와 example env 생성](https://infisical.com/docs/cli/commands/secrets)

## 7. Codex와 Claude Code 규칙

AI agent는 다음 순서로만 비밀을 찾는다.

1. 이 문서의 경로 표에서 정확한 environment와 path를 찾는다.
2. 향후 `@eatbid/config` catalog에서 필요한 key 이름과 소비자를 확인한다.
3. path나 key가 없으면 추측하거나 root를 탐색하지 않고 사용자에게 누락을 보고한다.
4. 비밀값을 직접 조회하지 않고 `infisical run`으로 승인된 command에만 주입한다.
5. command 종료 후 값, 길이, prefix, hash를 응답·로그·Linear comment에 기록하지 않는다.

AI가 할 수 있는 일:

- public project ID, environment slug, path, key contract 읽기
- 누락 key 이름과 발급 URL 안내
- 값 비노출 존재/형식 검사 실행
- 사용자가 승인한 secret metadata와 path 구성
- 아래 절차대로 승인된 경로에 폴더와 secret을 CLI로 직접 만들기

AI가 해서는 안 되는 일:

- `LINEAR_API_KEY` 같은 값을 파일, patch, prompt, shell argument에 넣기
- production path 전체 나열·다운로드·`.env` export
- 임의로 personal override 생성
- root path 또는 broad import로 필요한 secret을 추측
- 사람 승인 없이 API key 생성, 권한 확대, 회전, 폐기

### 시크릿과 폴더는 agent가 CLI로 만든다

새 구성요소에 secret이 필요할 때 사람에게 Infisical 화면을 대신 눌러 달라고 부탁하지 않는다.
사용자 로그인 세션의 CLI가 쓰기 경로다. 운영자 machine identity(`operator`)는 읽기 전용이므로
그 identity로는 폴더도 secret도 만들 수 없다.

```powershell
infisical secrets folders create --name postgres --path /runtime --env prod --projectId=0d794ce1-e0e3-4e48-83ea-88f2f05f9a65
infisical secrets set POSTGRES_PASSWORD=<value> --env=prod --path=/runtime/postgres --projectId=0d794ce1-e0e3-4e48-83ea-88f2f05f9a65
```

- 폴더는 항상 부모 경로를 `--path`로 주고 이름만 `--name`으로 준다. 최상위 `infisical folders`
  명령은 존재하지 않는다.
- `infisical secrets set`은 같은 key가 이미 있으면 값을 덮어쓴다. 운영 값을 바꾸는 행위이므로
  kubectl의 cluster 변경 subcommand와 같은 범주로 보고 issue에 승인 범위를 남긴 뒤 실행한다.
- 만든 값을 확인하려고 `infisical secrets get ... --plain`이나 경로 전체 나열을 실행하지 않는다.
  존재 확인은 `infisical secrets folders list`나 소비하는 프로세스의 기동으로 대신한다.
- 새 path와 key를 만들었으면 4절의 key 이름 계약과 3절의 경로 표를 같은 변경에서 갱신한다.
- 위 "해서는 안 되는 일"은 그대로 유효하다. 이 절이 여는 것은 승인된 경로에 값을 넣는 일뿐이며
  API key 발급·권한 확대·회전·폐기는 계속 사람의 행위다.

agent hook은 명령 본문을 해석하지 않으므로(ADR 0043) Infisical 명령을 따로 허용하거나 막지 않는다.
값을 다루는 `secrets set | get`과 임의 프로그램을 실행하는 `infisical run -- <command>`를 언제 실행할
수 있는지는 이 문서의 승인 절차와 issue의 범위가 정한다.

사람 몫으로 남는 것은 셋뿐이다. Infisical 계정 로그인(`infisical login`) 유지, project·organization
권한 부여와 machine identity 발급, 그리고 결제와 plan 변경이다.

## 8. Machine Identity와 전달

Machine Identity는 기계 수가 아니라 **고유한 권한 집합**마다 하나 만든다. 즉 project,
environment, path, action 조합이 같으면 같은 identity를 사용할 수 있고 권한이 다르면 분리한다.

권장 identity 초안:

| identity | 권한 |
|---|---|
| `eatbid-agent-linear-dev` | `dev:/tooling/linear`, `describeSecret + readValue` |
| `eatbid-ci-validate` | build/test에 필요한 dev path만 read; publish/write 없음 |
| `eatbid-server-prod` | `prod:/runtime/server` read only |
| `eatbid-dataplane-prod` | `prod:/runtime/dataplane` read only |

`secrets:read` legacy action 대신 `describeSecret`과 `readValue`를 명시한다. role은 additive이므로 broad
Member role과 좁은 custom role을 함께 주어 결과적으로 권한을 넓히지 않는다.

- [Machine Identity 설계](https://infisical.com/docs/documentation/platform/identities/overview)
- [Project/environment/path permission](https://infisical.com/docs/internals/permissions/project-permissions)

Local은 user login, GitHub Actions는 OIDC, Kubernetes는 service account 기반 Kubernetes Auth를
사용한다. 장기 human token을 CI나 cluster에 복사하지 않는다.

## 9. Kubernetes 목표 경계

후속 Accepted ADR 이후의 목표는 다음과 같다.

```text
Infisical
   ↓ Kubernetes Auth
External Secrets Operator
   ↓
Kubernetes Secret
   ↓ explicit secretKeyRef
Pod
```

- Infisical은 current value SSOT다.
- External Secrets Operator는 단방향 전달기이며 저장소가 아니다.
- namespace별 `SecretStore`와 workload별 `ExternalSecret.spec.data`를 사용한다.
- `PushSecret`, broad `dataFrom`, Infisical Operator, Sealed Secrets를 병존시키지 않는다.
- Kubernetes Secret encryption-at-rest와 namespace RBAC가 준비되기 전에는 production gate를 통과하지
  않는다.

[ESO Infisical provider](https://external-secrets.io/latest/provider/infisical/)는 Universal Auth뿐 아니라
Kubernetes Auth를 공식 지원한다. ADR 0022가 값 권위와 전달 경계를 결정했으며, 실제 manifest와
workload 전환은 별도 infrastructure issue와 배포 승인 범위다.

## 10. `LINEAR_API_KEY` 등록 계약

등록 위치:

```text
project: eatbid
environment: dev
path: /tooling/linear
key: LINEAR_API_KEY
type: shared
```

권한:

- Linear workspace/team: `eatbid` / `EAT`
- Linear permissions: read, issue create/update, comment create
- 다른 team과 workspace 접근은 부여하지 않는다.

등록 절차:

1. Linear의 `Security & access → Personal API keys`에서 최소권한 key를 생성한다.
2. 값이 한 번 표시되는 즉시 Infisical UI의 위 위치에 붙여 넣는다.
3. 이 문서의 comment template과 metadata/tag를 등록한다.
4. 화면, clipboard, shell, 임시 파일에 남은 plaintext를 제거한다.
5. `pnpm workflow:doctor:infisical`로 값 비노출 검증한다.
6. Linear에서 last used가 갱신되고 Infisical audit에 read가 남는지 확인한다.

기존 `eatbid-local-claim` key를 재사용할 수 없거나 value를 다시 볼 수 없으면 새 key를 생성하고 등록
성공 후 기존 key를 폐기한다. 폐기는 등록·검증 성공 전에는 하지 않는다.

### 현재 등록 상태

2026-08-31 기준으로 다음 단계까지 완료했다.

- Linear key label: `eatbid-infisical-agent-workflow`
- Linear scope: `Read`, `Create issues`, `Create comments`, team `Eatbid (EAT)`만 허용
- Infisical target: `eatbid / dev / tooling/linear / LINEAR_API_KEY`
- Infisical comment와 `catalog_id`, `owner`, `consumer`, `issuer`, `rotation_policy` metadata 등록
- plaintext는 Git, 문서, patch, shell argument, clipboard에 기록하지 않고 브라우저 세션 사이에서 직접 전달
- Infisical CLI `0.43.128` 로그인과 `doctor` 주입 확인 완료
- Infisical에서 주입한 key로 Linear `EAT-5` claim을 성공시켜 실제 API read/claim 경로 확인
- Linear `last used on Aug 31, 2026` 갱신 확인
- 기존 `eatbid-local-claim`은 사용자가 추후 회전·폐기할 때까지 유지

기존 key는 사용자가 추후 직접 회전·폐기하기로 했으므로 자동 삭제하지 않는다. 아직 남은 후속 단계는
`.infisical.json`을 소유 이슈에서 추가하는 것이다. Infisical audit log는 현재 Free plan에서 제공되지
않아 확인할 수 없으며, log 부재로 오해하지 말고 plan 제한으로 기록한다. 프로젝트 공통 tag catalog가
아직 없으므로 tag는 catalog 도입 이슈에서 일괄 생성하고 이 secret에 연결한다. `Create issues`와
`Create comments` 권한은 불필요한 시험용 issue/comment를 만들지 않기 위해 이번 등록 과정에서 별도로
행사하지 않았다.

### server runtime 현재 상태

2026-09-01 읽기 전용 확인에서 `eatbid / dev` 루트에는 `tooling` 폴더만 존재했고 목표 경로인
`/runtime/server` 조회는 404였다. 따라서 위 표와 실행 명령의 `dev:/runtime/server`는 채택한 배치 계약이지,
현재 `DATABASE_URL` 주입 완료 증거가 아니다. 이 폴더와 최소 권한 secret이 프로비저닝되기 전에는 실제 dev
Server·Web 연동 검증을 완료로 표시하지 않으며 로컬 `.env`나 코드 기본값으로 우회하지 않는다.

## 11. 장애와 복구

| 증상 | 처리 |
|---|---|
| CLI session 만료 | `infisical login` 후 같은 명령 재실행 |
| key 누락 | catalog/이 문서에서 발급 URL 확인; 추측값 생성 금지 |
| permission denied | environment/path/identity role 확인; broad Member 권한으로 우회 금지 |
| secret 형식 오류 | provider에서 새 credential 발급 후 Infisical value 교체; 애플리케이션 default로 우회 금지 |
| Infisical 장애 | 기존 workload 상태 보존; 신규 배포/rotation 중단; SOPS recovery는 ADR과 restore drill 후에만 사용 |
| 노출 의심 | provider credential revoke → 새 key 발급 → Infisical 갱신 → consumer 검증 → audit 확인 |

비밀값을 Git에서 되살리는 것을 정상 복구 절차로 만들지 않는다. SOPS+age recovery snapshot은 향후
별도 결정이 승인될 때만 Infisical에서 단방향 생성한다.
