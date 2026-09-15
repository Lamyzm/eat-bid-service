---
id: ARC42
status: active
canonical_for: arc42-whole-system-narrative
last_reviewed: 2026-09-16
review_trigger: system-boundary-or-monorepo-layout-change
---

# eatbid arc42

## 1. 소개와 목표

eatbid는 정부 공개 입찰 원본을 보존·정규화하고, 재현 가능한 분석을 공고 발견부터 결과 복기까지
연결하는 급식 입찰 운영 워크스페이스다. 가장 중요한 목표는 다음 순서다.

1. 원본의 무손실 보존과 canonical 사실의 추적성
2. 문자열 추측이 없는 안정적인 기관·지역·업체·공고 정체성
3. 표본/시점/버전이 있는 입찰 분석
4. 여러 법적 사업자를 분리한 사용자 운영 흐름
5. 동일 raw로 다시 계산할 수 있는 수집·분석 런타임

상세 제품 범위와 품질 기준은 [product-and-quality.md](product-and-quality.md)를 따른다.

## 2. 제약조건

| 제약 | 설계에 미치는 영향 |
|---|---|
| eaT가 외부 시스템이며 응답 형식/제한을 우리가 통제하지 못함 | archive-before-parse, schema fingerprint, 보수적 retry, quarantine 필요 |
| 정부 코드 체계가 출처별로 다르고 개편됨 | source-scoped CodeScheme, 유효기간, 명시적 mapping 필요 |
| 현재 Kubernetes는 단일 노드 k3d | HA를 주장하지 않고 backup/restore와 이식성에 집중 |
| 팀/제품이 초기 단계 | 레거시 호환 계층보다 그린필드 전환과 단순한 배포 단위를 선택 |
| 사용자가 NeaT에서 직접 투찰 | 자동 제출을 시스템 경계 밖에 둠 |
| 분석이 핵심이지만 데이터 규모는 PostgreSQL 범위 | canonical PostgreSQL, 별도 lake/stream/search stack 보류 |
| TypeScript 앱과 Python 수집기 공존 | 단일 모노레포/Git SHA, 언어별 도구체인, DB/API 계약 명시 |

## 3. 시스템 범위와 문맥

사용자는 eatbid Web을 통해 공고·분석·사업자별 작업 상태를 본다. Web은 App Router route lifecycle과
route-private presentation, application shell, 재사용 사용자 capability와 resource별 API consumer adapter를
가진 하나의 modular application이다.
Server만 사용자 command와 업무 권위를 처리한다. Dataplane은 eaT 공개 endpoint를 읽고 R2와
PostgreSQL에 기록한다. 인증 제공자는 사용자 신원을 증명하지만 workspace 권한은 eatbid가 소유한다.

NeaT 실제 제출, eaT 원본 시스템, 인증 제공자, R2, GitHub/GHCR은 외부다. 자세한 관계는
[c4.md](c4.md)의 System Context를 따른다.

## 4. 해결 전략

- **증거와 해석 분리:** R2 raw → `ingest` → PostgreSQL `core`
- **소유권별 SSOT:** `core` source fact, `app` user fact, `mart` derived fact
- **정체성 정상화:** source-scoped external code + 내부 bigint ID
- **변화 보존:** observation/revision append-only, 현재 뷰는 검증된 포인터
- **재현 가능한 분석:** 계산 버전·기준시점·표본·원본 실행을 mart에 고정
- **단순한 애플리케이션 경계:** Next.js Web + NestJS modular monolith + Python dataplane
- **Web resource 경계:** 얇은 route/private presentation + shell + 재사용 capability + resource별 `api` + shared UI, fetch 경계 Zod parse
- **하나의 실행기:** Argo Workflows가 poll/reconcile/backfill/replay를 같은 템플릿에서 실행
- **GitOps:** Argo CD, immutable digest, 커밋된 Drizzle migration

핵심 결정은 [ADR 인덱스](../adr/README.md)에 기록한다.

## 5. 빌딩 블록 뷰

### 5.1 전체

