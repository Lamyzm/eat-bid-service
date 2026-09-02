---
status: draft
date: 2026-09-02
linear_issue: EAT-9
canonical_for: none
derived_from:
  - docs/superpowers/specs/2026-08-31-frontend-modular-architecture-design.md
  - docs/adr/0023-nextjs-web-modular-boundaries.md
  - docs/product/screen-system.md
---

# 프론트엔드 기반 후속 구현 계획

> **에이전트 작업자 필수:** 각 작업을 구현할 때 `superpowers:subagent-driven-development`(권장) 또는
> `superpowers:executing-plans` 스킬을 사용한다. 진행 상태는 체크박스(`- [ ]`)로 추적한다.
> 이 문서는 실행 당시 기록이며 완료 후 현재 상태의 원천이 아니다. 담당·상태·blocker는 Linear가 소유한다.

> **저장 시 보정 (2026-09-02, 실행 세션):** 이 문서는 읽기 전용 세션이 작성했고 실행 세션이 다음을 바로잡아
> 저장했다. (1) ADR 번호: 0026은 provider 중립 AI 리뷰, 0027은 예측 승률 경계에 이미 쓰였으므로 Cache
> Components ADR은 **0028**이다. (2) 시작 commit은 main `a5965d1`(EAT-26 병합 이후)이며 worktree는
> `.worktrees/eat-9-web-boundary-gate`(branch `eat-9-web-boundary-gate`)다. (3) 기본 디렉터리는 다른 세션이
> `feat/bid-analysis-engine`으로 쓰고 있어 EAT-9 lease는 기본 디렉터리에 잡되 파일 변경은 위 worktree에서만 한다.

**목표:** EAT-9 첫 slice 이후 남은 기반 공백(legacy 역참조 gate, shell의 legacy fetch, client 업무 계산의
미추적, routing 층의 legacy identity)을 메우고, 사용자가 확정한 navigation·로딩·Cache Components 결정을
문서와 코드에 반영한다. 백엔드 계약이 없는 화면(투찰 업무 목록, 분석 상세, 복기, 성과)은 만들지 않는다.

**아키텍처:** ADR 0023의 `app / route-private / shell / capabilities / api / routing / shared` 층과
frontend-application-foundation.md의 의존 방향을 그대로 유지한다. legacy 코드는 이동하지 않고
fingerprint baseline으로 동결하며 slice 교체 시 삭제한다. 신규 층에서 legacy 디렉터리로의 import만 gate로 막는다.

**기술 스택:** Next.js 16.3.4 App Router/RSC, React 19.2.8, TanStack Query 5.102.8, Tailwind 4.3.3,
`tools/architecture/check-web-boundaries.mjs`, Bun component test, Playwright 1.62.1.

**명세:** [프론트엔드 모듈 아키텍처 설계](../specs/2026-08-31-frontend-modular-architecture-design.md),
[ADR 0023](../../adr/0023-nextjs-web-modular-boundaries.md),
[화면 체계](../../product/screen-system.md)

---

## 0. 배경과 판단 근거

2026-09-02 읽기 전용 세션에서 확인한 사실이다. 새 세션은 이 절을 재조사하지 않아도 되지만 변경할 경계의
gate는 다시 실행한다.

### 0.1 현재 상태

- main `d82c4f0` 기준 EAT-9 첫 slice가 병합됐다. `/auctions/[auctionId]` RSC route, `_model`/`_ui`,
  loading/error/not-found, `api/_transport`, `api/auctions`(`index.ts`/`server.ts` 분리), `shell/`
  provider·theme, `shared/ui` Button/LoadingButton/Skeleton, Playwright e2e 4건.
- 설계 spec §9 전환 순서 10단계 중 1~5단계까지 끝났다. 6~10단계는 session/work-item/analysis Server 계약이
  없어 blocked다.
- sidebar(`src/config/nav-config.ts`)는 스타터 잔재 항목(오늘, 학교 찾기, 개찰 속보, 업체, 시장 지도,
  내 성적, 납품, 내 사업자)이며 새 route는 어디에도 링크되지 않는다. root는 `/dashboard/today`로 redirect한다.

### 0.2 "lib/hooks에 쌓여 있고 FSD가 아닌" 이유

