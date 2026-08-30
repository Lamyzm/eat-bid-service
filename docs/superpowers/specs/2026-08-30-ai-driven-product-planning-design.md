---
id: DESIGN-AI-PRODUCT-PLANNING
status: proposed
linear_issue: EAT-5
owned_paths:
  - docs/superpowers/specs/2026-08-30-ai-driven-product-planning-design.md
  - docs/product/roadmap.md
  - docs/governance/ai-driven-documentation.md
  - docs/operations/infisical.md
  - docs/README.md
last_reviewed: 2026-08-30
review_trigger: product-roadmap-document-workflow-or-secret-management-decision-change
---

# AI-driven 제품 기획·로드맵 운영 설계

## 1. 목적

eatbid의 목표는 아버지 한 사람의 투찰 방식을 복제하는 도구가 아니라, 여러 EAT 공급업체가
공고 발견부터 판단·기록·제출 대조·결과 복기까지 반복해서 쓰고 비용을 지불하는 운영
워크스페이스를 만드는 것이다.

이 설계는 다음 세 가지를 하나의 지속 가능한 실행계로 묶는다.

1. 비드큐 수준의 근거와 신뢰를 제공하는 분석 화면
2. EATGO 수준의 반복 업무 자동화
3. 1인 개발자가 Codex와 Claude Code를 병행해도 길을 잃지 않는 Linear-first 작업 계약

낙찰 결과는 확률과 경쟁자 행동의 영향을 크게 받는다. 따라서 제품은 낙찰을 보장하거나 특정
투찰가를 추천하지 않는다. 고객이 비용을 지불하는 핵심은 **더 많은 공고를 놓치지 않고, 더 짧은
시간에 근거를 확인하고, 자신의 결정을 개찰 전 기록하며, 제출과 결과를 완결해서 다음 판단에
재사용하는 능력**이다.

## 2. 현재 경계

- R0 데이터 신뢰 기반은 다른 writing session에서 진행 중이며 EAT-5가 수정하지 않는다.
- 원본·canonical·사용자 상태·분석의 권위는 기존 아키텍처 결정을 따른다.
- 추천 투찰가, 예정가 예측, 자동 NeaT 투찰은 현재 제품 경계 밖이다.
- 비드큐·EATGO·토스증권 조사는 기능과 표현 방식의 evidence이지 복제해야 할 정답이 아니다.
- 2026년 8월 김해 replay와 가족 사용 경험은 가설 생성 자료이지 제품 효능 증명이 아니다.
- 이 문서는 승인 전 `proposed`이며, 권위 로드맵과 런타임 결정을 조용히 대체하지 않는다.

## 3. 제품에서 증명할 핵심 루프

```text
공고 발견
  → 사업자별 검토 대기열
  → 공고 사실·기관 이력·유사 시장 확인
  → 사용자가 후보와 근거를 개찰 전에 기록
  → NeaT 입력 확인
  → source-observed 제출·개찰 결과 대조
  → 다음 공고에서 이전 판단과 결과를 재사용
```

이 루프의 성공은 한 달의 낙찰 건수만으로 판정하지 않는다. 낙찰 0건인 달에도 공고 누락 감소,
검토 시간 감소, 결정·제출·결과의 연결 완결성에서 유지 가치가 있어야 한다. 낙찰 건수는 중요한
결과 지표이지만 표본과 경쟁 조건 없이 제품이 직접 통제하는 KPI로 표현하지 않는다.

## 4. 성장 로드맵 재구성

### R0 — 데이터 신뢰 기반

현재 아키텍처의 raw → ingest → core → mart 사슬, `AuctionAttempt` identity, 원자 발행,
재현 가능한 분석과 `unknown` 표현을 완성한다. R1 화면은 이 기반의 신선도와 provenance를
숨기지 않고 소비해야 한다.

### R1 — 유료 투찰 decision loop

R1을 한 번에 출시하지 않고, 사용자가 실제 투찰 주기를 끝까지 돌 수 있는 다섯 milestone으로
나눈다.