| 블록 | 내부 책임 | 제공 인터페이스 |
|---|---|---|
| `apps/web` | route/RSC composition/private presentation, shell, capability, 계약 기반 resource API와 사용자 상호작용 | Nest public HTTP client/UI |
| `apps/server` | 인증, 도메인 application service, API | versioned HTTP contract |
| `apps/dataplane` | source 수집·정규화·발행·재처리 | CLI commands + run ledger |
| `packages/db` | Drizzle schema와 migration | DB types/migrations |
| `packages/domain` | 언어 중립에 가까운 용어/불변식 | domain primitives/policies |
| `packages/contracts` | HTTP 계약과 호환성 | schemas/DTOs |
| `infra/platform` | Argo/DB/관측 기반 | GitOps manifests |
| `infra/base` + `infra/envs/{prod,dev,smoke}` | 제품 배포·workflow templates(base)와 환경 overlay | GitOps manifests |

목표 모노레포 구조:

```text
eat-bid-service/
├─ apps/
│  ├─ web/
│  ├─ server/
│  └─ dataplane/
├─ packages/
│  ├─ db/
│  ├─ domain/
│  └─ contracts/
├─ infra/
│  ├─ platform/
│  └─ product/
└─ docs/
   ├─ architecture/
   ├─ adr/
   └─ superpowers/specs/
```

### 5.2 Web 내부

```text
app             route lifecycle, metadata, loading/error/not-found, RSC와 route-private presentation
shell           providers, navigation, application chrome
capabilities    재사용 사용자 intent, permission/feedback, form/action orchestration
api             resource별 request/mutation adapter와 Query Options
routing         반복되는 동적 Next 화면 URL builder
shared          범용 config/lib/UI primitive
```

의존 방향은 `app → shell + capability + api resource public/server entry`, `shell → shared`,
`capability → api resource public entry + shared`,
`api resource → api/_transport + browser-safe contract resource subpath + shared`다.
API resource끼리, capability끼리 서로의 내부를 import하지 않고 cross-slice 소비는 client-safe `index.ts`와
명시적 `server.ts`만 통과한다. `server.ts`는 internal origin, cookie/cache 같은 RSC 전용 의존성을 client
graph에 재수출하지 않는다.

`app`, `shell`, capability는 필요할 때 `routing/<resource>`를 소비하고 routing은 Next `Route` type과
`@eatbid/contracts` identifier atom만 의존한다. routing은 API operation, network나 server state를 소유하지
않는다.

한 route에만 필요한 presentation과 interactive leaf는 segment의 `_model`/`_ui`/`_lib`가 소유한다.
두 route에서 쓴다는 이유만으로 capability를 만들지 않고 독립 intent, command/permission/feedback lifecycle
또는 여러 resource orchestration이 있을 때만 capability로 승격한다.

이 방향은 내부 project edge를 제한한다. shell의 provider와 API의 Query Options처럼 각 책임에 필요한
승인된 외부 toolkit은 해당 layer가 직접 import할 수 있다.

operation method/path와 wire schema는 `packages/contracts`, endpoint 구현과 업무 use case는 Nest가
소유한다. Web API resource는 consumer adapter, query key/options와 capability-neutral selector의 배치만
소유한다. command adapter와 mutation option도 resource에 두고 form draft, 인증/권한, 사용자 피드백과
여러 resource orchestration은 capability에 둔다.

operation registry는 method, version, semantic path/parameter, request/response/problem schema,
implementation owner와 operation ID를 함께 소유한다. 같은 framework-neutral path definition에서 Nest
adapter path/version, OpenAPI template와 Web request builder를 파생하고 canonical `/api/v1/...` literal을
Server/Web에 반복하지 않는다. Next 화면 URL의 권위는
`app/` file-system과 `next typegen` 생성 route type이며, 반복 동적 URL만 작은 resource별 builder를 쓴다.
API operation과 화면 route는 서로 다른 namespace와 lifecycle이다.