- 출발점은 Kiranism shadcn 스타터다(`docs/DEBT.md` 2026-08-28 감사, `apps/web/scripts/cleanup-templates/`).
  `lib/`, `hooks/`, `components/`, `config/`, `types/`의 수평 구조는 스타터 관습이다.
- Full FSD는 spec §11과 ADR 0023 Rejected alternatives에서 명시적으로 기각됐다. Next `app`이 route 층을
  소유하므로 `pages/widgets`를 더하면 barrel과 용어만 늘어난다는 판단이다.
- legacy는 spec §2·§9와 비목표 "폴더 이동만으로 target-compliant라고 부르지 않는다"에 따라 이동하지 않고
  `tools/architecture/web-boundary-legacy-baseline.json`에 path+SHA 삭제 전용 fingerprint로 동결됐다.
  `--write-baseline`은 최초 inventory에만 허용된다.
- integration design §6과 plan 작업 8은 "navigation/정보구조는 사용자와 기획할 사항"으로 두었다.

### 0.3 실제 공백

1. gate가 raw fetch·파일 크기·unchecked JSON만 잡는다. 신규 층이 legacy 디렉터리를 import하는 방향과
   `lib/band.ts`, `deadline.ts`, `mark-rates.ts`, `rate-text.ts`, `school-id.ts`의 client 업무 계산은
   어떤 baseline에도 없다.
2. `shell/layout/application-shell.tsx` → `components/layout/header.tsx` → `RegionSwitcher`,
   `SessionBoot`, `GlobalSettings*`가 legacy fetch를 canonical route까지 싣는다. ADR 0023 "shell은
   endpoint를 읽지 않는다"와 어긋난다.
3. `src/routing/analysis.ts`가 새 층에서 legacy 복합 문자열 identity(`{시군구}|{학교명}`) route를 만든다.
4. spec §4 구조의 `shell/navigation/`이 비어 있고 sidebar·header는 `components/layout/`에 남아 있다.
5. generic hook의 목적지가 spec 구조에 없다.

### 0.4 2026년 동향 대조 (요약)

- FSD 2.1은 "pages first"로 이동했다. 재사용하지 않는 UI·form·data 로직은 page slice에 두라는 것이며
  이 저장소의 route-private 규칙과 같은 결론이다.
  https://github.com/feature-sliced/documentation/releases/tag/v2.1
- Next.js 공식은 project structure에 무의견이며 private folder와 route group만 제공한다(16.3.4, 2026-07-21).
  https://nextjs.org/docs/app/getting-started/project-structure
- Next.js Data Security 가이드는 `server-only` DAL과 DTO 반환을 권한다. 저장소의 `server.ts`/`_transport`
  분리와 일치한다. https://nextjs.org/docs/app/guides/data-security
- Cache Components 모델에서는 dynamic 접근 가까이의 세분화된 Suspense를 권하며 상위 `loading.js` 하나는
  전체 skeleton으로 떨어진다. https://nextjs.org/docs/app/guides/streaming
- 경계 도구는 eslint-plugin-boundaries·Sheriff·dependency-cruiser가 주류이고 저장소는 자체 checker를 쓴다.
  fingerprint baseline 요구 때문에 자체 checker를 유지하되 규칙 표현은 단순하게 둔다.

## 1. 확정 결정 (2026-09-02, 사용자)

| 항목 | 결정 |
|---|---|
| 전역 navigation | `투찰 업무 /work`, `복기 /review`, `성과 /performance`. screen-system §3 그대로 세 항목만 노출. |
| 분석 상세 URL | spec §4대로 `/work-items/[workItemId]/analysis`. `auctions/` 아래에 두지 않는다. |
| legacy dashboard | 새 route가 생기기 전까지 `/dashboard/*`와 root redirect 유지. 빈 화면 route를 먼저 만들지 않는다. |
| 로딩 전략 | route `loading.tsx`는 첫 경계, panel은 `Suspense` + panel skeleton. spec §6.1을 이 문장으로 갱신. |
| Cache Components | 활성화한다. 단 별도 이슈와 ADR 0028로 조건을 기록한다. EAT-9 제외 항목이므로 EAT-9에서 하지 않는다. |
| legacy 격리 방식 | 폴더 이동 없음. import 방향 gate로만 격리한다. |
| generic hook | `shared/lib/hooks/` 아래. 그 외 hook은 소비 route/capability 내부. 전역 `hooks/`에 신규 파일 금지. |