| milestone | 사용자에게 생기는 능력 | 최소 evidence |
|---|---|---|
| M1 오늘의 투찰함 | 신규·변경·재입찰과 다음 행동을 사업자별로 놓치지 않는다. | 실제 업무 대기열과 source 상태 대조 |
| M2 공고 판단실 | 확정 사실, 기관 이력, 유사 시장, 최대 3개 사용자 후보 replay를 한 화면에서 비교한다. | 표본·기간·`as_of`·버전이 보이는 사용 관찰 |
| M3 결정 journal | 후보값과 선택 근거를 개찰 전에 봉인해 사후 합리화를 구분한다. | 수정 이력과 개찰 전 timestamp |
| M4 제출·결과 대조 | 사용자 기록, NeaT 확인, source 제출, 개찰 결과를 서로 다른 사실로 연결한다. | 불일치·미확인까지 포함한 완결률 |
| M5 유료 bid-cycle | 가족 외 사용자가 실제 투찰 주기를 반복하고 비용을 지불한다. | 유료 design partner의 반복 사용과 이탈 이유 |

R1의 시장·사용 수치는 discovery issue에서 모집단, 측정 기간, 다음 투자 판단 이유와 함께
확정한다. 인터뷰 수나 화면 완성만으로 R1을 통과시키지 않는다.

### R2 — retention wedge 경쟁 검증

R2를 처음부터 발주문서 자동화로 고정하지 않는다. 유료 사용 evidence로 다음 두 가설을 같은
기준에서 비교한다.

| 가설 | 해결하려는 반복 비용 | 후보 기능 |
|---|---|---|
| A. 투찰 전 운영 자동화 | 신규·변경·재입찰 탐색과 다사업자 반복 검토 | 저장 조건, 변경 감지, 마감·미검토 알림, batch review |
| B. 낙찰 후 문서 자동화 | 발주자료 재입력, 품목 합산, 학교별 문서·피킹 분배 | 원본 수신, 검토 가능한 구조화, template 문서, 변경 revision |

두 가설은 `발생 빈도`, `월 절감 시간`, `오류 비용`, `지불 의사`, `데이터 확보 가능성`,
`제품 경계·운영 위험`, `0건 낙찰 월의 유지 기여`로 평가한다. 점수표가 자동 결정을 내리지는
않으며 실제 유료 cohort evidence와 함께 사람이 하나를 R3로 승격한다.

### R3 — 선택한 wedge의 운영 규모화

R2에서 승격된 한 가설을 깊게 만든다. 선택하지 않은 가설은 폐기하지 않지만 같은 시기에
동등한 delivery stream으로 병행하지 않는다. 다사업자 batch, 변경 대응, 예외 검토, 반복 문서,
운영 review 중 선택한 wedge에 필요한 것만 확장한다.

### R4 — 검증된 인텔리전스

비교 전략은 개찰 전에 cohort·기간·버전·`as_of`와 함께 봉인하고 시간순 out-of-sample shadow
평가를 수행한다. 단순 baseline과 같은 티켓에서 비교하고 실패 결과도 보존한다. 성공해도 추천가를
자동 출시하지 않으며, 추천·예측 표현은 통계 검증, 사용자 오해 테스트, 제품 결정, 대체 ADR을
모두 통과해야 한다.

### R5 — Team·Enterprise

담당자·승인·반려·권한·감사·다법인·API/ERP·SSO·SLA를 추가한다. Team UI는 여러 사용자가 실제
승인 문제에 비용을 지불할 때, Enterprise 기능은 계약 요구가 반복될 때 구체화한다. 초기부터
엔터프라이즈처럼 보이기 위해 복잡한 권한·설정 화면을 먼저 만들지 않는다.

## 5. Gate 판정법

각 milestone과 roadmap 단계는 검토 시점에 다음 네 판정 중 하나를 가져야 한다.

| 판정 | 의미 | 다음 행동 |
|---|---|---|
| Promote | 사용자 outcome과 품질 evidence가 다음 투자에 충분하다. | 다음 milestone 또는 roadmap 단계로 이동 |
| Iterate | 문제는 확인됐지만 해법·표현·흐름이 부족하다. | 같은 outcome에서 가설을 좁혀 재검증 |
| Hold | 외부 데이터, 표본, 선행 capability가 부족하다. | blocker와 재개 조건을 Linear에 남김 |
| Stop | 반복 비용이나 지불 의사가 확인되지 않았다. | delivery를 중단하고 배운 점만 evidence로 보존 |