Server Component가 기본이다. browser API, event, form 또는 Query subscription이 필요한 leaf만 Client
Component로 만든다. route는 metadata, RSC read/prefetch와 shell model 주입에 한해 API server entry를
직접 사용한다. shell은 session/workspace endpoint를 읽지 않고 상위 layout이 검증해 전달한 serializable
view만 렌더링한다. 상세 규칙은
[frontend-application-foundation.md](frontend-application-foundation.md)와 ADR 0023을 따른다.

### 5.3 Server 내부

`procurement`, `institutions`, `suppliers`, `eligibility`, `workspace`, `intelligence`,
`contracts`, `operations` 모듈로 나눈다. 하나의 NestJS deployable이며 모듈 간 command/query
interface를 둔다. 데이터 테이블과 HTTP DTO를 같은 타입으로 취급하지 않는다.
Nest가 HTTP/DI/resource lifecycle을 소유하고 Effect는 application use case의 typed execution에
제한한다. Controller→application→domain/infrastructure 의존 방향, Drizzle repository/Unit of Work,
guard/pipe/interceptor/filter의 책임은
[backend-application-foundation.md](backend-application-foundation.md)와 ADR 0016을 따른다.

### 5.4 Dataplane 내부

`discover`, `capture`, `normalize`, `validate`, `project`, `replay` CLI가 같은 image에 있다.
Source adapter는 transport/payload 해석만 담당하고 canonical projector는 별도 계층이다.
손으로 작성한 Pydantic 모델은 source 계약을 검증하고 Zod JSON Schema에서 생성한 Pydantic 모델은
normalized interchange를 검증한다. dataplane은 product server HTTP를 거치지 않고 제한된 DB role로
발행한다.

Application `AuctionRecord`는 내부 read port이지 public wire DTO가 아니다. PostgreSQL row adapter는
`apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts`의 `AuctionRow`,
`postgresInstant`, `mapAuctionRow`에서만 driver `Date | string`을 받아 즉시 Temporal/domain 값으로
닫는다. HTTP는 `packages/contracts` Zod schema에서 추론한 `AuctionV1Response`를 검증해 내보낸다.

## 6. 런타임 뷰

### 열린 공고 갱신

1. CronWorkflow가 `poll-open` Workflow를 만든다.
2. discover가 request unit과 기대 건수를 기록한다.
3. capture가 source semaphore를 획득하고 응답을 content-addressed R2에 먼저 쓴다.
4. normalize/validate가 schema와 `TOT_CNT`, 참조 코드, 도메인 불변식을 확인한다.
5. projector가 새 revision과 publication을 트랜잭션으로 활성화한다.
6. 영향받은 mart build를 교체하고 freshness/count를 검증한다.

### 실패/격리

raw 저장 후 파싱이 실패하면 observation은 quarantine으로 남고 workflow는 성공으로 위장하지 않는다.
활성 publication은 유지된다. 운영자는 raw, schema fingerprint, parser version, 오류 category로
진단한 뒤 새 코드로 replay한다.

### 사용자 작업

사용자가 공고를 선택하면 API는 workspace/supplier/auction unique grain으로 `BidWorkItem`을
만든다. 사용자의 기록, NeaT 입력 확인, source에서 관측된 submission은 별도 이벤트/사실로
누적되며 reconciled 단계에서 비교된다.

### Canonical Web read

1. route가 decimal bigint string param을 public path schema로 검증한다.
2. RSC, route-private model 또는 capability가 해당 `api/<resource>` public/server entry를 호출한다.
3. `_transport`만 raw `fetch`와 body decode를 수행해 status/Problem Details/abort를 처리하고 resource가
   decode된 2xx `unknown`을 Zod response schema로 parse한다.
4. route-private model 또는 capability가 검증된 wire를 serializable presentation model로 바꾸고 RSC가 렌더링한다.
5. 실제 상호작용/refetch가 필요할 때만 같은 resource Query Options로 hydrate하거나 Client leaf에서 구독한다.