## 전역 제약

- EAT-9 worktree에서만 작업하고 writing owner 한 명을 유지한다. `pnpm workflow:claim -- EAT-9` 뒤에만 mutation한다.
- 사람이 읽는 문서·문구·테스트명·커밋·이유 주석은 한국어다.
- legacy 파일을 이동하지 않는다. baseline은 삭제 방향으로만 바뀌며 `--write-baseline`을 실행하지 않는다.
- 없는 Server 계약(session, work-item, analysis, market)을 Web에서 만들지 않는다.
- readiness probe 경로 `/dashboard/today`(`infra/k8s/base/app.yaml:130`)를 바꾸지 않는다.
- `loading.tsx`는 route 소유 `ScreenSkeleton` 하나만 반환한다. refetch 중 skeleton 교체 금지.
- 각 작업의 검사가 통과한 뒤에만 task 단위로 커밋한다.
- 작업 4(Cache Components)는 EAT-9 범위 밖이다. 새 Linear issue를 만들고 claim한 뒤에만 시작한다.

---

## 작업 1: legacy 역참조 gate와 client 업무 계산 ledger

**대상 파일:**

- 수정: `tools/architecture/web-boundaries/policy.mjs`
- 수정: `tools/architecture/web-boundaries/inspect.mjs`(규칙 추가에 필요한 경우만)
- 수정: `tools/architecture/check-web-boundaries.test.mjs`
- 수정: `tools/architecture/web-boundary-legacy-baseline.json`
- 수정: `docs/architecture/frontend-application-foundation.md` §7

**경계:**

- 입력: 기존 checker와 baseline 형식(`rule`, `path`, `sha256`, `reason`, `owner`, `splitTrigger`).
- 출력: `legacy-import` 규칙과 `client-domain-calculation` 규칙. 신규 층(`src/app/(workspace)/**`, `src/shell/**`,
  `src/capabilities/**`, `src/api/**`, `src/shared/**`, `src/routing/**`)에서 `@/components/*`, `@/hooks/*`,
  `@/lib/*`, `@/config/*`, `@/types/*` import를 거부한다.
- 금지: 파일 이동, legacy 동작 변경, baseline 재생성.

- [ ] **단계 1: RED fixture를 작성한다.** `shell`이 `@/components/layout/header`를 import하는 fixture,
  `(workspace)` route가 `@/lib/deadline`을 import하는 fixture가 실패하고, `shared/lib/cn`을 import하는 fixture는
  통과함을 한국어 테스트로 적는다. 기존 `ApplicationShell → components/layout/*` edge는 삭제 전용 fingerprint로
  통과해야 한다.
- [ ] **단계 2: 규칙을 구현한다.** policy에 `legacy-import` 규칙을 추가하고 현재 위반(`application-shell.tsx`의
  `@/components/command-palette/command-palette`, `@/components/layout/app-sidebar`, `@/components/layout/header`,
  `@/components/ui/infobar`, `@/components/ui/sidebar` import)을 baseline에 `owner: EAT-9`,
  `splitTrigger: "shell/navigation 이동(작업 3)에서 삭제"`로 등록한다.
- [ ] **단계 3: client 업무 계산을 등록한다.** `client-domain-calculation` 규칙은 `src/lib/**`의 export 함수 중
  금액·비율·마감·식별자 계산(`band.ts`, `deadline.ts`, `mark-rates.ts`, `rate-text.ts`, `school-id.ts`)을 대상으로
  하며 `reason: "legacy client 업무 계산. 해당 값은 Server 계약 응답으로 대체 후 삭제"`,
  `splitTrigger: "해당 화면 slice를 api/<resource> 계약으로 교체할 때"`로 등록한다. 규칙 식별은 파일 목록이 아니라
  AST(숫자 연산이 있는 exported function)로 하되 첫 버전은 명시 path 목록도 허용한다. 이유를 policy 주석에 남긴다.
- [ ] **단계 4: 문서.** foundation §7 quality gate 목록에 "legacy import: 신규 층은 `components/hooks/lib/config/types`를
  import하지 않는다. client 업무 계산은 삭제 전용 ledger로 고정한다." 두 줄을 추가한다.