PR 병합, 문서 수, story point, AI가 작성한 코드량은 Promote 근거가 아니다.

## 6. 화면 체계

화면은 `calm density`를 따른다. 토스식 인지 명료성과 전문 업무도구의 정보 밀도를 결합하되,
카드·색·AI 배지로 권위를 연출하지 않는다.

| 화면 | 한 가지 질문 | 주 행동 | 정보 층위 |
|---|---|---|---|
| 오늘의 투찰함 | 지금 무엇을 검토하거나 확인해야 하는가? | 검토 시작 | 상태·마감 → 직접 비교 → source 상태 |
| 공고 판단실 | 이 공고에 어떤 값을 왜 기록할 것인가? | 결정 기록 | 확정 사실 → 이력·후보 replay → 원자료·산식 |
| 결과 복기 | 당시 결정과 실제 제출·결과는 어떻게 달랐는가? | 복기 완료 | 불일치 → 원인 분해 → revision·provenance |
| 성과판 | 업무와 판단 데이터가 얼마나 완결되고 축적됐는가? | 누락 보완 | 완결률 → cohort 추이 → 원시 항목 |
| 운영/문서 | 반복 운영 비용을 어디서 줄일 수 있는가? | 검토 또는 문서 생성 | 확정값 → 추정·미확인 → 원본·revision |

모든 화면에서 `관측 사실`, `파생 분석`, `사용자 기록`을 시각적으로 구분한다. 표본·기간·기준시점·
계산 버전·신선도·부분수집·unknown은 접어 숨길 수는 있어도 제거하지 않는다.

권위 있는 page-level 명세는 후속 `docs/product/screen-system.md` 한 곳에서 관리한다. 기존
`docs/SPEC-*`, `UX-LOG`, `PLANNING-LOG`는 evidence 또는 superseded 후보로 분류하고 새 기능을 그
파일에 추가하지 않는다. 특히 추천값 선입력, 의존 유도, 기록을 인질로 삼는 표현은 현재 제품
원칙과 충돌하므로 승격하지 않는다.

## 7. AI-driven 문서·작업 방법론

```text
research/evidence
  → Linear discovery 또는 delivery issue
  → 제품 gate와 human scope 승인
  → 필요할 때만 OpenSpec delta / ADR
  → 검증된 worktree lease의 한 writing agent
  → 다른 agent의 spec·diff·evidence review
  → PR evidence
  → 실제 고객 cycle
  → Promote | Iterate | Hold | Stop
```

### 소유권

| 질문 | 유일한 원천 |
|---|---|
| 현재 work item의 problem·scope·acceptance·owner·status | Linear issue/project |
| 제품 capability 순서와 outcome gate | `docs/product/roadmap.md` |
| 제품·데이터·런타임의 현재 경계 | architecture 문서와 Accepted ADR |
| 이번 중대형 변경의 상세 행동 delta | 선택적으로 OpenSpec change |
| 실제 구현과 검증 | 병합 code·migration·PR evidence |
| 반복 가능한 AI 절차 | 얇은 `AGENTS.md`, 공용 Skill, repository script |

Linear 문서는 `Start here`와 권위 저장소 링크를 제공할 수 있지만 기술 진실을 복사한 위키로
키우지 않는다. GitHub Spec Kit은 대규모 다단계 신규 시스템·규제 변경에서만 검토하고, 현재
brownfield delivery의 기본값은 얇은 Linear 계약과 선택적 OpenSpec이다.

### 1인 개발 운영 리듬

- WIP writing owner는 1명으로 제한한다.
- 매주 15~20분 동안 Now queue, blocker, project update를 정리한다.
- 매월 30분 동안 roadmap gate를 `Promote | Iterate | Hold | Stop`으로 판정한다.
- 일일 stand-up, 별도 Markdown task board, 근거 없는 target date와 진척률은 만들지 않는다.
- 같은 review 지적이 반복될 때만 lint, test, Skill, hook으로 승격한다.