malformed 2xx는 empty state나 임의 기본값이 아니라 계약 오류다. browser와 RSC는 ingress만 다르고 같은
operation/schema parser를 사용한다. browser는 same-origin, RSC의 non-secret `API_URL`은 Git-owned runtime
topology에서 주입한다. `/api/**` ingress는 Nest 전용이며 Web-owned public handler는 별도 prefix/owner/ingress
결정 없이는 만들지 않는다.

## 7. 배포 뷰

`main` PR의 publish 없는 deterministic gate를 먼저 확립한다. 그 뒤 CI는 한 Git SHA로
web/server/dataplane image와 migration artifact를 만들고 GHCR에 push한다.
Argo CD의 platform application은 CRD/controller/storage/ESO 기반을, product application은 migration,
web/server, WorkflowTemplate/CronWorkflow를 동기화한다. 데이터 작업 자체는 Argo Workflows가 실행한다.
CLI local smoke → Infisical workload identity/ESO → manual Workflow proof → product overlay cutover → schedule
activation을 서로 다른 rollback 단계로 유지한다.

CI의 primary publication lane은 Ubuntu에서 `pnpm install --frozen-lockfile`과 `uv sync --frozen` 뒤
`pnpm architecture:check`를 먼저 실행한다. 별도 hosted `windows-latest` portability lane도 같은 frozen
install 뒤 architecture gate와 semantic mutation tests를 실행하며 image build는 두 lane 모두에 의존한다.
이 root gate는 stack 문서, TypeScript/Python semantic AST, 한국어 테스트 명세, JSON Schema와 generated
Pydantic drift를 check mode로 검증하고 추적 artifact를 다시 쓰지 않는다. CRLF/LF는 논리 비교에서
정규화한다. 개별 drift 진단 명령은 `pnpm contracts:check`, `pnpm contracts:python:check`다.

초기 k3d는 단일 장애점이다. R2 raw와 PostgreSQL backup/restore가 생존 전략이며, 고가용성이
필요해지면 CloudNativePG 또는 managed PostgreSQL과 다중 노드 cluster를 별도 ADR로 선택한다.

## 8. 횡단 관심사

### 식별자, 시간, 정량 값

- 내부 관계는 bigint ID, 외부 코드는 source/scheme/code로 식별한다.
- source event time, observed/fetched time, published time, user action time을 Temporal 의미 타입으로 구분한다.
- 행정구역·코드·mapping은 유효기간을 가질 수 있다.
- 금액은 통화를 동반한 exact decimal, 비율은 percentage-point/ratio를 구분한 exact decimal로 다룬다.
- 수량·바이트·좌표·합성 지표는 목적과 단위/분모가 드러나는 타입과 Zod metadata를 가진다.
- Zod interchange/API wire, domain value, Drizzle row, source/generated Pydantic의 권위와 변환 방향은
  [time-and-value-contracts.md](time-and-value-contracts.md)를 따른다.
- ambient `Temporal.Now`는 `packages/domain/src/time/clock.ts`의 `systemClock` 한 곳만 호출한다.
- frontend는 ADR 0023에 따라 API resource fetch 경계에서 public wire를 parse하고 canonical vertical
  slice별로 전환한다. chart/map의 근사 number 변환은 이름 있는 route-private 또는 capability presentation
  adapter에만 두고 canonical 판단·query key·command에는 재사용하지 않는다.
- 이름 기반 좌표 enrichment는 foundation 비목표이며 provenance를 보존하는 별도 Argo 계획이 필요하다.

### 데이터 품질

- raw content hash, schema fingerprint, `TOT_CNT`, unique constraints, FK, domain invariant를 층별 검증한다.
- 추측 대신 `unknown`, 미지원 code, quarantine을 모델링한다.
- source 정정은 overwrite가 아니라 새 revision이다.

### 보안과 개인정보

- 현재 secret value는 Infisical만 권위로 두고 workload/DB 역할과 environment/path 접근권한을
  분리한다. Kubernetes에는 Kubernetes Auth와 ESO로 필요한 key만 전달한다.
- 사업자등록번호 같은 식별정보는 권한과 로그 마스킹을 적용한다.
- workspace tenancy를 API query/command에서 강제한다.