- [ ] 실행한다.

```text
node --test tools/architecture/check-web-boundaries.test.mjs
node tools/architecture/check-web-boundaries.mjs
pnpm architecture:check
pnpm --filter @eatbid/web typecheck
git diff --check
```

- [ ] 커밋한다.

```text
test(architecture): Web 신규 층의 legacy 역참조를 차단한다
```

## 작업 2: routing 층의 legacy identity 제거와 hook 배치 규칙

**대상 파일:**

- 이동: `apps/web/src/routing/analysis.ts` → `apps/web/src/app/dashboard/analysis/_lib/analysis-route.ts`
- 이동: `apps/web/src/routing/analysis.test.ts` → 같은 `_lib/`
- 수정: 해당 builder를 import하는 legacy 화면(`rg "routing/analysis"`로 확인)
- 수정: `tools/architecture/web-boundaries/policy.mjs`(`hooks/` 신규 파일 거부)
- 수정: `tools/architecture/check-web-boundaries.test.mjs`
- 수정: `docs/architecture/frontend-application-foundation.md` §1, §3.1

**경계:**

- 입력: 작업 1의 gate.
- 출력: `src/routing/`에 `/dashboard/*` builder가 없다. `src/hooks/`에 새 파일을 만들면 gate가 실패한다.
- 금지: 기존 `hooks/*` 이동, `use-mobile` 중복 해소(별도 baseline 항목).

- [ ] **단계 1: RED.** `src/routing/*.ts`가 `/dashboard/` literal을 포함하면 실패하는 fixture, `src/hooks/new-hook.ts`
  추가가 실패하는 fixture를 한국어로 작성한다.
- [ ] **단계 2: 이동.** builder를 legacy 소비자 옆 `_lib/`로 옮기고 import를 갱신한다. 이 파일은 legacy이므로
  baseline에 `legacy-identity` 항목(`reason: "복합 문자열 학교 identity. canonical organization route가 생기면 삭제"`)으로 등록한다.
- [ ] **단계 3: 문서.** foundation §1 표에 "브라우저 generic hook은 `shared/lib/hooks/`, 그 외 hook은 소비하는
  route-private 또는 capability 내부"를 추가하고, §3.1에 "`routing/`은 canonical decimal ID route만 만든다.
  legacy identity route builder는 legacy route 옆 `_lib`에 둔다"를 추가한다.
- [ ] 실행한다(작업 1 명령 + `pnpm --filter @eatbid/web test`).
- [ ] 커밋한다.

```text
refactor(web): routing 층에서 legacy identity를 분리한다
```

## 작업 3: shell/navigation 이동과 제품 navigation 교체

**대상 파일:**

- 생성: `apps/web/src/shell/navigation/app-sidebar.tsx`(`components/layout/app-sidebar.tsx`에서 이동)
- 생성: `apps/web/src/shell/navigation/header.tsx`(`components/layout/header.tsx`에서 이동, legacy control 제거)
- 생성: `apps/web/src/shell/navigation/nav-config.ts`(`config/nav-config.ts`에서 이동, 세 항목으로 교체)
- 생성: `apps/web/src/shell/navigation/breadcrumbs.tsx`
- 생성: `apps/web/src/app/dashboard/_ui/legacy-header-controls.tsx`(`RegionSwitcher`, `SessionBoot`,
  `GlobalSettingsButton/Dialog` 조합)
- 수정: `apps/web/src/shell/layout/application-shell.tsx`(header slot prop 추가)
- 수정: `apps/web/src/app/dashboard/layout.tsx`(legacy controls를 slot으로 주입)
- 수정: `apps/web/src/app/(workspace)/layout.tsx`
- 호환 re-export로 교체: `components/layout/app-sidebar.tsx`, `components/layout/header.tsx`, `config/nav-config.ts`
- 수정: `apps/web/e2e/frontend-foundation.spec.ts`
- 수정: `docs/product/screen-system.md` §3(URL segment 한 줄)
- 수정: `tools/architecture/web-boundary-legacy-baseline.json`(작업 1에서 등록한 shell edge 삭제)

**경계:**

- 입력: 작업 1의 gate, 결정 표의 navigation.
- 출력: `ApplicationShell`이 `header` slot을 받고 endpoint를 읽지 않는다. `(workspace)` route에는 legacy fetch
  component가 없다. `/dashboard/*`는 지역 filter·설정 dialog가 그대로 동작한다.