## 8. 비밀관리 제안

### 8.1 결론

**Infisical을 현재 비밀값의 운영 SSOT로, Git의 Zod catalog를 비밀 계약과 설명의 SSOT로 사용한다.**

**방향 결정: accepted.** 구현은 별도 ADR과 현재 infrastructure writing session의 경계를 존중해
후속 issue에서 수행한다. 최초 도입에서는 encrypted env를 application repo에 추가하지 않는다.
복구 snapshot은 실제 운영 요구가 증명된 뒤 별도 threat model, restore drill, ADR을 거쳐 검토한다.

세 원천의 소유권은 겹치지 않는다.

| 질문 | 권위 |
|---|---|
| 현재 dev·prod·infra 값, 버전, 접근권한, 회전 상태 | Infisical |
| 어떤 키가 왜 필요하고 누가 소비하며 어디서 발급하는가 | Git의 `@eatbid/config` catalog |
| Infisical 전체 장애 복구 사본 | 현재 권위 없음; 별도 ADR 전에는 만들지 않음 |

SOPS 파일을 사람이 수정하거나 로컬·CI·Argo·애플리케이션이 입력으로 읽으면 Infisical과 즉시
이중 SSOT가 된다. 따라서 현재 구조에는 SOPS artifact를 두지 않는다.

Infisical Cloud를 먼저 사용하고, 규제·가용성·비용 evidence가 생기기 전에는 1인 개발자가 자체
호스팅하지 않는다. 로컬 `infisical login` session 만료와 재로그인은 허용 가능한 작은 운영 마찰로
본다. 자동화가 실제로 자주 막힐 때만 범위가 제한된 machine identity wrapper를 추가한다.

이 경계는 ADR 0022가 승인했으며 `runtime-and-deployment.md`의 SOPS+age 결정을 대체한다.

### 8.2 계층별 역할

| 계층 | 방식 | 원칙 |
|---|---|---|
| Git | Zod catalog, 생성된 `.env.example`·문서, 공개 identity/project ID, `SecretStore`/`ExternalSecret` | 실제 평문 값과 암호화 사본을 커밋하지 않음 |
| 사람의 로컬 관리·개발 | Infisical CLI user session을 OS keyring에 보관하고 `infisical run` 사용 | 만료 시 재인증; target process에 필요한 dev path만 주입 |
| 반복 무인 작업 | 필요가 증명되면 scope별 machine identity가 short-lived token 발급 | interactive login 제거보다 최소권한을 우선 |
| Codex·Claude Code | agent 전체가 아니라 claim/test/dev command별 같은 wrapper | production secret 기본 접근 0, `/tooling/linear`처럼 최소 path만 허용 |
| GitHub Actions | Infisical machine identity + GitHub OIDC | 장기 Infisical token을 GitHub Secret에 저장하지 않음 |
| Kubernetes | service account 기반 Kubernetes Auth + External Secrets Operator | Infisical은 저장소, ESO는 단방향 전달기, native Secret의 writer는 ESO 하나 |
| bootstrap·복구 | 현재는 Infisical 공식 복구 절차와 기존 workload 보존 | 별도 복구 사본은 후속 ADR 전까지 생성하지 않음 |

Kubernetes에서는 저장소와 전달기를 분리한다. Argo CD는 `SecretStore`와 `ExternalSecret`만 배포하고,
ESO가 Infisical에서 native Kubernetes Secret으로 단방향 pull한다. 기본은 namespace별 `SecretStore`와
workload별 read-only Infisical Machine Identity/Kubernetes Auth다. `ClusterSecretStore`, `dataFrom` 전체
추출, `PushSecret`, Infisical Operator 병존은 사용하지 않는다. workload에는 `ExternalSecret.spec.data`로
필요한 key만 명시하고 `envFrom`으로 한 scope 전체를 무차별 주입하지 않는다.