### 관측성

모든 로그·run·publication·mart build를 correlation 가능한 ID와 Git SHA/version으로 연결한다.
신선도, 완전성, quarantine, retry, DB/R2 상태를 측정한다.

### 테스트 전략

- source fixture 계약 테스트와 schema 변화 탐지
- content-addressing/observation 멱등성 테스트
- code scheme 교차 금지와 mapping 유효기간 테스트
- projector golden/replay 결정성 테스트
- publication 원자성/부분 실패 테스트
- workspace/supplier tenant 권한 테스트
- server module dependency direction, HTTP Standard Schema/OpenAPI artifact, RFC 9457 error mapping 테스트
- Web import direction, cross-capability/API deep import와 API resource 간 import 금지 테스트
- client-safe/server-only entry, RSC/Client 경계와 serializable prop 테스트
- public response runtime parse, malformed 2xx/Problem Details/abort와 cache 미오염 테스트
- bigint route ID 무손실, Query invalidation, loading/error/not-found와 empty/stale 상태 테스트
- request correlation/log redaction, authentication guard, readiness/migration mismatch, graceful shutdown 테스트
- migration forward 및 빈 DB 구축 테스트
- backup restore 후 핵심 query smoke test

## 9. 아키텍처 결정

결정의 근거·대안·결과는 [docs/adr](../adr/README.md)에 있다. 문서 본문과 ADR이 다르면 최신
Accepted ADR을 우선하고 같은 변경에서 이 문서를 정정한다.

## 10. 품질 요구사항

최우선은 silent loss 0, raw 추적성, deterministic replay, idempotency, atomic publication이다.
영업시간 열린 공고 source-to-core p95 35분을 초기 SLO로 측정한다. 사용자 상태 RPO 1시간,
핵심 서비스 RTO 4시간은 백업 기반 초기 목표이며 실제 달성 여부를 운영 지표로 공개한다.

구체적인 시나리오와 합격 조건은 [product-and-quality.md](product-and-quality.md)에 있다.

## 11. 위험과 기술 부채

| 위험 | 현재 대응 | 다음 결정 신호 |
|---|---|---|
| source 차단/계약 변경 | semaphore 1, typed failure, raw/schema fingerprint | 요청 제한 실측과 adapter 변경 |
| 정부 코드 mapping 불완전 | scheme 분리, unknown, 근거 있는 mapping | eligibility coverage/오류 지표 |
| 단일 노드/단일 PG 장애 | 외부 R2, WAL/backup, restore drill | RTO/RPO 미달 또는 실제 운영 중요도 상승 |
| mart query 성장 | PG index/partition, 버전된 build | 반복 scan 시간/DB 부하 임계치 초과 |
| 분석의 허위 정밀도 | sample/cohort/as_of/version 강제 | 사용자 오해 조사와 metric audit |
| Python/TS 모델 불일치 | 경계별 계약, fixture/contract tests | payload/API drift 발생 |
| 단위가 지워진 숫자 계산 | semantic value, exact decimal, Zod/AST gate | 새 정량 도메인 또는 외부 단위 추가 |
| route-centric Web 침식 | route-private presentation, capability/API public entry와 import gate | route의 업무 권위 계산·deep import 증가 |
| browser duplicate authority | API runtime parse, URL/query/form/local state 소유권 분리 | localStorage/Zustand에 server/user fact 복제 |
| 계약 없는 화면 선행 | canonical vertical slice와 server-contract gate | legacy endpoint 포장·수동 DTO 재등장 |

미해결이지만 즉시 막지 않는 항목: 최종 운영 PostgreSQL 형태(CNPG vs managed), 인증 제공자,
SLO 조정, 장기 raw retention 기간. 이를 구현자가 임의 선택하지 말고 사용 시점에 ADR로 확정한다.

## 12. 용어집

핵심 용어는 [glossary.md](glossary.md)에 정의한다. 코드와 화면에서 새 동의어를 만들지 말고
그 용어를 사용한다.