- 금지: `/work`, `/review`, `/performance` page 생성, session 계약, sidebar에 존재하지 않는 route 링크.

- [ ] **단계 1: RED.** `(workspace)` route markup에 `RegionSwitcher`/`SessionBoot` data-slot이 없음을 확인하는 e2e,
  `/dashboard/today`에는 있음을 확인하는 e2e를 한국어로 작성한다. 작업 1의 shell legacy-import fixture가 이제
  baseline 없이 통과해야 한다.
- [ ] **단계 2: 이동.** sidebar·header·breadcrumbs·nav-config를 `shell/navigation/`으로 옮기고 옛 path에 re-export를
  남긴다. header에서 legacy control을 제거하고 `header` slot으로 받는다.
- [ ] **단계 3: navigation 교체 시점.** `nav-config`를 `투찰 업무 | 복기 | 성과` 세 항목으로 바꾸는 것은 typed route가
  없으면 typecheck가 실패한다. 따라서 이 단계는 **`/work` route가 생기는 slice와 같은 PR**에서만 수행하고,
  그 전까지 nav-config는 legacy 항목을 유지하되 파일 위치만 `shell/navigation/`으로 옮긴다. 이 제약을
  nav-config 상단 이유 주석으로 남긴다.
- [ ] **단계 4: 문서.** screen-system §3 표 아래에 "URL: 투찰 업무 `/work`, 복기 `/review`, 성과 `/performance`,
  분석 상세 `/work-items/[workItemId]/analysis`"를 추가한다.
- [ ] 실행한다.

```text
node tools/architecture/check-web-boundaries.mjs
pnpm --filter @eatbid/web test
pnpm --filter @eatbid/web test:e2e:foundation
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web build
```

- [ ] 커밋한다.

```text
refactor(web): navigation chrome을 shell로 옮기고 legacy control을 분리한다
```

## 작업 4: Cache Components 활성화 (별도 issue, ADR 0028)

**선행:** 새 Linear issue "Cache Components를 조건부로 활성화한다"를 만들고 claim한다. EAT-9 worktree를 그대로
쓰되 lease를 새 issue로 바꾼다(`pnpm workflow:release` 뒤 `pnpm workflow:claim -- EAT-xx`). 작업 3 뒤에 수행한다.

**대상 파일:**

- 생성: `docs/adr/0028-cache-components-and-self-hosted-cache.md`
- 수정: `docs/adr/README.md`
- 수정: `apps/web/next.config.ts`(`cacheComponents: true`, 보류 주석 제거)
- 수정: `apps/web/src/app/layout.tsx`(theme cookie → `<head>` inline script로 `data-theme` 설정)
- 수정: `apps/web/src/shell/layout/application-shell.tsx`(sidebar cookie 읽기를 Suspense 안 `SidebarStateLoader`로 분리)
- 수정: `apps/web/src/app/(workspace)/auctions/[auctionId]/page.tsx`(`params` await를 Suspense 안 loader로 이동,
  fallback은 `AuctionScreenSkeleton`)
- 수정: `apps/web/src/app/dashboard/**/{page,layout}.tsx`(`export const instant = false`, codemod)
- 수정: `docs/architecture/stack/application-runtime.md`(Cache Components 행을 "채택, 조건부")
- 수정: `docs/architecture/frontend-application-foundation.md` §2(로딩 전략 문장), §7 compiler 항목
- 수정: `docs/superpowers/specs/2026-08-31-frontend-modular-architecture-design.md` §6.1(결정 표의 로딩 전략)
- 수정: `apps/web/AGENTS.md`(Cache Components 문장)
- 수정: `apps/web/e2e/frontend-foundation.spec.ts`

**확인된 사실(공식 문서 16.3.4, 2026-06-22/08-25):**

- `cookies()`로 `<html data-theme>`을 정하는 root layout은 감쌀 자식이 없으므로 `<head>` inline script로
  속성을 설정해 shell을 static으로 유지한다. https://nextjs.org/docs/app/guides/migrating-to-cache-components
- `cookies()`, `headers()`, `params`, `searchParams`는 Suspense 안에서 await한다. 상위 `loading.tsx`는 유효한
  경계지만 static shell을 위해서는 page 안 Suspense가 권장된다.