native Kubernetes Secret은 etcd와 RBAC의 보호 대상이므로 encryption-at-rest, namespace 최소권한,
secret list/get 제한을 배포 gate로 둔다. Kubernetes Secret 객체 자체를 피해야 할 규제·위협 근거가
생기면 ESO와 동시에 쓰지 않고 Infisical Agent Injector 또는 검증된 CSI provider로 전달기를 교체한다.
secret 변경 시 자동 재시작은 restart 영향이 검증된 항목에만 켠다. Infisical 연결이 일시 중단돼도
기존 Secret과 pod는 유지되지만 신규 동기화·rotation 실패를 runbook과 alert로 다룬다.

### 8.3 Secret namespace 초안

초기에는 monorepo와 대응하는 Secrets Management project `eatbid` 하나를 사용한다. environment는
`dev | staging | prod`, 첫 path segment는 `runtime | platform | tooling`, 두 번째 segment는 실제
consumer다. 따라서 Linear workflow key의 유일한 위치는
`eatbid / dev / tooling/linear / LINEAR_API_KEY`다.

```text
eatbid
  dev | staging | prod
    /runtime/{web|server|dataplane|shared}
    /platform/{github|argo|kubernetes|cloudflare}
    /tooling/{linear|local}
```

`infra`, `ci`, `agent`, `local`은 environment가 아니라 consumer 또는 실행 방식이므로 path와 identity로
표현한다. project는 application/service/repository 수준 격리 경계이므로 서로 다른 admin, audit,
approval 또는 metadata isolation 요구가 생길 때만 분리한다. 정확한 탐색·등록·복구 절차는
[`docs/operations/infisical.md`](../../operations/infisical.md)가 권위다.

### 8.4 Zod 기반 secret contract library

범용 `packages/shared`에 넣지 않고 전용 `packages/config`를 `@eatbid/config`로 노출한다. 이 패키지는
**비밀을 발급하거나 보관하거나 Infisical에서 가져오지 않는다.** 키의 계약을 선언하고, 이미 주입된
`process.env`를 scope별로 검증하며, 사람이 발급·폐기할 위치를 안내한다.

```text
packages/config/
  src/catalog.ts
  src/contracts/web-public.ts
  src/contracts/web-server.ts
  src/contracts/server.ts
  src/contracts/dataplane.ts
  src/contracts/agent-workflow.ts
  src/load.ts
```

각 항목은 최소 다음 non-secret metadata를 가진다.

- 안정적인 `id`와 실제 환경변수 `name`
- `issuer.name`, 발급 console `issueUrl`, 공식 `docsUrl`, 폐기·회전 `revokeUrl`
- 상세 `purpose`, `owner`, `consumers`, `exposure`(`public-build | server | agent | ci`)
- Infisical project/environment/path와 적용 환경
- required/optional, 회전 방식·권장 주기, 사고 시 조치
- 값 자체가 아닌 prefix·URL·enum·길이 등의 Zod schema

Zod 4 custom registry가 schema와 typed metadata를 묶고 중복 `id`를 거부하므로 catalog의 기반으로
적합하다. 예시는 다음 의도를 가진다.

```ts
const linearApiKey = z.string().min(32).regex(/^lin_api_/).register(secretRegistry, {
  id: 'linear.agent-workflow.api-key',
  name: 'LINEAR_API_KEY',
  issuer: {
    name: 'Linear',
    issueUrl: 'https://linear.app/eatbid/settings/account/security',
    docsUrl: 'https://linear.app/developers/graphql'
  },
  purpose: 'Linear issue claim과 handoff comment를 위한 최소권한 API key',
  owner: 'developer-workflow',
  consumers: ['agent-workflow'],
  exposure: 'agent',
  infisical: { project: 'eatbid', environment: 'dev', path: '/tooling/linear' }
});
```

`loadServerEnv()`와 `loadAgentWorkflowEnv()`처럼 소비자별 loader만 export한다. `loadAllSecrets()`나
전체 catalog 값 조회 API는 만들지 않는다. `NEXT_PUBLIC_*` contract는 server-only contract와 별도
entry point로 분리해 번들 경계를 정적으로 지킨다. schema default에 실제 credential을 넣지 않고,
validation 오류에도 값이나 부분 값을 출력하지 않는다.

catalog에서 `.env.example`, 사람이 읽는 secret inventory, 누락 키 안내를 생성한다. `secrets:doctor`
명령은 누락된 이름·용도·발급 URL만 보여 주고 값을 읽거나 생성하지 않는다. provider API로 실제 키를
발급하는 기능은 권한 변경이므로 library side effect가 아니라 별도 human-gated admin workflow로 둔다.

Infisical에는 catalog 전체를 손으로 복제하지 않는다. secret comment에는 한 줄 목적과 catalog `id`,
metadata에는 `catalog_id`, `owner`, `consumer`, `issuer`, tag에는 `runtime | agent | ci` 정도만 mirror한다.
장문의 설명과 Zod contract는 Git이 권위이며, 실제 값·version·rotation state는 Infisical이 권위다.
후속 `secrets:catalog:check`가 값은 출력하지 않고 이름·path·metadata drift만 검사한다.

### 8.5 Git 암호화 방법 비교

| 선택지 | 강점 | eatbid에서의 한계 | 판정 |
|---|---|---|---|
| SOPS+age | YAML/JSON/ENV 값을 항목별 암호화해 offline 복구 가능 | Infisical과 이중 SSOT가 되고 복호 key를 별도 보관해야 함 | 현재 제외; 별도 ADR에서만 재검토 |
| dotenvx | cross-platform encrypted `.env`, 환경별 private key, `run --redact` UX | 운영값 사본과 별도 runtime wrapper가 생기며 redaction이 agent 권한을 제한하지 않음 | 비운영 local fallback만 |
| git-crypt | checkout/commit이 투명함 | 이미 준 권한 revoke·key rotation이 어렵고 일부 GUI가 평문을 남길 수 있음 | 제외 |
| External Secrets Operator | backend-neutral한 `SecretStore`/`ExternalSecret`; Infisical Kubernetes Auth 지원 | native Kubernetes Secret과 고권한 controller를 보호해야 함 | K8s 전달기 1순위 |
| Sealed Secrets | target cluster만 복호하는 Kubernetes GitOps | controller key 복구가 필요하고 ESO와 Secret writer가 중복됨 | Infisical 채택 시 제외 |
| Infisical | 환경/path RBAC, metadata, machine identity, OIDC, Kubernetes 전달, audit/rotation | user CLI session 만료와 중앙 서비스 장애를 운영해야 함 | 현재값 SSOT |

복구 snapshot 요구가 생기면 application repo 포함 여부, 생성 권위, 복호 identity, restore drill을
별도 threat model과 ADR에서 먼저 결정한다.

### 8.6 Secret-zero와 로그인 마찰

어떤 중앙 secret manager도 첫 credential인 `secret-zero`를 완전히 없애지는 못한다. 차이는 이를
어디에, 얼마나 큰 권한으로, 얼마나 오래 보관하는가다.

- 사람의 기본 로컬 흐름은 `infisical login` session을 OS keyring에 보관하고 만료 시 다시 로그인한다.
  현재 관측된 마찰만으로 장기 machine credential을 추가하지 않는다.
- 무인 반복 작업이 실제로 막힐 때만 Universal Auth/OIDC/Kubernetes Auth를 선택한다. wrapper는
  short-lived token을 발급하고 즉시 대상 명령을 실행하며 token이나 target secret을 파일·shell
  history·agent prompt에 쓰지 않는다.
- `/tooling/linear`, `/runtime/server`처럼 identity 자체의 접근 범위를 분리한다. 하나의 bootstrap으로
  모든 dev/prod secret을 읽게 하지 않는다.
- 이후 GitHub Actions와 Kubernetes에서는 로컬 bootstrap을 복사하지 않고 각각 OIDC와 service
  account identity로 교체한다.

### 8.7 검증 gate