- legacy route는 `npx @next/codemod@canary cache-components-instant-false ./src/app/dashboard`로 검증에서
  제외할 수 있다. `new Date()`, `Math.random()` 같은 동기 IO는 `instant = false`로도 우회되지 않는다.
- `use cache`는 pod별 in-memory다. 현재 web replica는 1(`infra/k8s/base/app.yaml`)이므로 당장 문제는 없지만
  replica를 늘리기 전 `cacheHandlers`와 `refreshTags`가 필요하다. https://nextjs.org/docs/app/guides/self-hosting
- PPR은 streaming 없이는 이점이 없다. Cloudflare Tunnel + Ingress 경유 시 버퍼링 여부를 확인한다.
- Activity로 route 상태가 보존돼 `GlobalSettingsDialog`, dropdown, sidebar가 뒤로가기 후 열린 채 남을 수 있다.
- Vercel `next-cache-components-adoption` skill(incremental 모드)이 이 저장소의 slice 방식과 맞는다.

**ADR 0028 수용 조건:** replica 1에서는 in-memory 허용, replica 증가 전 shared cache handler 필수, edge runtime
금지, `use cache`는 `api/<resource>/server.ts`의 read 함수에만 허용하고 사용자별·session 의존 데이터에는 금지,
`updateTag`/`revalidateTag`는 resource server entry가 소유.

- [ ] **단계 1: ADR과 문서 갱신을 먼저 커밋한다.** 코드 변경 전에 결정을 기록한다.
- [ ] **단계 2: RED.** 다음 e2e를 한국어로 작성한다. `/auctions/:id`에서 status role이 heading보다 먼저 보인다.
  light/dark 전환과 hard refresh에서 FOUC가 없다(`data-theme`가 첫 paint 전 설정). `/dashboard/today`가 그대로
  렌더된다.
- [ ] **단계 3: flag를 켜고 validation을 따라간다.** dev overlay의 blocking-prerender insight를 canonical route에서
  0건으로 만든다. legacy route는 codemod로 `instant = false`.
- [ ] **단계 4: streaming 확인.** dev 환경의 Tunnel + Ingress 경로에서 첫 chunk가 shell을 먼저 보내는지 확인하고
  결과를 PR evidence에 남긴다. 버퍼링되면 `X-Accel-Buffering: no` header를 `next.config.ts` `headers()`에 추가한다.
- [ ] 실행한다.

```text
pnpm --filter @eatbid/web build
pnpm --filter @eatbid/web test
pnpm --filter @eatbid/web test:e2e:foundation
pnpm architecture:check
pnpm quality:check
```

- [ ] 커밋한다.

```text
feat(web): Cache Components를 조건부로 활성화한다
```

## 후속 (이 계획 범위 밖)

- `/work` 목록 + 판단 도크, `/work-items/[workItemId]/analysis`는 work-item·analysis evidence Server 계약 뒤
  spec §9 7~8단계로 진행한다. 그때 sidebar를 세 항목으로 교체한다(작업 3 단계 3).
- session/permission 계약이 생기면 `shared/action`과 shell adapter를 spec §7.2대로 만든다.
- `components/ui/*` 나머지는 각 primitive를 실제로 변경할 때 `shared/ui`로 옮긴다(baseline splitTrigger).
- `lib/session.ts`, `use-persisted-state.ts` 등 persistence는 해당 slice 교체 시 삭제한다.

## 인계 본문 (Linear worklog용)

```text
issue: EAT-9
branch/worktree: eat-9-web-boundary-gate · F:\Project\eat-bid-service\.worktrees\eat-9-web-boundary-gate
start commit: a5965d1
완료: 첫 slice 병합. 이 계획의 작업 1~3이 EAT-9 후속 범위.
검증: 이전 세션은 읽기 전용. 시작 시 pnpm architecture:check, pnpm --filter @eatbid/web test 로 baseline green 확인.
미완료/첫 단계: 이 문서 커밋 → 작업 1.
금지: legacy 파일 이동, --write-baseline, 없는 Server 계약 mock, readiness probe 경로 변경, deploy/tag.
알려진 위험: 0.3절 참조. Cache Components는 별도 issue.
```