1. 새 terminal에서 cached login이 만료 전까지 동작하고 만료 후 한 번의 명확한 재인증으로 복구된다.
2. 모든 required key에 목적·owner·consumer·발급/문서/폐기 URL·Infisical 위치·Zod schema가 있다.
3. web public loader가 server/agent secret을 import하거나 browser bundle에 포함할 수 없다.
4. agent가 `/tooling/linear`만 주입받고 다른 dev/prod secret을 읽지 못한다.
5. 로그, validation error, CI artifact, agent transcript, Linear comment에 secret 값이 남지 않는다.
6. GitHub Actions는 OIDC로, ESO는 Kubernetes Auth로 장기 human credential 없이 필요한 scope만 읽는다.
7. secret rotate 후 대상 workload만 갱신하고 old credential이 폐기된다.
8. catalog와 Infisical의 이름·path·metadata drift 검사가 값 노출 없이 실패한다.
9. 별도 ADR 전에는 Git에 SOPS snapshot이나 다른 secret value 사본이 존재하지 않는다.
10. Infisical 장애 중 기존 workload의 동작과 신규 배포 실패가 각각 명시적으로 관측된다.
11. ESO identity에는 read만 있고 `PushSecret`, broad `dataFrom`, 두 번째 Secret writer가 존재하지 않는다.

## 9. 적용 순서

1. 이 설계를 사용자와 검토하고 `accepted` 또는 수정으로 판정한다.
2. 승인된 제품 부분을 `docs/product/roadmap.md`와 문서 거버넌스에 승격한다.
3. Linear에 `Start here` 문서, issue template, 최소 view를 구성한다.
4. R1 M1의 작은 행동 변경에서만 OpenSpec을 파일럿한다.
5. ADR 0022의 Infisical 경계를 k3d/dev proof와 별도 infrastructure issue로 구현한다.
6. R1 M1→M5를 실제 유료 cycle로 검증하고 R2의 두 retention wedge를 비교한다.
7. 반복이 증명된 절차만 hook·Skill·장기 agent orchestration으로 자동화한다.

## 10. 비목표

- 현재 세션에서 Infisical 조직·project·machine identity 또는 External Secrets Operator를 설치하지 않는다.
- 현재 세션에서 다른 writing session의 DB·backend·infra 파일을 수정하지 않는다.
- 제품 효능이 검증되지 않은 추천가·예측가·전략 leaderboard를 출시하지 않는다.
- 모든 기존 문서를 한 번에 이동·삭제하거나 전체 시스템을 Spec Kit/OpenSpec으로 역문서화하지 않는다.
- agent에게 production secret 전체를 주입해 편의성을 확보하지 않는다.

## 11. 공식 근거

- [Linear Documents](https://linear.app/docs/documents)
- [Linear Agents and Agent Guidance](https://linear.app/docs/agents-in-linear)
- [OpenAI Harness engineering](https://openai.com/index/harness-engineering/)
- [Anthropic Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [GitHub Spec Kit](https://github.github.com/spec-kit/)
- [Infisical CLI `run`](https://infisical.com/docs/cli/commands/run)
- [Infisical CLI login과 OS keyring](https://infisical.com/docs/cli/commands/login)
- [Infisical machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities)
- [Infisical GitHub Actions OIDC](https://infisical.com/docs/integrations/cicd/githubactions)
- [External Secrets Operator Infisical provider](https://external-secrets.io/latest/provider/infisical/)
- [External Secrets Operator security best practices](https://external-secrets.io/latest/guides/security-best-practices/)
- [Infisical secret reference와 import](https://infisical.com/docs/documentation/platform/secret-reference)
- [Infisical secret comments와 tags](https://infisical.com/docs/documentation/platform/secrets-mgmt/project)
- [Infisical secret metadata API](https://infisical.com/docs/api-reference/endpoints/secrets/list)
- [Zod 4 metadata와 registry](https://zod.dev/metadata)
- [SOPS](https://getsops.io/docs/)
- [dotenvx encryption](https://dotenvx.com/docs/quickstart/encryption/)
- [git-crypt](https://github.com/AGWA/git-crypt)
- [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
- [1Password CLI secret references](https://developer.1password.com/docs/cli/secrets-scripts)
- [Doppler CLI](https://docs.doppler.com/docs/cli)
- [Doppler GitHub OIDC](https://docs.doppler.com/docs/github-oidc-examples)
- [Doppler Kubernetes OIDC](https://docs.doppler.com/docs/kubernetes-operator-oidc)
- [Bitwarden Secrets Manager CLI](https://bitwarden.com/help/secrets-manager-cli/)
- [SOPS `exec-env`](https://getsops.io/docs/usage/advanced/)
- [Argo CD secret management](https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/)
