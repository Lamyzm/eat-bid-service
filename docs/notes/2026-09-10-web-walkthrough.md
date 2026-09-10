# 2026-09-10 web 전체 훑기 메모

사용자와 화면·모듈을 하나씩 열어 보며 적는 작업 메모다. 결정의 권위는 이 메모가 아니라 여기서 파생한
Linear issue와 ADR이며, 훑기가 끝나면 issue로 옮기고 이 파일은 그 색인으로만 남긴다.

## 0. 이번 훑기의 전제 (사용자 결정)

- 공개 화면 없음. 모든 화면은 로그인해야 본다. SEO는 사이트 자체가 검색되는 정도면 되고 공고 데이터는 공개하지 않는다(엔터프라이즈 도구).
- 예상 사용자 200~300명, 1만 명까지 버티면 좋다.
- dock(우측 전역 바로가기)은 뺄 수 없다. 레이아웃 체계는 `docs/product/screen-system.md`가 정한다.
- 색상 테마 12종은 유지(전부 고를 수 있어야 한다).
- 300줄 규칙은 권고이지 금지가 아니다(EAT-134에서 advisory).
- CF는 앞단에 두고 캐시도 한다. 대신 purge가 정합해야 한다.
- **`/today`는 임시 진입점이다.** 정합한 진입 설계는 나중에 따로 한다. 아래 `/today` 항목 중 진입·라우팅에
  관한 것(경로 이름, 진입 redirect, 필터 왕복)은 그 설계에 넘기고, 표·문구·계약처럼 화면이 바뀌어도 남는
  것만 지금 issue로 만든다.

## 1. 아키텍처 판단 (걷는 중 확정한 것)

- 비용은 셋이다. 계산(이미 dataplane이 mart로 미리 함), DB 읽기(Next `use cache`가 build당 조합마다 1회로 고정), 렌더(Next RSC, ms 단위, 파드로 선형 확장). 클라이언트나 CF로 떠넘길 부하는 렌더뿐이라 값어치가 작다.
- 규칙: 무거운 계산은 요청 시점에 하지 않는다(mart). 공유 데이터는 서버 read + `use cache`(build 키), 사용자별 데이터는 캐시하지 않는다(`privateServerRequest`). 브라우저는 상호작용 뒤 데이터만 직접 부른다(TanStack).
- CF 1차는 A안: 정적 자산·터널·WAF만. 데이터 캐시 소유자는 dataplane 발행 step → web `/internal/cache/revalidate` 하나이며, CF에 데이터를 캐시하는 날이 오면 같은 handler가 같은 사건에서 CF purge까지 한다(소유자 둘 금지, ADR 0036). purge-by-tag는 Enterprise, 무료는 URL 30개/전체 purge뿐이라 B안(브라우저→CF→Worker 인증)은 k6 측정에서 web CPU 병목이 나올 때만.
- 1만 명이 한 노드로 되는 조건 셋: build 활성화 직후 캐시 폭주 방지(push 무효화 + 긴 만료 + stale-while-revalidate), 세션 확인이 요청마다 DB를 치지 않게(Better Auth cookie cache 또는 Nest 메모리), 상호작용 read에 키 캐시(명단은 revision당 불변).
- 측정 없이 1만을 주장하지 않는다. k6 300명·1만 명 프로필, p95와 DB QPS, "DB QPS가 사용자 수에 비례하지 않음"을 숫자로.

## 2. 도달 가능한 뷰 (main, `app/` 기준)

`/` → `/today` redirect · `/today` · `/auctions/[auctionId]` · `/login` · `/setup` · `not-found`(영문 스타터 문구) · `global-error`(Sentry) · route `/internal/cache/revalidate`. 공통 chrome은 `ApplicationShell`(사이드바·헤더·dock·테마) + `AccountHub`. 사이드바 항목은 오늘·내 사업자 둘. 운영 v0.1.25는 dashboard 삭제(17a43566) 이전 이미지라 옛 메뉴 5개(학교 찾기·개찰 속보·업체·내 성적·납품)가 아직 보이고 다음 릴리즈에서 사라진다. `/dashboard/*`는 죽은 경로.

## 3. `/today` 관찰

파일 9개 1,128줄. `page.tsx`(RSC, Suspense 안 URL 조건) → `load-today-page.ts`(계약 schema로 URL 검증, 조회, 사라진 cursor 1회 재조회) → `present-open-auctions.ts` → `today-screen.tsx`(수집 전/0건/목록 3상태) + filters/table/frame/skeleton.

잘 된 것: URL이 상태의 원천, 칩이 링크, cursor 소멸을 값으로 처리, 표 위 계보 한 줄(규칙 7), 조건 자동 확장 안 함, soft navigation(transition이라 skeleton 깜빡임 없음, prefetch·router cache).

고칠 후보:
- 필터를 클라이언트 필터링으로. 열린 공고는 전부 385건(약 100KB)이라 한 번 받아 두고 칩은 배열을 거른다. 왕복·scroll-to-top이 사라지고 서버 캐시 항목이 조합 수백 개 → build당 1개. URL은 nuqs가 클라이언트에서 동기화. (결정 화면의 코호트 변경은 데이터가 달라져 서버 왕복이 맞다.)
- 표의 "내 기록" 열이 항상 `없음` 하드코딩(`open-auction-table.tsx` 148행). 로그인 사업자의 기록을 붙이거나 그전엔 열을 뺀다.
- 기관 아래 지역이 "코드 4 코드 721"로 찍힌다. API `region.sido.label`·`sigungu.label`이 null. 라벨 관측이 없는지 응답에 안 싣는지 확인 필요(사용자: 나중에).
- 명령 검색(Cmd+K, 180줄)은 화면 이동 2개 + 테마 명령뿐. 스타터 잔재 성격. (dock는 유지)
- 404 페이지 영문 스타터 문구 → 한국어(규칙 21).
- 헤더에 "마지막 수집 HH:MM · 다음 HH:MM" 표시(수집 주기 issue와 함께).

### `today-screen.tsx` 분기 (사용자 지적)

- `list` prop이 중첩 삼항이다. 계보 없음, 0건, 목록 셋이 한 식에 들어 있고 마지막 가지는 이름 없는 30줄이다.
- 더 깊은 문제는 화면이 상태를 다시 계산한다는 것이다. 판정 재료가 `hasSnapshotBuild`와 `rows.length === 0`
  두 boolean이다. 결정 화면은 이미 union(`history.state`가 `ready`·`no-organization`·`unavailable`·`build-changed`)으로
  모델링돼 있어 화면이 매칭만 한다. 오늘 화면만 boolean으로 남았다.
- 고칠 방향: `present-open-auctions.ts`가 `{ kind: 'no-snapshot' | 'empty' | 'list' }`를 돌려주고 화면은
  `switch (view.kind)` 세 갈래로 early return. 목록 가지는 `OpenAuctionList`로 이름을 준다. 라이브러리는 필요 없다.
  `<Switch>`/`<Case>` 컴포넌트는 union이 없을 때 쓰는 우회로이고, 여기서는 union이 먼저다.
- 빈 상태 표현이 화면마다 따로다. 오늘의 `NoSnapshot`·`EmptyResult`, 결정 화면의 `pending-card.tsx`·
  `history-build-recovery.tsx`. `shared/ui`에 문구를 모르는 `EmptyState`(제목·문장·행동 슬롯) 하나를 두고
  문구는 화면이 준다. 문구를 enum이나 상태에서 다시 읽지 않는다는 web 계약을 지키려면 슬롯형이어야 한다.
- `regionTextOf`는 지역 칩 라벨을 응답 행에서 찾는다. 행이 0건이면 라벨을 못 찾아 칩이 "지역 전체"로 보인다.
  지역 어휘 계약이 없어서 생긴 우회로다(지역 라벨 issue와 같은 뿌리).

## 4. web 읽기 경로(캐시·하이드레이션) 관찰

- 세 캐시 층: Next `use cache`(공유, 태그 push 무효화, stale 5분/만료 1시간), TanStack(브라우저별, staleTime 60초, 소비처 셋: `/setup` 사업자 목록, `AccountHub` 세션, 명단 패널), CF(현재 정적만).
- 하이드레이션 설정(`dehydrate.shouldDehydrateQuery`)만 있고 `HydrationBoundary`·`dehydrate()`·`prefetchQuery`는 저장소에 없다. `/setup`은 서버가 세션을 읽어 redirect 판정 → 클라이언트가 세션을 다시 읽음 → 사업자 목록 mount 뒤 조회. 왕복 셋. 서버가 읽은 걸 `HydrationBoundary`로 넘겨 하나로.
- 명단 패널은 브라우저 → Nest 직행, Nest 캐시 없음. revision당 불변이라 `(공고, revision)` 키 캐시.
- 로그인 게이트 없음: `proxy.ts`는 `NextResponse.next()`뿐. `/today`·결정 화면·Nest 공유 read가 공개. 정책대로 proxy 게이트 + Nest guard + 앱 route `noindex`. ADR 0032에 한 절.
- 대칭으로 만든 미사용 client query factory(`auctions.open/detail`, account·win-rate index 재수출).
- 시간 리터럴: `query-client.ts` `60_000`, `read-cache-life.ts` `300/3600`(EAT-133 규칙 대상).

### `open-auction-table.tsx` 관찰

- TanStack Table을 쓰지만 `getCoreRowModel`만 쓴다. 정렬·필터·페이징·가상화·열 표시 상태가 전부 없다.
  반응형 열 접기는 라이브러리 기능이 아니라 CSS 클래스 record다. 저장소 전체에서 이 라이브러리를 쓰는 파일은
  둘이고(오늘 표, 결정 화면 이력 표) 이력 표가 쓰는 것도 `columnVisibility` boolean 하나다.
- 그 결과 이 컴포넌트가 `'use client'`인 유일한 이유가 표 라이브러리다. 행 값은 이미 서버에서 문자열로
  만들어져 있고 셀 안 상호작용은 `<Link>`뿐이라, 라이브러리를 빼면 표 전체가 서버 컴포넌트가 된다.
  오늘 화면에서 가장 큰 덩어리의 브라우저 JS와 hydration이 사라진다. 부하 목표와 직접 연결된다.
- 열 하나를 바꾸려면 네 곳을 맞춰야 한다. column 정의, `VISIBILITY`, `ALIGN`, `WRAPPING_CELLS`. id가 빠져도
  className에 `undefined`가 들어갈 뿐 조용히 지나간다. 한 서술 배열(`{ id, header, align, hideBelow, wrap, cell }`)에서
  파생하면 어긋날 수 없다.
- "내 기록" 열은 모든 행이 `없음`이다(148행). 미구현이 사실처럼 읽힌다. 인증 슬롯이 채워지기 전에는 열을 뺀다.
- `summarizeItemLabel`이 두 파일에 같은 코드로 두 벌 있다(`open-auction-table.tsx:83`,
  `decision-header.tsx:44`). 품목 라벨을 접는 표시 규칙이 화면마다 산다. 한 곳으로.

### 계약과 transport (사용자 질문: DTO 한 곳·Zod 검증·ky·패치가 두 군데)

- DTO는 이미 한 곳이다. `packages/contracts`의 operation registry가 method·path·입력·상태별 응답을 소유하고
  Nest controller, OpenAPI, web이 모두 여기서 파생한다(AGENTS 19). web에 `/api/v1/...` 리터럴은 없다.
- 검증도 실제로 한다. `_transport/request-contract.ts`의 `parseSuccess`가 응답을 계약 schema로 `safeParse`하고
  실패하면 `ContractResponseError`를 던진다. 보내는 body는 `operation.bodySchema.parse`, 실패 응답은 Problem
  Details schema로 검증한다. 서버가 계약과 다른 걸 주면 화면이 아니라 여기서 멈춘다.
- Next는 별도 API를 갖지 않는다. 업무 데이터는 전부 Nest에서 온다. Next route handler는
  `/internal/cache/revalidate` 하나뿐이고 그것은 캐시 무효화 신호이지 데이터 경로가 아니다. 그래서 분리가
  다시 엮이지 않는다. RSC가 서버에서 Nest를 부르는 것과 브라우저가 same-origin `/api`로 Nest를 부르는 것의
  차이일 뿐이고, TanStack Query는 후자(상호작용 이후 조회)를 계속 담당한다.
- "패치가 두 군데"로 보이는 이유: 조회 함수 자체는 하나다(`list-open-auctions.ts`의 `listOpenAuctionsWith`).
  transport만 둘로 주입한다. `server.ts`는 절대 origin + `use cache` + 태그, `index.ts`는 same-origin +
  AbortSignal. 파일이 갈린 이유는 `server-only`와 client bundle 분리다.
- ky는 저장소에 없다. 의존성에도 ADR에도 없다. 지금 adapter가 URL 조립과 검증을 이미 갖고 있어 ky와 겹치는
  부분은 작고, 넣는다면 `createContractRequest`의 `fetch` 자리에 끼워 retry·timeout만 얻는 형태다.
- 실제로 빠진 것: 서버 fetch에 timeout도 retry도 없다. Nest가 늦으면 RSC 렌더가 그만큼 붙잡힌다.
  부하 목표를 숫자로 정하는 issue에서 같이 다룬다.

## 4-1. route 경로 문자열 (`PageProps<'/today'>` 질문)

사용자 질문: 폴더 이름이 바뀌면 이 리터럴들이 다 깨지는데 상수로 묶어야 하지 않나.

확인한 사실: `PageProps`는 `next typegen`이 만든 전역 타입이고 키는 생성된 union이다
(`.next/types/routes.d.ts`의 `AppRoutes = "/" | "/auctions/[auctionId]" | "/login" | "/setup" | "/today"`).
폴더를 옮기면 그 리터럴이 union에서 사라져 **typecheck가 그 자리에서 깨진다**. 흩어진 상수(고쳐도 아무도
모름)의 반대이고, AGENTS 19의 "화면 URL 권위는 `app/` file-system과 generated route type"이 바로 이 성질을
쓰라는 규칙이다. `ROUTES` 상수를 만들면 검사가 사라지므로 금지다.

이미 검사받는 경로: `<Link href>`, `NavItem.url: Route | '#'`(`types/index.ts:15`),
`return-path.ts`의 `ReturnRoute = Route | ...`, `today-search-params.ts`의 `TodayRoute`(소비처 Link에서 판정).

검사에서 빠진 곳으로 `app/page.tsx`의 `redirect('/today')`를 지목했는데 **틀렸다**. 실제로 없는 경로를
넣어 보니 `error TS2769: No overload matches this call`로 실패한다. 생성된 `link.d.ts`가
`next/navigation`의 `redirect`를 route별 overload로 덮어쓰기 때문이다. 즉 화면 경로를 참조하는 지점 중
검사 밖은 저장소에 없다. 판정은 눈으로 읽지 말고 잘못된 값을 넣어 확인한다.

작은 정리: `today/page.tsx`는 같은 리터럴을 두 번 쓴다(12행 alias, 28행 시그니처). `type TodayPageProps =
PageProps<'/today'>` 하나로 줄이면 파일당 한 번이 된다. `login`·`setup`·`auctions/[auctionId]`도 같은 모양이다.

## 5. 수집 주기 (사용자 걱정: "공고 떴는데 우리 사이트에 없으면")

- poll-open `*/30 8-19 평일`, Forbid, 실행 3~5분, 소스 동시 호출 1. 신규 공고 하루 60→86→106→133건(최근 4영업일). 최대 지연 35분.
- 제안: 업무시간 10분 주기(상세는 신규·변경만이라 비용은 목록 몇 장), 헤더에 수집 시각 표시, SLO "신규 공고 노출 15분 이내"를 runtime 문서 §2와 CronWorkflow에 같이 반영.

## 5-1. 이 훑기에서 답한 질문 (다시 파헤치지 않기 위해)

- **`__fixtures__/open-auctions.ts`는 왜 있나.** 테스트 전용 예시다. production import는 없다(확인함). 값이 계약
  응답 타입으로 선언돼 있어 계약이 바뀌면 화면 테스트보다 fixture가 먼저 컴파일에서 깨진다. 표시 변환·로더·
  화면·표 네 테스트가 같은 예시를 공유한다. 다만 `app/` 세그먼트 규칙이 정한 폴더(`_model`/`_ui`/`_lib`)에
  `__fixtures__`는 없다. 관례로만 있으니 이름을 규칙에 맞추거나 apps/web AGENTS에 한 줄을 넣어야 한다.
- **표시 model이 왜 따로인가.** 계약은 없음과 단위를 정직하게 말해야 하고(`floorRate: {value, unit} | null`,
  `baseAmount: {amount, currency} | null`), 화면은 그 셋을 서로 다른 한국어("미확인"·"개찰 회차 없음"·
  "낙찰 미관측")로 말해야 한다. 서버가 문자열을 내려주면 API가 화면 전용이 되고 단위가 사라진다(AGENTS 15).
  컴포넌트에서 바로 포맷하면 "색만으로 말하지 않는다" 같은 규칙이 JSX에 흩어지고 자정 경계를 렌더 없이
  검증할 수 없다. 층이 과한 게 아니라 그 층 안의 중복(KST·천 단위·기관 요약 포맷)이 과하다.
- **API 흐름.** 계약 하나에서 서버와 웹이 파생한다. `operations.ts`의 `defineOperation`이 경로·쿼리·상태별
  응답을 소유하고 `buildPath`가 `/api/v1/auctions?limit=50&state=open`을 만든다. Nest는 `handlerPath`·
  `querySchema`·`successResponses`를 그대로 decorator에 쓴다. 웹은 `_transport/request-contract.ts`가 같은
  operation으로 URL을 만들고 응답을 `safeParse`한다. 전송 조립은 셋(서버 절대 origin, 개인 쿠키+no-store,
  브라우저 상대 경로)이고 자원 함수(`listOpenAuctionsWith`)는 전송을 인자로 받아 한 벌이다. 진입은 둘이다.
  `server.ts`는 `use cache`+태그로 감싸고 예상 실패를 값으로 돌려주며, `index.ts`는 브라우저 전송을 끼운
  TanStack 표면이다. 캐시를 지우는 쪽은 dataplane → `/internal/cache/revalidate` 하나다.

## 6. 열어 둔 issue

### 이미 처리됨 (다시 열지 말 것)

- **EAT-135 merged** — page의 route 리터럴 중복을 파일당 한 번으로. `redirect`가 검사 밖이라는 진단은 틀렸고 취소.
- **EAT-136 merged** — 오늘 표를 server component로(표 라이브러리 제거·열 서술 하나·"내 기록" 열 제거),
  목록 상태를 `view` union으로, 빈 상태 공용 컴포넌트, 품목 라벨 축약 한 곳, `buildTodayRoute`를
  nuqs serializer로. 링크의 한글은 이제 인코딩 전 형태이며 브라우저가 요청 시 인코딩한다.

### 이 훑기에서 나온 산출물

- `.agents/skills/eatbid-component-design/SKILL.md` (EAT-137) — 변경 용이성 네 기준과 상충·저울질, 선언적
  판정, 상태 union, 분리 기준, 중복 허용과 결합도, server/client 경계, 자료형, 코드 스멜. 파일 크기·계약·
  문구·접근성은 기존 규칙에 위임한다.
- `docs/adr/0044-route-segment-slice-structure.md` (Proposed) — segment 내부를 `_features/<name>/{ui,model,lib}`와
  `_widgets/`로. 전면 FSD와 병렬 라우트는 기각 대안에 이유와 함께 적었다.

### 진행 중인 issue

- EAT-133 의미 값 SSOT(domain 9개 삭제·시간 규칙·KST·milli 연산·scale/통화 JSON·CronWorkflow 시간대 테스트)
- EAT-134 lint 이관(`pnpm lint`·권고형 file-size·검사 카탈로그)
- EAT-124 운영 뷰(ADR 먼저, Backlog)

## 7. 아직 발행하지 않은 고칠 것 (범위 산정)

훑기가 끝난 뒤 issue로 발행해 서브에이전트에게 넘긴다. 규모는 서브에이전트 한 세션 기준이다.

| # | 고칠 것 | 대상 | 규모 | 선행·위험 |
| --- | --- | --- | --- | --- |
| 1 | 로그인 게이트를 실제로 건다 | `proxy.ts`, Nest guard 확인, 앱 route `noindex`, ADR 0032 한 절 | 중 | 정책과 현재 상태가 어긋나 가장 급함. 세션 확인이 요청마다 DB를 치지 않게 cookie cache와 같이 본다 |
| 2 | 서버 fetch에 timeout·retry (ky 도입) | `_transport` 3개 조립점, `request-contract.ts` 주입 유지 | 중 | Next가 감싼 fetch를 늦은 바인딩으로 유지해야 캐시·계측이 죽지 않는다. `use cache` 안 재시도는 예산 안에서 |
| 3 | 서버가 읽은 세션을 브라우저가 다시 읽지 않게 | `/setup`·AccountHub·`shell/providers`, `HydrationBoundary` 도입 | 중 | 왕복 셋 → 하나. 명단 패널은 `(공고, revision)` 키 캐시를 Nest 쪽에 |
| 4 | 부하 목표를 숫자로 | k6 300명·1만 명 프로필, p95·DB QPS | 중 | 2·3 뒤에 측정해야 의미가 있다. CF B안 판단 근거 |
| 5 | 수집 주기 10분 + 화면에 수집 시각 | `poll-open` CronWorkflow, runtime 문서 §2, 오늘 헤더 | 소 | 상세는 신규·변경만이라 비용은 목록 몇 장 |
| 6 | 시간·KST·표시 형식 중복 제거 | `Asia/Seoul` 9곳, `pad2`·천 단위 헬퍼, `read-cache-life` 초 값 | 중 | EAT-133에 흡수. 도메인이 KST 달력을 소유 |
| 7 | 결정 화면 이력 표도 표 라이브러리 제거 판단 | `history-table.tsx`(`columnVisibility` 하나만 사용) | 소 | 제거하면 `@tanstack/react-table` 의존성 자체가 빠진다. 결정 화면 훑을 때 확정 |
| 8 | 지역 라벨 `코드 4` | API `region.*.label`이 null인 원인(관측 없음 vs 미탑재) | 미정 | 지역 어휘 계약이 필요. 사용자 보류 지시 |
| 9 | 404 영문 스타터 문구 | `app/not-found.tsx` | 소 | 규칙 21 |
| 10 | 명령 검색(Cmd+K) 정리 | `shell` 명령 팔레트 180줄, 항목 2개+테마 | 소 | 남길지 결정 필요. dock·테마 12종은 유지 |
| 11 | 미사용 client query factory | `api/*/queries.ts` 일부, index 재수출 | 소 | 대칭으로 만든 죽은 표면 |
| 12 | `__fixtures__` 폴더 규칙 | 이름 또는 apps/web AGENTS 한 줄 | 소 | 결정만 하면 끝 |
| 13 | 오늘 클라이언트 필터링·누적 페이징 | `today` 진입 설계와 함께 | 대 | `/today`는 임시 진입점이라 새 진입 설계로 넘긴다 |

## 7-1. 구조 평가 (2026-09-10, 오늘 화면까지 본 시점)

**단단한 곳.** 계약이 실제로 하나이고 프론트에 엔드포인트 상수가 없다. 관측 못 함·없음·파싱 실패가 서로
다른 상태로 남고 화면 문구까지 다르다. 캐시 경계를 넘은 예외가 정체를 잃는 것까지 알고 예상 실패를 값으로
돌려준다. 빌드가 바뀌면 이어 받은 목록을 통째로 버린다. 계보(build·calcVersion·산출 시각)를 화면까지 끌고
온다. 경계 검사가 문서가 아니라 커밋을 막는 코드다.

**약한 곳.** 단일 원천을 데이터에는 적용했는데 코드 표현에는 덜 적용했다(KST 9곳, 사정률 milli 3벌, 빈 상태
카드 화면마다). 값을 못 내는 도구를 들고 있다(표 라이브러리 기능 0, TanStack 하이드레이션 미사용, 미사용
의존성 다수, 결정만 있고 코드에 없는 ky). 정책과 구현이 벌어져 있다(로그인 필수인데 게이트 없음 — 부채가
아니라 결함). 만드는 규율에 비해 돌리는 규율이 얇다(수집 블랙박스, timeout·retry 없음, 지연 목표 없음).
스타터 잔재가 경계를 흐린다(UI 두 벌, 404 영문, 명령 검색).

**총평.** 설계 문서가 코드를 지배하는 쪽이다. 일관성을 얻고 속도를 낸다. 200~300명 규모에서 옳은 선택이고,
숫자가 의심받을 때 되짚을 수 있는 구조를 먼저 만들어 둔 것이 자산이다. 다만 운영 신호가 없으면 그 일관성이
헛돈다. 지금 부채는 위험한 종류가 아니라 성가신 종류이며, 예외는 로그인 게이트 하나다.

## 8. issue 초안 (그대로 발행 가능)

### A. 로그인 게이트를 실제로 건다
- 문제: 정책은 공개 화면 없음인데 `proxy.ts`가 `NextResponse.next()`뿐이다. 오늘·결정 화면과 Nest 공유 read가 열려 있다.
- outcome: proxy에서 세션 확인 후 `/login`으로, 권위는 Nest guard, 앱 route에 `noindex`, ADR 0032에 한 절.
- non-goals: 권한 모델 확장, 조직 단위 접근 제어.
- acceptance: 비로그인 요청이 화면과 공유 read 모두에서 막힌다. e2e 한 개가 그것을 확인한다.

### B. web 읽기 경로 정합과 부하 목표
- 문제: 서버 fetch에 timeout·retry가 없다. 서버가 읽은 세션을 브라우저가 다시 읽는다(설정 화면 왕복 셋). 명단 패널은 revision당 불변인데 캐시가 없다. 1만 명을 숫자로 확인한 적이 없다.
- outcome: `_transport` 세 조립점에 ky(늦은 바인딩 fetch, 조회만 재시도, 공개/개인 3초·브라우저 8초). 서버가 읽은 세션·사업자 목록을 `HydrationBoundary`로 전달. 명단은 `(공고, revision)` 키 캐시. k6 300명·1만 명 프로필로 p95와 DB QPS 측정.
- non-goals: CF에 데이터 캐시(B안)는 측정에서 web CPU 병목이 확인될 때.
- acceptance: 측정 보고서에 "DB QPS가 사용자 수에 비례하지 않음"이 숫자로 남는다.

### C. 수집 주기 10분과 화면의 수집 시각
- 문제: poll-open이 30분 주기라 신규 공고가 최대 35분 늦게 보인다. 화면에 마지막 수집 시각이 없다.
- outcome: 업무시간 10분 주기, 헤더에 "마지막 수집 · 다음 수집", SLO "신규 공고 노출 15분 이내"를 runtime 문서 §2와 CronWorkflow에 함께.
- acceptance: infra 테스트가 주기와 시간대를 단언한다.

### D. web 잔재 정리
- 문제: 공용 UI가 두 벌(`components/ui` 17개, `shared/ui` 19개, 이름 겹침 5)이다. 404가 영문 스타터 문구다. 명령 검색이 화면 이동 2개와 테마뿐이다. 미사용 client query factory가 있다. `__fixtures__`가 세그먼트 폴더 규칙에 없다.
- outcome: UI 한 벌로 수렴, 404 한국어, 명령 검색은 남길지 결정, 죽은 표면 제거, fixtures 규칙 한 줄.
- non-goals: dock 제거, 테마 12종 축소. 둘 다 유지가 결정이다.
- acceptance: `pnpm --filter @eatbid/web lint`가 변경 범위에서 통과하고 죽은 export가 남지 않는다.

### E. 결정 화면 이력 표의 표 라이브러리 제거(판단 포함)
- 문제: `history-table.tsx`가 `columnVisibility` 하나만 쓴다. 제거하면 `@tanstack/react-table` 의존성 자체가 빠진다.
- acceptance: 제거하거나, 유지할 이유를 한 문장으로 남긴다.

### F. 지역 라벨 `코드 4` (보류)
- 문제: API `region.sido.label`·`sigungu.label`이 null이라 화면이 코드로 부른다.
- 선행: 라벨이 관측 자체가 없는지 응답에 안 싣는지 확인. 지역 어휘 계약이 필요할 수 있다. 사용자 보류 지시.

### G. 오늘 진입 재설계 (큰 것)
- 문제: `/today`는 임시 진입점이다. 필터가 서버 왕복이라 조합마다 캐시 항목이 생기고 `<Link>` 기본값이 스크롤을 올린다. 페이징이 누적이 아니라 교체다.
- outcome: 진입 화면 자체를 다시 설계하고 그 안에서 클라이언트 필터링·누적 로드를 정한다.

## 8-1. `/auctions/[auctionId]` 관찰 (진행 중)

파일 60여 개로 web에서 가장 큰 화면이다. 진입은 오늘과 같은 모양(Suspense 안 loader)이고 로더가 네 가지를
소유한다. 식별자 검증과 404, 공고 조회, 이력·분포 병렬 조회, keyset cursor 이어 붙이기.

**잘 된 것.** 실패를 상태로 구분한다(`ready`·`no-organization`·`unavailable`·`build-changed`, 분포는 `locked`
사유까지). 이어 읽는 중 build가 바뀌면 앞까지의 목록도 버린다. 시각을 한 번만 읽어 표와 분포가 다른 달을
보지 않는다. 손잡이 초기값을 주소에서만 받아 추천값을 만들지 않는다(AGENTS 8). 공고가 바뀌면 `key`로 회차
선택을 초기화하고, 이어 붙인 페이지를 선택 provider에 넘겨 2페이지 회차가 "조회 밖"으로 판정되지 않게 한다.
참여 수 증감을 "어제 대비"라 부르지 않고 비교한 관측의 실제 날짜를 말한다.

**고칠 후보.**
- 주소가 서버 왕복 수를 정한다. `pages` 하나로 최대 10회 이어 조회(한 페이지 60행, 최대 600행).
- 캐시 조합이 넓다. 공고·기간·지역 범위·품목·페이지 수·확대 여부가 모두 키에 들어간다.
- `historyRead=latest`가 캐시를 우회하는 모드로 주소에 노출돼 있다. 409 복구용인데 누구나 붙일 수 있다.
- 조립 컴포넌트가 화면 규칙을 갖고 있다. `focusOf`가 주소 두 값의 조합으로 집중 모드를 정하고, 선택 품목
  회차 거르기도 화면에서 한다. 둘 다 표시 모델 몫이다.
- dock의 `fallback`이 실제로는 기본 배치다. 이름이 동작과 다르다.
- 표시 형식 중복이 여기서 또 나온다. `pad2`·`Asia/Seoul`·`formatAmountText`가 오늘 화면과 같은 코드다.
  천 단위 헬퍼는 `bid-rate.ts`에서 가져오고 오늘 화면은 자기 것을 쓴다. 금액 포맷이 두 벌이다.
- `floorRateValue?: string | null`은 부재를 두 가지로 표현한다(없음과 null). 하나로.
- `identity`·`provenance`를 계약 타입 그대로 표시 모델에 통과시킨다. 화면이 wire 필드에 직접 의존한다.
- 시간 단위 리터럴 `60_000`이 있다(EAT-133 대상).

### 운영 실측 (2026-09-10, `https://eatbid.net/auctions/110`, v0.1.25)

| 항목 | 값 |
| --- | --- |
| 응답 본문(비압축) | 172,034 B |
| 그중 RSC 페이로드 | 65,415 B (38%) |
| 압축 전송량 | 18,084 B |
| TTFB(내 PC, CF 경유) | 0.23 ~ 0.39 s |
| 총 시간 | 0.35 ~ 0.49 s |

헤더: `x-nextjs-prerender: 1`, `x-nextjs-postponed: 1`(껍데기 prerender + 본문 streaming 작동),
`x-nextjs-stale-time: 300`(설정과 일치), `cf-cache-status: DYNAMIC`,
`Cache-Control: private, no-cache, no-store`(HTML은 CF도 브라우저도 캐시하지 않는다).

**여기서 나온 고칠 것.** 응답의 38%가 RSC 페이로드다. 서버가 그린 이력 행이 HTML에 한 번, client provider
(`AttemptSelectionProvider`, `OwnBidProvider`는 둘 다 `'use client'`)로 넘어가며 직렬화돼 또 한 번 실린다.
주소의 `pages`를 10까지 올리면 600행이 두 벌이 된다. 줄이는 길은 둘이다. 선택 provider에 행 전체가 아니라
식별자 집합만 넘기거나, 확대를 별도 조회로 떼는 것이다.

> **정정(EAT-139 실측).** "같은 데이터의 두 번째 사본"이라는 위 해석은 **틀렸다.** React Flight는 같은 객체
> 참조를 한 번만 직렬화한다. main에서 rows는 네 곳(`AttemptSelectionProvider`·`OwnBidProvider`·`FlowChart`·
> client `HistoryTable`)에 넘어가지만 같은 객체라 페이로드에는 한 벌만 실린다. HTML과 페이로드가 같은 내용을
> 각각 담는 것은 맞지만 그것은 RSC의 구조이지 우리 실수가 아니다.
>
> 그래서 provider에 열쇠만 넘기는 변경은 페이로드를 줄이지 못했다. 오히려 표를 server component로 되돌리며
> 셀마다 반복되는 클래스 문자열이 늘어 **순증**이다. 실측(같은 공고, production build):
>
> | 흐름 보기 첫 응답 | main | EAT-139 | 차이 |
> | --- | --- | --- | --- |
> | 비압축 | 166,897 | 227,066 | +60,169 |
> | gzip | 21,442 | 25,958 | +4,516 |
> | brotli | 14,833 | 17,353 | +2,520 |
>
> 대신 얻은 것: 탭 전환 1회가 gzip 7,098B·요청 1건에서 **0B·0건**이 됐고, 그 화면이 받는 script 합계가
> 33,118B 줄었다(표 라이브러리 제거). **손익분기는 탭 전환 1회다.** 전환을 한 번도 안 하는 사용자에게만
> gzip 4.5KB 손해이고, 근거를 비교하는 화면이라 전환은 기본 동작이다. 유지하기로 판단했다.
>
> 교훈은 둘이다. 페이로드 구성은 눈으로 읽지 말고 재야 한다. 그리고 "중복처럼 보이는 것"이 직렬화 형식의
> 성질일 수 있다.

### 진입점이 요구하는 데이터 (사용자 질문)

셋을 서버가 가져오고, 개인 자료만 브라우저가 가져온다.

1. **공고 하나** (`auctions.find`). `identity`(공고·revision·외부 입찰번호·제목·상태), `organization`,
   `schedule`(공고·마감·개찰), `pricing`(기초금액·예정가, 통화 동반), `terms`(하한율), `location`(시도·시군구
   코드와 라벨), `classification`(품목 라벨), `participation`(최신 참여 수와 관측 시각, 하루 이상 전 관측),
   `provenance`(원본 관측·정규화 id·sha256). 헤더·배너·rail·현재 공고 패널이 쓴다. 나머지 둘의 질의 재료
   (기관 id, 코호트 조건)도 여기서 나오므로 반드시 먼저 온다.
2. **기관 회차 이력** (`organizations.listAuctionAttempts`). `attempts[]`(최대 200), `nextCursor`,
   `meta`(build·asOf·표본). 흐름 차트, 과거 회차 표, "이 값이면", 발주 주기가 쓴다.
3. **낙찰률 분포** (`winRateDistribution.find`). `bins[]`(최대 4096), `medianBin`, `modeRange`,
   `months[]`(최대 12), `meta`. 호가창 사다리와 비교집단 히트맵이 쓴다. 표본 0도 200이고 build 없음도 오류가
   아니라 계보 null인 빈 결과다.
4. **개인 자료는 브라우저.** 세션·내 사업자·내 투찰 batch는 `OwnBidProvider`의 TanStack Query, 명단은 클릭
   시 조회다. `use cache`에 넣을 수 없는 자료라 캐시 층 자체가 다르다.

**`Promise.all`을 쓰는 이유.** 공고는 앞에 두고(의존) 이력·분포만 병렬이다. `allSettled`가 필요 없는 것은
두 로더가 내부에서 실패를 잡아 타입 있는 상태 값으로 돌려주기 때문이다. `allSettled`는 `reason: unknown`을
주는데 화면은 그걸로 문구를 고를 수 없다. 지금은 실패에 이름이 있다(기관 없음·조회 실패·build 바뀜·재료 없음).

**`_model`이 큰 이유.** 모듈 16개다. 이 화면이 근거 뷰 넷(흐름 차트·과거 회차 표·분포 사다리·"이 값이면")을
한 화면에 얹었고 각 뷰가 자기 표시 모델을 갖는다. 성격은 넷이다. 계약→표시 변환 4개, 화면 좌표·창 계산 5개,
도메인 계산 3개(`bid-rate`의 BigInt 사정률, `rehearsal`, `org-cadence`), 어휘·임계 2개, 조립·코호트 2개.
문제는 개수가 아니라 셋이다. 이름이 비슷해 어디를 볼지 모른다(`flow-chart-model` vs `flow-series`). 계산과
표시가 한 파일에 섞였다(`bid-rate`가 BigInt 계산과 천 단위 표시를 함께 소유). 도메인 계산이 화면 폴더에 산다
(사정률 milli·KST는 `packages/domain` 몫, EAT-133).

### 강점으로 유지할 것

- 화면과 skeleton이 같은 frame 컴포넌트를 공유한다(`TodayFrame`, `DecisionFrame`). 골격·section 순서·열
  구조가 한 곳에 있어 로딩과 본문이 어긋나지 않는다. 새 화면도 이 규약을 따른다.

### 공유 사실 + 개인 겹침 (반복될 문제의 규칙)

문제는 "서버 조회냐 브라우저 조회냐"가 아니다. **두 파생 데이터가 같은 스냅샷을 봐야 한다**는 것이다.
회차 이력은 mart build N이고 내 투찰은 그 회차에 붙는다. 읽는 사이 build가 N+1로 넘어가면 점과 표가 다른
계보를 말한다. 그래서 서버가 `buildId`를 내려주고 개인 조회가 그 키로 묻는다(`expectedBuildId`,
`build-changed` 오류). 이 핀은 브라우저에서 전부 조회해도 그대로 필요하다. 옮겨질 뿐 사라지지 않는다.

선택지 셋과 비용:

- **A. 개인 자료도 서버에서** (`privateServerRequest`로 RSC 안에서). 핀 문제가 서버 안에서 끝난다. 대신 그
  subtree는 캐시할 수 없어 사용자마다 렌더한다. 작고 상호작용 없는 개인 조각에 맞다(예: 오늘 표의 "내 기록").
- **B. 하나의 API가 공유+개인을 합쳐서 준다.** 응답이 사용자별이 되어 공유 캐시가 사라지고 mart 값을 사람 수
  만큼 다시 보낸다. 우리 캐시 전략과 정면으로 충돌한다.
- **C. 현재 방식. 공유는 서버 캐시, 개인은 브라우저 겹침.** 캐시 히트율이 가장 높고, 사업자 전환처럼 상호작용
  으로 바뀌는 개인 자료에 맞다.

**규칙으로 굳힐 것.** ① 공유 사실은 서버가 스냅샷 키와 함께 렌더한다. ② 개인 겹침은 그 키를 인용해 조회한다.
③ 키가 어긋나면 조용히 섞지 말고 다시 읽기를 제시한다. ④ 개인 자료는 공유 캐시에 넣지 않는다.
⑤ **client provider에 넘기는 것은 키와 식별자이지 데이터 본문이 아니다.**

지금 코드는 ⑤를 어긴다. `AttemptSelectionProvider`와 `OwnBidProvider`에 행 배열을 통째로 넘겨 RSC 페이로드가
응답의 38%가 됐다. 필요한 것은 `organizationId`, `buildId`, 그리고 회차 식별자 집합뿐이다. 개인 조회 응답이
오면 그때 행과 맞춘다. 상호작용 없는 개인 조각은 A안(개인 RSC subtree)이 더 낫다.

### `OwnBidProvider`와 `deriveStatus` (상태가 13개인 이유)

`deriveStatus`는 순수 함수다. 여러 비동기·인증 소스를 하나의 판별 union으로 접고, 검사 순서가 곧 우선순위다.
소비처는 `own-bid-controls.tsx`의 `switch` 하나라 화면이 상태를 다시 계산하지 않는다. 오늘 화면이 boolean
두 개로 하던 것의 반대이며, 이쪽이 옳은 형태다.

상태가 많은 이유는 이 조각이 세 축을 동시에 만나기 때문이다. **인증**(의존성 죽음·확인 중·로그아웃·워크스페이스
미초기화), **소유**(사업자 목록 조회 중·실패·0개·여럿인데 미선택), **계보**(이력 준비 안 됨·회차 0·조회 중·
build 바뀜·관측 없음·증거 충돌·관측됨). 셋의 곱이 13이다. 뭉치면 "표시할 수 없음" 하나가 되고 사용자는 무엇을
해야 할지 모른다. 등록이 하나면 고르라고 하지 않고 여럿이면 기본값을 두지 않는 것도 규칙(AGENTS 8)의 반영이다.

**냄새.**
- `retry: () => void query.refetch()` — 값 union 안에 함수가 들어 있다. 상태는 데이터, 행동은 UI가 갖는 게 낫다.
  직렬화도 동등 비교도 안 된다.
- `checking`이 세션과 사업자 목록 두 축에서 나온다. 사용자에겐 같지만 `data-own-status`로 DOM에 노출되므로
  진단에서 구분이 사라진다.
- 마지막 `display === null ? loading : observed`는 성공 뒤의 동기 계산이라 사실상 도달하지 않는 분기다.
- provider 하나가 상태 판정·선택 상태·query 셋·표시 모델 조립을 모두 소유한다(145줄). 판정은 `_model` 몫이다.
- `NO_SCOPE = { principalId: '', workspaceId: '' }` 빈 문자열 센티넬이 query key에 들어간다. TanStack v5의
  `skipToken`이 이 자리의 정석이다.

**바꿀 방향(검색 근거 포함).** Vercel KB와 RSC 해설이 말하는 바는 우리가 잰 것과 같다. client component에
넘긴 props는 RSC 페이로드로 직렬화되고 HTML과 사실상 중복되며, 큰 배열은 그만큼 바이트가 된다. 그래서
① client 경계를 더 아래로 내린다(지금은 화면 전체를 감싸지만 내 투찰이 필요한 곳은 흐름 차트 점과 컨트롤뿐).
② 서버가 넘기는 것을 행 배열이 아니라 회차 키 배열(`attemptId`,`revisionId`)로 줄인다. provider가 하는 첫 일이
바로 rows에서 그 키만 뽑는 것이다. ③ 상호작용 없는 개인 조각은 개인 RSC subtree로.

### 인증축을 어디까지 위임할 수 있나 (사용자 질문)

**이미 위임돼 있다.** 누가 로그인했는지는 Nest의 Better Auth(`platform/auth/auth-instance.ts`, Google 단독,
`deferSessionRefresh: true`)가 소유한다. 웹이 따로 갖는 canonical 세션 union은 Better Auth가 답할 수 없는 것을
답한다. app principal과 workspace가 초기화됐는지다. 이 분리는 ADR 0032가 정한 의도다. 그러니 없앨 수 있는 것은
축이 아니라 **"확인 중"이라는 과도 상태**다.

**세 가지를 하면 과도 상태가 사라진다.**

1. **로그인 게이트**(issue A). workspace 안에서는 세션이 항상 active가 되므로 `signed-out`·`uninitialized`가
   provider에서 도달 불가가 된다. 미초기화는 게이트가 `/setup`으로 보낸다.
2. **Better Auth `session.cookieCache`를 켠다.** 현재 설정에 없다. 게이트가 요청마다 세션을 보게 되므로 이걸
   켜지 않으면 게이트 자체가 DB 부하가 된다. 둘은 한 쌍이다. 취소 반영이 캐시 수명만큼 늦으므로 수명은 짧게
   (60초 수준) 두고 로그아웃은 지금처럼 POST로 쿠키를 즉시 무효화한다.
3. **세션과 내 사업자 목록을 서버에서 읽어 `HydrationBoundary`로 심는다.** `(workspace)/layout.tsx`는 지금
   server component인데 아무것도 읽지 않고, `AccountHub`가 브라우저에서 세션을 다시 읽는다. 개인 자료라
   `use cache`는 금지이고 `privateServerRequest`가 그 규칙을 이미 지킨다. props로 내리는 것보다 hydration이
   나은 이유는 사업자 등록 후 무효화가 같은 query key로 이어지기 때문이다.

**결과.** 13개 중 사라지는 것은 `auth-unavailable`(게이트로 이동)·`checking`(세션)·`checking`(사업자 목록)·
`signed-out`·`uninitialized`다. 남는 것은 사실 상태 8개이며 그중 과도 상태는 내 투찰 `loading` 하나다.
`no-businesses`와 `select-business`는 사용자가 할 일이 있는 진짜 상태라 남는다.

### 흐름·분포 탭이 누를 때마다 서버를 친다 (사용자 관찰, 확인됨)

탭은 `<Link href={buildDecisionViewRoute(...)}>`이고 `view`가 URL 값이다. 그래서 클릭 한 번이 soft navigation
이고 Next가 그 주소의 RSC 페이로드를 서버에서 받아 온다. 전체 새로고침은 아니지만 서버 렌더 왕복은 맞다.

**여기서 낭비인 지점.** `loadAuctionPage`는 `view`와 무관하게 이력과 분포를 **항상 둘 다** 부른다
(`Promise.all`). 즉 탭이 고르는 것은 이미 받아 둔 두 데이터 중 무엇을 그릴지뿐이다. 데이터가 달라지는
전환이 아닌데 서버 왕복을 한다. 측정치로 보면 전환마다 압축 18KB와 0.3초 안팎이다.

**고치는 법.** 탭을 클라이언트 전환으로 바꾼다. 두 본문을 서버에서 함께 렌더해 두고 클라이언트 상태로
바꿔 끼우며, URL은 nuqs의 shallow 갱신으로 유지한다(주소 공유·뒤로가기는 그대로, 서버 요청은 없음).
페이로드는 숨은 본문만큼 늘지만 전환마다의 왕복이 사라진다.

**서버 왕복을 유지해야 하는 전환.** 데이터 질의가 실제로 달라지는 것들이다. 기간·모집단 범위·품목 조건,
`pages`(이어 읽기), `historyRead=latest`, 그리고 `expand=비교집단`(분포를 달별 granularity로 다시 부른다).

**부수 개선.** `next.config`에 `experimental.staleTimes`가 없어 client router cache가 dynamic 구간을 보관하지
않는다. 서버 왕복을 남기는 전환에 한해 짧은 값을 주면 되돌아올 때가 즉시가 된다.

### `_ui`에 로직이 들어 있다 (리뷰에서 반려할 것)

세그먼트에 화면 전용 표현을 두는 것 자체는 문제가 아니다. 문제는 `_ui`가 표현이 아닌 것을 갖고 있다는 것이다.
결정 화면 `_ui` 파일 30여 개 중:

- `create-flow-chart.ts` 171줄, `own-bid/own-bid-series.ts` 115줄, `expand/history-range.ts`. `.tsx`가 아니라
  `.ts`다. 렌더가 아니라 계산이고, `_ui`에 있을 이유가 없다.
- `own-bid-provider.tsx` 145줄이 상태 기계 판정(13갈래) + query 셋 + 선택 상태 + 표시 모델 조립을 한 파일에서 갖는다.
- `attempt-selection.tsx`, `bid-rate-context.tsx`가 화면 간 공유 상태를 `_ui`에서 소유한다.
- 내 투찰은 독립된 사용자 intent와 권한 흐름과 세 resource orchestration(세션·내 사업자·투찰 관측)을 모두
  갖는다. 규칙상 capability 승격 조건을 충족하는데 화면 폴더에 갇혀 있다.
- 도메인 계산(`_model/bid-rate.ts`의 사정률 BigInt, KST 달력, `rehearsal`)은 web의 어느 층도 아니고
  `packages/domain` 몫이다(EAT-133).

**층 지도도 문서와 다르다.** `src` 최상위에 결정된 여섯 층에 없는 `components/`·`hooks/`·`lib/`가 남아 있다.

> **정정(EAT-140 검증).** 처음에 "canonical 층에서 직접 import하는 곳은 없다"고 적었는데 **틀렸다.**
> 실제 진입점이 여섯이다. `app/layout.tsx`(→`ui/sonner`), `app/not-found.tsx`(→`ui/button`),
> `shell/layout/application-shell.tsx`(→`command-palette`·`layout/app-sidebar`·`layout/header`·`ui/sidebar`),
> `shell/theme/theme-mode-toggle.tsx`, `shell/theme/theme-selector.tsx`, `types/index.ts`(→`icons`).
> 그래서 세 폴더는 한 번에 못 지운다. `components/ui`의 재수출 shim 다섯과 `lib/utils.ts`를 건드리는 순간
> legacy-import gate와 `korean-comments` gate가 vendored 파일 열 개까지 함께 요구하므로 한 덩어리로 처리해야 한다.
> `hooks/` 셋 중 `use-mobile`만 바로 옮길 수 있고 나머지 둘은 `config/nav-config`·`types`에 묶여 있다.
> `components/search-input.tsx`는 production 참조가 없고 명령 팔레트 테스트만 쓴다. 즉 Cmd+K 말고 팔레트를
> 여는 마우스 수단이 코드엔 있는데 헤더에 안 붙어 있다. 남길지는 명령 검색 결정과 함께 본다.

**층 체계 자체를 다시 볼지는 별도 결정이다.** 현재 ADR 0023은 full FSD를 기각한 상태로 적혀 있다. FSD를
채택하기로 했다면 그 ADR을 supersede해야 하고, 그 전까지는 문서와 코드가 서로 다른 말을 한다. 어느 쪽이든
위 다섯 항목은 어떤 층 체계에서도 반려 대상이다.

### 층 체계 재검토 (2026-09-10 조사)

**FSD 공식 지침(App Router).** `app/`은 라우팅만 두고 제품 구조는 `src/`의 층으로 둔다. 층은
app(초기화·provider) → pages → widgets → features → entities → shared. Next와 이름이 겹치므로 FSD의 `app`·
`pages`는 `_app`·`_pages`로 바꾸라고 공식 문서가 명시한다. `app/**/page.tsx`는 "조립과 배선"만 하고 도메인
로직을 담지 않는다. 도메인 질의는 `entities/*/api`에, 변이와 캐시 무효화(`revalidateTag`)는 feature slice가
소유한다. 기본은 server component이고 client 경계는 feature 안에서 좁게 가둔다. server 전용 모듈은
`index.server.ts`로 공개 표면을 분리한다. 공식 linter는 steiger다.

**업계 일반 지침.** route colocation(같은 폴더에 UI·hook·action)과 feature 폴더의 혼합이 성장기 프로젝트의
표준이다. 안티패턴으로 꼽히는 것은 거대한 `components/` 한 폴더와 컴포넌트 안의 업무 로직이다.

**우리 층을 FSD에 대입하면 이렇다.** `shell` ≈ FSD app(provider·chrome), `capabilities` ≈ features,
`api/<resource>` ≈ entities의 api 세그먼트, `shared` ≈ shared, route-private `_model`/`_ui`/`_lib` ≈ pages 층
슬라이스. 없는 것은 `widgets`와 `entities` 본체이며, 도메인 모델은 `packages/domain`이 이미 갖고 있다.
즉 이름만 다른 부분집합이다. FSD 2.1이 "pages first"로 옮겨 재사용 없는 것은 page slice에 두라고 한 것도
우리 route-private와 같은 방향이다.

**그래서 진짜 결손은 이름이 아니다.** route-private와 capability 사이에 중간 자리가 없고, 승격 조건이
문장으로만 있어 아무도 승격시키지 않는다. 그래서 안 올라간 것이 전부 `_ui`·`_model`에 쌓인다.

**선택지.**
- **A. 전면 FSD 채택.** ADR 0023 supersede, 층 이름 변경(`_pages`·widgets·entities 신설), steiger 도입.
  비용은 300여 파일 이동과 기존 `web-boundaries` 검사 재작성. 사용자에게 보이는 이득은 없다.
- **B. 층은 유지하고 결손만 메운다(권고).** ① `_ui`에는 렌더링 모듈만. 비렌더 `.ts` 금지를 lint로 막는다.
  ② 승격 조건을 만족하면 실제로 승격한다(내 투찰부터). ③ 도메인 계산은 `packages/domain`으로.
  ④ 죽은 `components/`·`hooks/`·`lib/` 제거. ⑤ 슬라이스 내부 세그먼트 이름을 FSD와 같게 유지(`ui`/`model`/`lib`).
- **C. A를 나중에.** B를 먼저 하면 A로 가는 이동 비용이 줄어든다. B의 결과물이 그대로 FSD 슬라이스가 된다.

**정정: A에 이득이 없다는 앞의 서술은 틀렸다.** A의 이득은 "규율을 도구가 강제한다"는 것이고, 그건 우리
문제(승격 규칙이 문장으로만 있어 아무도 승격시키지 않음)에 정확히 맞는 이득이다. 구체적으로 ① 새 사람과
AI가 이미 아는 공용 어휘(우리 `capabilities`·`shell`은 매번 설명이 필요하다) ② 기성 linter steiger가 층 방향·
슬라이스 격리·public API를 검사한다(우리는 `web-boundaries`를 직접 유지 중) ③ 층이 존재하면 "어디 둘지"가
선택이 아니라 위치로 결정된다. 비용은 파일 300여 개 이동, gate 재작성, ADR supersede이고, 우리 경우
`packages/domain`이 이미 entities의 도메인 부분을 갖고 있어 FSD entities가 반쪽이 된다는 점이 남는다.

### Toss 방법론 (조사)

Toss는 층 분류법을 규정하지 않는다. 판단 축을 준다. 좋은 코드는 **변경하기 쉬운 코드**이고 축은 넷이다.
가독성 > 예측 가능성 > 응집도 > 결합도 순서로 본다. 폴더에 대해서는 하나만 말한다.
**함께 수정되는 파일을 같은 디렉터리에 둔다.** `components/`·`hooks/`·`utils/`처럼 **파일 유형별로 나누는 것을
안티패턴으로 본다.** 도메인 폴더 안에 그 유형들을 넣고, 두세 도메인이 공유하면 중간 도메인을 새로 만들어
단방향 의존을 유지한다. 페이지 전용 기능이면 `pages/PageName/` 아래가 더 실용적이라고 명시한다.
중복 허용, 책임 하나씩, props drilling 제거도 같은 문서의 항목이다. 비유는 "개발자 캐시 적중"이다.

**우리에 대입하면 결정적인 지점이 나온다.** `_ui`와 `_model`은 세그먼트 수준의 **파일 유형별 분리**다.
흐름 차트를 고치려면 `_ui/flow-chart.tsx`, `_ui/create-flow-chart.ts`, `_ui/flow-legend.tsx`,
`_model/flow-chart-model.ts`, `_model/flow-series.ts` 다섯을 두 폴더에서 오간다. FSD의 slice-then-segment와
Toss의 "함께 바뀌는 것을 함께"는 같은 곳을 가리킨다. 유형이 아니라 **변경 단위**로 묶으라는 것이다.

### mw-auction의 기존 규칙 (같은 사용자의 다른 저장소, 그대로 쓸 수 있음)

`F:\Project\mw-auction\.claude\rules\folder-structure.md`와 `component-layers.md`가 이미 토스 Effective
Component + FSD + Clean Architecture를 하나로 합쳐 놓았다. 요지는 이렇다.

- 라우트 세그먼트 안이 **slice-then-segment**다. `_widgets/`(페이지 섹션 단위 자족 블록),
  `_features/{name}/{ui,model,lib}`(미니 FSD), `_lib/`(페이지 전용). 전역은 `features/`, `entities/`(2곳 이상
  공유), `api/`, `components/{ui,custom}`, `hooks/`, `lib/`, `shared/`.
- 승격 사다리가 명시돼 있다. 자족 UI 블록 → `_widgets/`, 유저 인터랙션 → `_features/{name}`, 2곳 이상 →
  `entities/`, 도메인 무관 → `components/`, 새 기능 → `features/{name}`.
- 8계층 import 방향표가 있다. 특히 **Feature Model은 JSX 금지, Feature Lib는 React·hooks·JSX 금지**,
  Page는 오케스트레이터로 50줄 이하.
- 분리 기준도 토스식이다. 복잡도 낮추기나 재사용이 목적이 아니면 분리하지 않는다. 한 컴포넌트가
  데이터 관리·표시 결정·상호작용 중 둘 이상을 하면 나눈다.
- `ui/` 비대화는 파일 수를 늘리는 대신 합성으로 푼다. prefix로 그룹이 되면 서브폴더를 만들지 않는다.

**eatbid에 대입.** 우리 여섯 층은 이 지도와 거의 1:1이다(`capabilities`≈`features`, `shared/ui`≈
`components/{ui,custom}`, `api/<resource>`≈`api/`). 없는 것은 `entities`와 `_widgets`, 그리고 **세그먼트 내부가
type-first**라는 점이다. `_model`/`_ui`는 토스 문서가 안티패턴으로 든 `components/`·`hooks/` 분리와 같은 모양을
세그먼트 안에서 반복한 것이다.

**제안하는 결정 화면 구조.**

```
auctions/[auctionId]/
  page.tsx                       # 오케스트레이터
  _widgets/                      # decision-frame, evidence-tabs, history-card, bid-rail, workspace-dock
  _features/
    flow/{ui,model,lib}          # flow-chart, create-flow-chart, flow-series, flow-legend
    history/{ui,model,lib}       # history-table, attempt-history, history-window, attempt-selection
    distribution/{ui,model,lib}  # order-book, present-distribution, distribution-heatmap
    rehearsal/{ui,model,lib}
    own-bid/{ui,model,lib}       # 2곳에서 쓰이면 capabilities로 승격
  _lib/                          # decision-search-params
```

도메인 계산(사정률 BigInt, KST 달력)은 어느 쪽도 아니고 `packages/domain`으로 간다.

**lint로 굳힐 것.** `_features/*/lib`에 React import 금지, `_features/*/model`에 JSX 금지, `page.tsx` 줄 수 상한.
이 셋이면 오늘 반려한 다섯 중 넷이 기계로 막힌다.

### "정면 충돌" 재검증 (내 기존 판정을 다시 봄)

서브에이전트가 mw-auction 규칙 8개를 eatbid와 정면 충돌로 분류했다. 충돌이라는 이유로 배울 것이 없다고
넘기면 앞서 FSD를 두고 현행을 옹호한 것과 같은 실수다. 하나씩 "어느 쪽이 우리에게 더 나은가"로 다시 봤다.

| 항목 | 판정 | 이유 |
| --- | --- | --- |
| 파일 크기 200줄 강제 vs 우리 300줄 권고 | **배울 것 있음** | 숫자가 아니라 **분리 트리거 표**(controller 라우트 8개+, service 메서드 6개+ 등)와 **`page.tsx`는 오케스트레이터**라는 규칙이 값이다. 우리 300줄 권고와 충돌하지 않고 그것을 실행 가능하게 만든다 |
| FSD 8계층 | **배울 것 있음** | 이미 ADR 0044로 slice-then-segment를 받았다. 추가로 `_widgets/`와 `entities/`가 실제 빈 자리를 메운다 |
| shadcn 설치 경로 | **우리 문제가 더 큼** | 저쪽은 UI 폴더가 하나, 우리는 둘이다. 경로 충돌이 아니라 우리가 정리할 일이다(EAT-140) |
| react-hook-form vs TanStack Form | **충돌 아님** | 라이브러리는 우리 선택을 유지한다. "팝오버는 독립 폼 경계", "필드 prefix로 동적 배열 중복 제거" 개념은 우리 라이브러리로 옮길 수 있다 |
| 라우트 타입 생성기 | **우리가 낫다** | Next 16 내장 `typedRoutes`가 외부 생성기보다 낫고 mirror 금지도 유효하다 |
| Temporal 폴리필 | **우리가 낫다** | 진입점을 하나로 묶고 정적 gate로 막는 쪽이 안전하다 |
| Zustand 전역 표준 | **우리가 낫다** | 좁게 허용하는 현행이 맞다. 지금 client 상태는 context 둘로 충분하다 |
| 자체 에러 포맷 | **우리가 낫다** | RFC 9457 Problem Details가 표준이고 계약이 이미 소유한다 |

**빈 자리로 확인된 것: `entities` 층.** 도메인을 알지만 화면에 매이지 않은 표시 조각이 갈 곳이 없다.
`shared/ui`는 규칙상 도메인을 모르고(alert·badge·button·card·table 류), `capabilities`는 독립된 사용자 흐름만
받는다. 그래서 금액 표시, 품목 라벨 축약, 빈 상태 카드, 표본 수 문구, 판정 어휘가 화면마다 복사됐다.
실제로 이번 훑기에서 잡은 중복 넷이 전부 이 성격이다. ADR 0044에 `entities/` 층과 "두 화면 이상에서 쓰면
승격"을 넣었다.

### 병렬 라우트(`@slot`) 안 평가

사용자가 제안한 구조다. 근거 영역·과거 회차·오른쪽 레일을 `@evidence`·`@history`·`@rail` 슬롯으로 나누면
각 슬롯이 자기 `loading`·`error`와 model·ui·hook을 갖는다.

**얻는 것.** 폴더가 곧 경계라 "어디 둘지"가 사라진다. 슬롯별 streaming이라 느린 영역 하나가 화면 전체를
잡아 두지 않는다(지금은 로더 하나가 셋을 다 기다린다). 실패도 슬롯 경계에서 끝난다.

**치를 비용.** 교차 일관성이 흩어진다. 지금 로더가 보장하는 두 가지, 곧 "시각을 한 번만 읽어 표와 분포가
같은 달을 본다"와 "build를 고정해 두 계보를 섞지 않는다"가 슬롯마다 따로 일어나면 깨진다. 해결은 상위
layout이나 URL이 시각·build를 정해 슬롯에 내려보내는 것이고, 이는 앞서 정한 "공유 사실 + 개인 겹침" 규칙과
같은 형태다. 그리고 탭을 슬롯 경계로 만들면 방금 없애기로 한 서버 왕복이 되살아나므로 탭은 슬롯 **안의**
클라이언트 전환으로 남겨야 한다. `default.tsx`와 soft navigation 시 슬롯 유지 규칙도 새 학습 비용이다.

## 8-2. 리뷰 체크리스트 (서브에이전트 브랜치를 받을 때)

보고를 믿지 않고 직접 확인한다. 순서대로 본다.

1. **범위.** issue가 정한 owned path 밖을 건드렸는가. 다른 세션 소유 경로를 만졌는가. `git diff --stat`으로 먼저 본다.
2. **acceptance 대조.** issue의 항목을 하나씩 실제 결과와 맞춘다. "했다"는 문장이 아니라 명령 출력이 근거다.
   증명하지 못한 항목은 "못 보였다"고 적혀 있어야 한다. 조용히 빠져 있으면 반려다.
3. **검사 재실행.** 내가 직접 돌린다. `npx tsc --noEmit`, `bun test src`, `node tools/architecture/run-checks.mjs --changed`.
   서버가 걸리면 `pnpm --filter @eatbid/server test`. 숫자가 보고와 다르면 반려다.
4. **회귀.** 기존 테스트가 지워지거나 약해지지 않았는가. 테스트를 고쳤다면 명세가 바뀔 이유가 있었는가.
   `git diff`에서 `expect` 삭제와 `.skip`을 찾는다.
5. **AGENTS 규칙.** 한국어 이유 주석·테스트명·커밋 본문, 신규·변경 production 모듈의 `@module 책임:`,
   경로·계약 리터럴 신설 없음, 시간·금액·비율 타입, 300줄 초과 시 waiver 한 줄.
6. **설계 기준(`eatbid-component-design`).** 상태가 union인가 boolean 재계산인가. 표현 폴더에 계산 모듈이
   들어갔는가. client 경계가 잎에 있는가. 중복을 남긴 판단에 이유가 있는가.
7. **삭제 근거.** 지운 export·파일마다 참조 없음을 어떻게 확인했는지 근거가 있는가. 동적 import와 문자열 경로까지 봤는가.
8. **커밋 위생.** `--no-verify` 흔적, 한 커밋에 두 관심사 혼재, 무관한 파일 포함.
9. **되돌릴 수 있는가.** 병합 전에 브랜치가 main에 rebase 없이 깨끗이 얹히는지 확인한다.

## 8-3. 2026-09-10 결과

**main에 들어간 것.** EAT-135 route 리터럴 중복, EAT-136 오늘 화면 표·표시 모델, EAT-137 컴포넌트 설계 skill과
ADR 0044, EAT-140 죽은 표면 제거와 404 한국어화, EAT-138 로그인 게이트와 세션 쿠키 사본, EAT-141 전송 계층
시간 제한·재시도(ky), EAT-139 결정 화면 탭 클라이언트 전환과 표 라이브러리 제거, EAT-144 접근성 skill과
jsx-a11y 명시, EAT-143 서버 읽기 재사용과 명단 캐시, EAT-146 캐시 e2e를 관측값 기반으로.
ADR 0044는 Accepted다.

**리뷰가 잡은 것.** ① 내가 issue에 쓴 전제가 틀렸다(canonical 층이 `components/*`를 실제로 여섯 곳에서 쓴다).
② 내가 제안한 ky 단순화가 틀렸다(Node에서 오류 본문이 소비되어 Problem Details가 깨진다. bun 테스트는 초록).
③ 단위 테스트가 전부 초록인 브랜치에서 결정 화면 e2e가 레이아웃 회귀를 잡았다(`grid` 암묵 열 + `min-w-0` 부재).
④ RSC 페이로드 "두 번째 사본" 해석이 틀렸다(Flight는 같은 참조를 한 번만 직렬화).
⑤ 기존 결함 셋을 새로 찾았다(375폭 확대 축소, 접근성 위반 여섯, 캐시 e2e 명세 충돌).

**교훈 셋.** 보고가 아니라 명령 출력이 근거다. e2e는 단위 테스트가 못 잡는 것을 잡는다. bun 초록이 Node
초록이 아니다.

**대기 중인 issue(저녁 갱신).** EAT-142·145·147·148은 같은 날 저녁에 병합·push했다(8-5). 남은 것은 EAT-133 의미 값
SSOT, EAT-134 lint 이관, EAT-124 운영 뷰 ADR, 그리고 8-5의 진행 중 셋(150·152·155)과 EAT-156.
아직 발행 안 함: k6 부하 측정, 지역 라벨, 오늘 진입 재설계, 8-4 후속(EAT-153 인덱스 둘, EAT-154 잔여, EAT-149의
미매칭 404·파서 오류 미로그).

## 8-4. 서버·드리즐 심층 감사 결과 (2026-09-10 저녁)

읽기 전용 감사 셋(드리즐, 서버 모듈, 서버 플랫폼)의 결과를 issue로 옮겼다. 상세는 각 issue가 갖는다.

- **드리즐**: 규율이 높다. 문자열 정체성 0건, 부동소수점 0건, 시간대 없는 시각 0건, 죽은 테이블 0건. 실질 문제는
  인덱스와 조회 축의 어긋남 둘(EAT-153). 코드 체계↔역할 정합성이 DB에 없는 것은 확인 필요로 남김.
  마이그레이션 사슬 재작성 이력은 **운영 DB journal을 직접 읽어 닫았다.** 옛 폴더 이름은 어느 환경에도 적용된
  적이 없다(운영 23행, 백필 컨테이너 11행 모두 확인).
- **서버 모듈**: 층·의존 방향·트랜잭션·질의 모두 결함 없음. 문제는 wire 직렬화의 자리가 없어 중복이 네다섯
  벌(계보 4, 코드 참조 5, 시각 5, 라벨 트림 4)이라는 것. ADR 0045로 자리를 정했고 EAT-152가 적용한다.
- **서버 플랫폼**: 오늘 병합한 EAT-138의 후속 구멍 둘. guard가 거부한 401·403·503이 로그에 안 남고(guard가
  interceptor보다 먼저 돌아 완료 로그가 안 찍힘), 게이트 붙은 여섯 중 다섯에 캐시 금지 헤더가 없음(EAT-149).
  오늘 push 게이트의 불안정 실패 원인은 통합 테스트 하나의 timeout 누락(EAT-150).

**문서 불일치 하나(EAT-151이 발견).** `product-and-quality.md` §7이 "source-to-core p95 35분 초기 SLO"라고 적고
있는데 새 SLO는 "신규 공고 노출 15분"이다. 둘의 관계(측정 지점이 다른가, 대체인가)를 정리해야 한다.
`arc42.md`, ADR 0012·0037, decision-screen-v2 architecture에도 30분·24회 언급이 남아 있다(ADR은 기록이라 그대로).

**Argo 동작 하나(EAT-151이 확인).** `Forbid` + `startingDeadlineSeconds: 600`이면 놓친 tick은 건너뛰는 게 아니라
실행이 끝난 뒤 600초 안이면 **곧바로 늦게 만들어진다.** 주기와 deadline이 같아 사실상 catch-up 하나가 붙어
회차가 연달아 돈다(겹치지는 않음). 원치 않으면 deadline을 줄이는 별도 결정이 필요하다.

### 저녁 배치에서 새로 나온 후속 (아직 issue 아님)

- **EAT-153이 찾은 인덱스 둘 더.** ① 명단 행 라벨 조회(`code_value_id = ? and observation_id = ?`)는 evidence key에서
  `observation_id`가 4번째 열이라 lookup당 약 522 buffers·4.2ms(60k 관측 기준). 명단 2,049행이면 수 초. `(code_value_id,
  observation_id)` 선행 인덱스 후보. ② `auction_revision`에 `auction_attempt_id` 선행 인덱스가 없어
  `where auction_attempt_id = ? order by auction_revision_id desc limit 1`이 pair key를 backward scan한다. 오래된 공고일수록 길다.
- **EAT-153 배포 주의.** `CREATE INDEX`가 비동시라 운영 `code_label_observation`(463만 행, 903MB)의 쓰기를 생성 시간만큼
  막는다. 1분 안쪽으로 보지만 poll-open 실행(3~5분, 10분마다)과 겹치면 그 실행이 그만큼 기다린다. 릴리즈 시각을
  수집 창 사이로 잡거나, 다음부터 큰 테이블 인덱스는 CONCURRENTLY 수기 마이그레이션(파티션 DDL 선례)으로.
- **drizzle `.desc()`는 `DESC NULLS LAST`를 낸다.** 서버 SQL의 plain `desc`는 `NULLS FIRST`라 pathkey가 어긋나 인덱스를
  읽고도 정렬을 다시 한다(실측 140.8ms vs 20.9ms). 정렬 인덱스를 만들 때는 `.nullsFirst()`를 명시한다. 테스트로 고정됨.
- **EAT-154가 남긴 것.** `decision-layout.css` 16·28·69·79행의 원시 폭 640/767/639px가 남아 있다(결정 화면 경계 지시 때문).
  `@variant sm`으로 바꾸면 폭 리터럴이 두 곳뿐이 된다. `screen-system.md` §11에서 "1280~1439 사업자 한 명 집중 보기"
  문구가 사라졌다. 제품 의도로 남길 문장이면 되살린다. Tailwind 기본 rem 대신 px를 써서 글꼴을 키운 사용자에게는
  경계가 예전보다 좁은 px에서 걸린다(JS와 일치시키려는 선택).

## 8-5. 2026-09-10 저녁 2차 배치

- **push 하나로 14개 커밋을 올렸다**(`8c677274..779c33da`). 내용: ADR 0045, EAT-151(수집 주기 10분), EAT-153(라벨·식별자 인덱스),
  EAT-154(폭 경계 SSOT), EAT-149(게이트 거부 로그·개인 응답 캐시 금지), 메모. 게이트 실측: 서버 스위트 278개 통과
  433초, architecture 15개 통과 76초, AI 리뷰는 사용 불가였지만 필수 gate가 아니라 통과. 다른 무거운 작업을 겹치지
  않게 한 번에 한 push만 띄운 것이 오늘 첫 게이트 실패(EAT-150의 원인)와 다른 점이다.
- **worktree 정리.** 149·142·147·148·154의 agent worktree와 병합된 브랜치 다섯을 지웠다. `git worktree remove --force`가
  exit 0이어도 디렉터리가 남아 `Remove-Item`으로 따로 지워야 했다(네 개). 남은 worktree는 다른 세션 소유 넷과 이 세션뿐.
- **EAT-156 발행.** 결정 화면 '금지 문구가 없다' 테스트가 단어 다섯(`NeaT`·`탈락선`·`밀림`·`추천`·`안전 구간`)으로 판정해
  규칙을 지키는 경고문("NeaT에 넣는 투찰률과 분모가 다릅니다", `my-rate-input.tsx`)까지 잡는다. 지금 통과하는 이유는
  흐름 본문만 렌더해서다. 문구는 두고 검사를 유도 문형 수준으로 올리며 분포 본문도 렌더해 검사한다.
- **EAT-151 후속 문서 정합(리뷰어가 직접).** `product-and-quality.md` §7의 35분을 15분으로 맞추고 근거·조정 조건의 소유를
  runtime 문서 §2.5에 두었다(`91c89887`, main `4d1833ee`). 8-4의 "둘의 관계" 질문은 대체로 닫는다: 측정 지점이 다른 두
  SLO가 아니라 하나의 SLO를 두 문서가 다르게 적고 있던 것이다.
- **동시에 띄운 넷.** EAT-150(통합 테스트 timeout 누락·죽은 export), EAT-155(개발 전용 이메일 로그인·시드), EAT-152(ADR 0045
  적용), EAT-156(금지 문구 검사). owned path가 겹치지 않게 150에는 `modules/**` 금지, 152에는 `database.tokens.ts`·통합 테스트·
  픽스처·`platform/auth/**`·`environment.ts` 금지, 155에는 `modules/**` 수정 금지를 걸었다. 넷 다 좁은 테스트만 돌리고(152만
  마지막에 전체 스위트 한 번) 판정은 병합 뒤 push 게이트 한 번으로 한다.

### 2차 배치 리뷰 결과

- **EAT-150(`517f69d1`).** 파일 3개, 통합 2·database 4·tsc 통과를 재실행으로 확인. 통합 테스트 15개 파일 전부 test 수만큼
  override가 있다. 자체 harness를 공용 fixture로 바꾸면서 연결 역할이 owner→운영 `api`로 바뀐 것은 형제 테스트 관행이고
  운영 권한까지 검증하므로 받아들였다. 남긴 것: 테스트·fixture 파일이 어느 tsconfig에도 없어 typecheck 게이트 밖(기존 공백).
- **EAT-156(`0b386c8c`).** 리뷰 세 번. ① 에이전트가 넣은 '낙찰 확률·가능성' 금지는 ADR 0027(예측 승률은 경계 안)·0030과
  충돌해 삭제. ② 원래 검사가 막던 홀로 선 "추천"·"권장" 라벨을 `(?![가-힣])`로 다시 잡게 함. ③ '자리 단정' 꼬리를 확정형
  (`낙찰됩니다|낙찰된다|낙찰될 (것|겁니다)`)으로 좁혀 "낙찰될 확률" 승률 문구는 통과. 최종 규칙 8개, production diff 0,
  세그먼트 303 pass. 교훈: 금지어 목록을 넓힐 때는 Accepted ADR의 허용 어휘와 대조해야 한다.
- **EAT-155(`de85705f`).** 게이트 파일 넷 diff 0. 단위 18·e2e 3·기존 인증 통합 17(에이전트가 안 돌린 것을 내가 돌림)·웹 7 통과.
  설계: `parseAuth`가 "넷 전부/전무"에서 "secret·URL + 로그인 방법 1개 이상"으로, Google 쌍은 `google | null`, dev login에서도
  secret·URL 고정값 없음(세션 위조 경로 차단), `autoSignIn:false`(시드가 세션 행을 안 남김), 웹은 RSC에서 `NODE_ENV≠production
  && EATBID_DEV_LOGIN==='true'`만 판정. 이메일 endpoint는 provider가 항상 등록하고 handler가 400 `EMAIL_PASSWORD_DISABLED`로
  거부(acceptance의 "404 또는 미등록" 대신). 남긴 것: `docs/README.md` 목차 추가(다른 세션이 그 파일을 수정 중이라 보류),
  `infra/product/secret-contract.md`에 비밀 아님 명시 여부, "dev login 켜짐" 시작 로그(lifecycle union 고정).
- **EAT-152(`dec1a8b3`).** 커밋 10개를 결정 항목별로 읽음. `AuctionDependencyUnavailable`은 `ProcurementDependencyUnavailable`의
  하위형이라 controller가 어느 쪽으로 잡아도 503. `wire.ts`는 ADR의 셋에 `bigintText`·축별 비율 봉투 셋을 더함(복제 2·4벌 제거).
  식별자 범위 팩토리는 `packages/domain/identity/postgres-identity.ts`(모듈끼리 import 금지라 모듈 domain에 두면 세 번째 복제).
  새 gate `server-boundaries`가 application의 wire 타입 import를 막는다(22개 통과). 내가 돌린 것: 단위 124, 경계 검사, OpenAPI
  check, tools 테스트 10. 에이전트 전체 스위트 304 pass. 삭제된 테스트 제목 15개는 presenter 테스트 48개로 옮겨졌고 skip 0.
- **push 1차 실패 → 수정 → 2차.** 넷을 합친 main(24 커밋)의 첫 push는 web 단위 스위트에서 떨어졌다(499 pass·1 fail·1 error):
  `login-screen.test.tsx`가 link 단계에서 `Export named 'signInWithEmail' not found`. 원인은 bun `mock.module`의 성질이다.
  `use-account-session.test.tsx`가 `@/shell/auth/auth-client`를 export 둘로 먼저 mock하면 bun은 이미 mock된 모듈의 namespace를
  제자리에서 갱신하므로 뒤의 mock이 새 이름을 더하지 못한다. 파일 하나만 돌리면 통과하고 전체를 돌려야 보이는 결함이라
  EAT-155의 좁은 검증이 놓쳤다. 리뷰어가 EAT-155 claim으로 두 mock의 export 집합을 같게 맞춰 504 pass로 만들고 다시 push.
  **규칙 갱신:** web 변경 에이전트에게는 세그먼트 테스트가 아니라 `pnpm --filter @eatbid/web test` 전체(15초)를 돌리게 한다.
  "좁은 테스트만"은 컨테이너를 띄우는 서버 통합·e2e에만 적용한다.
- **push 2차 실패 → 수정 → 3차.** web은 504 pass로 지났으나 서버 `pretest`의 tsc가 `dev-login-seed.ts` 네 줄에서 떨어졌다.
  EAT-152가 계정 use case의 반환을 공개 응답에서 내부 record(bigint 식별자)로 바꿨고, 같은 시각에 만들어진 EAT-155의 시드가
  옛 반환(`.businesses`, 문자열 id)을 읽었다. 각 브랜치는 혼자서는 초록이고 git 병합도 텍스트 충돌이 없었다. **병렬 브랜치의
  의미 충돌은 병합 뒤 tsc에서만 보인다.** 리뷰어가 시드를 record 기준으로 고치고(십진 문자열은 출력 경계에서만) 병합 트리에서
  tsc·단위 18·e2e 3·교차 통합 17을 돌린 뒤 다시 push. **규칙 갱신:** 여러 브랜치를 합친 뒤 push 전에 병합 main에서 서버
  `tsc -p tsconfig.build.json`(30초)과 web 단위 스위트(15초)를 먼저 돌린다. 게이트 한 번이 10분이라 이 둘이 훨씬 싸다.

## 9. 다음에 볼 것

`/auctions/[auctionId]`(진입·로더는 봄, 표시 모델·UI 남음) → `/login`·`/setup` → `shell`(레이아웃·dock·테마·명령 검색) → `components`·`shared`(UI 두 벌) → `api/` 층 → `packages/contracts`.

**§10이 이 순서를 대신 소화했다.** 남은 것은 §10-7의 발행 순서를 따른다.

## 10. 폴더별 코드 감사 (2026-09-10 저녁, 읽기 전용 8분할)

배포 작업과 겹치지 않게 `infra/**`를 제외하고 폴더별 읽기 전용 에이전트 여덟을 돌렸다. 보고는 믿지 않고
리뷰어가 파일·행으로 다시 확인한 것만 아래에 적는다.

**실행 메모.** 서브에이전트 기본 모델은 세션 모델과 별개다. 세션을 Opus 5로 바꾼 뒤에도 두 번(16개)이
Fable 한도로 즉사했고 `model`을 명시하고서야 돌았다. 읽기 전용 훑기는 sonnet으로 충분했다.

### 10-1. 종합 판정

기능 결함은 거의 없다. dataplane·db·contracts·domain 넷은 규율이 높고 심각 결함 0건이다. 원본 보존 순서,
문자열 정체성 0건, float 0건, 시간대 없는 시각 0건, 계층 방향 위반 0건, 테스트명 한국어 100%가 전부
전수 확인됐다. **진짜 부채는 코드가 아니라 셋이다: CI가 검사하지 않는 경계, ADR 0044 재편 직후의 기능 간
결합, `packages/domain`의 공개 표면.**

### 10-2. 1순위 — CI가 인가 경계를 한 번도 검사하지 않는다

`validate.yml`의 PR 게이트는 e2e 둘(`foundation`·`decision`)만 돈다. `auth`·`cache`·`today`·`own-bid`
넷은 스크립트로 존재하는데 CI 어디에도 이름이 없다. 계정 간 자료 격리, 남의 등록 id로 보낸 요청의 403,
로그아웃 뒤 쿠키 재사용 거부(ADR 0032가 정한 인가 경계)를 검사하는 유일한 경로가 `test:e2e:auth`인데
그것이 안 돈다. EAT-143이 만든 "서버가 세션을 정확히 한 번 읽는다"는 단언도 production 빌드 모드에서만
실행되는데 그 모드를 돌리는 `test:e2e:cache`도 CI에 없다. 오늘 만든 보장의 서버 쪽 절반이 미판정이다.

같은 자리에 둘째 구멍이 있다. **dataplane 파이썬 검사가 PR에 전혀 없다.** 루트 `pnpm test`는 tools와
TypeScript 패키지 다섯만 돌고 파이썬은 품질 검사용 파일 하나뿐이다. pytest 632개·ruff·pyright는 전부
`build.yml`에 있고 그 워크플로는 `tags: ["release/v*"]`에서만 뜬다. 파이썬 회귀는 릴리즈 시점에야 걸린다.

### 10-3. 2순위 — `_features` 사이의 순환과 역방향 의존

ADR 0044 재편 뒤 결정 화면의 기능 다섯이 서로를 직접 부른다. production 기준 16건이고 그중
`flow/model/flow-chart-model` ↔ `own-bid/model/own-bid-points`는 **실제 순환**이다. 방향은
flow→own-bid 4, own-bid→history 3, rehearsal→history 3, flow→history 2, history→rehearsal 2,
flow→distribution 1, own-bid→flow 1.

여기에 방향이 뒤집힌 것이 하나 더 있다. `distribution/ui/my-rate-input.tsx`가 `_widgets/evidence-view`의
hook을 쓴다. widget이 feature를 조립하는 것이 정상인데 반대다. 그 widget을 지우면 feature가 조용히 깨진다.
`_lib`에 이미 같은 성격의 context 둘(bid-rate-context·attempt-selection)이 정상 위치에 있어 선례가 있다.

ADR 0044 Consequences가 정확히 이 모양을 스스로 신호로 지목했다. 다섯 기능이 같은 회차 행을 보는 근거
화면이라 결합 자체가 전부 잘못은 아니지만, `HistoryRow`를 `_lib`로 올리면 순환이 끊기고 나머지 참조도
대부분 사라진다. 세그먼트 공용인 `_lib`(28건)·`__fixtures__`(18건) 참조는 정상이라 건드리지 않는다.

### 10-4. 3순위 — `packages/domain`의 공개 표면이 EAT-133을 막는다

`packages/domain`의 exports는 `"."` 하나뿐이고 `sideEffects` 선언이 없다. 형제인 `packages/contracts`는
이미 subpath 41개로 같은 문제를 풀었다. domain의 그 barrel이 `Temporal`을 재수출하고 그것이
`temporal-polyfill`을 끌고 오므로 client 컴포넌트는 domain을 통째로 피한다. 확인 결과 domain을 import하는
web 파일 넷은 전부 서버 전용이고 client 컴포넌트는 0건이다.

대가가 코드에 남아 있다. `api/_transport/request-resilience.ts`는 domain의 `seconds()` 대신 `1_000`을
손으로 적고 그 이유를 주석으로 설명한다. `_widgets/bid-rail.tsx`는 의미 있는 지연 타입을 쓸 수 없어
타이머 자체를 없앴다. **EAT-133은 사정률 milli 계산을 domain으로 모으려 하는데 그 계산이 필요한 곳이 바로
client 컴포넌트다. subpath를 먼저 열지 않으면 새 모듈도 같은 이유로 회피되고 리터럴이 하나 더 생긴다.**

EAT-133의 집계도 실제보다 작다. 죽은 export가 9개가 아니라 16개 이상이고 `canonicalDecimal` 리터럴이
6곳이 아니라 8곳이다. 빠진 하나가 contracts의 금액 codec이라 "서버" 기준으로 세면 놓친다.

### 10-5. 상대 경로 규칙 — 측정과 결론

사용자 제안(`../../` 금지)을 재기 위해 전 패키지를 셌다.

| 범위 | `../` | `../../` | `../../../` | `../../../../` | 별칭 |
|---|---:|---:|---:|---:|---|
| apps/web/src | 188 | 29 | 48 | 0 | `@/` 200회 |
| apps/server/src | 157 | 164 | 15 | 54 | 없음 |
| packages/contracts/src | 28 | 32 | 124 | 0 | 없음 |
| packages/db/src | 45 | 0 | 1 | 0 | 없음 |
| packages/domain/src | 3 | 0 | 0 | 0 | 없음 |
| apps/dataplane(Python) | 0 | 0 | 0 | 0 | 절대 import |

**깊이로 막으면 우리가 승인한 구조와 싸운다.** 웹의 깊이 3은 전부 ADR 0044의 `_features/<name>/{ui,model,lib}`가
세그먼트 `_lib`에 닿는 정상 경로다. 계약의 깊이 3은 124건 전부 ADR 0021의 원자→endpoint 정상 방향이고
역방향 0건이다. 반면 서버의 깊이 4(54건)는 모듈에서 `platform`으로 나가는, 소유 단위를 벗어나는 경로다.

**결론: 재는 자는 깊이가 아니라 소유 단위다.** 상대 경로는 자기 소유 단위 안에서만 쓰고 벗어나면 별칭을
쓴다. 단위는 web이 `_features/<이름>`·최상위 층·route segment, 서버가 `platform`·`bootstrap`·`modules/<모듈>`,
패키지가 각 계층 폴더다. 이 규칙이면 10-3의 순환 16건과 역방향 1건이 전부 자동으로 걸리고 정상 46건은
통과한다. 깊이는 규칙이 아니라 신호로 둔다(단위 안인데 깊이 4면 그 단위가 너무 깊다).

**별칭 도입 비용은 처음 추정보다 크다.** Node `imports` 필드는 런타임은 이해하지만 TypeScript는 아니다.
`apps/server`와 `packages/contracts` 둘 다 `moduleResolution: "node"`(레거시 Node10)라 `imports`·`exports`를
해석하지 못해 지금 넣으면 빌드가 깨진다. 해석 방식을 `node16` 계열로 올리거나 `paths`+후처리를 붙여야 하고,
계약 쪽은 컴파일타임 fixture 테스트가 해석 모드를 하드코딩해 함께 고쳐야 한다. bun 테스트는 소스를 직접
읽어 tsc가 깨져도 초록으로 보일 수 있다(§8-5의 교훈과 같은 계열).

린트 자리는 `tools/architecture`다. `check-web-boundaries.mjs`의 `resolveModule`(ts.resolveModuleName 기반)을
재사용해야 별칭·index·확장자를 tsconfig와 같게 판정한다. 판정 자체는 경로만 보면 되는 국소 검사다.

### 10-6. 폴더별 나머지 발견

- **web A(auth·shell·capabilities).** 전역 오류 화면이 영문이고 `lang='en'`이라 스크린리더가 영어로 읽는다
  (형제인 `not-found.tsx`는 이미 한국어). 공고 상세 breadcrumb이 영문 "auctions"와 원시 숫자 id로 그려진다
  (`segmentKo`에 단수형 `auction`만 있고 실제 route는 복수형). **같은 파일에 복합 문자열을 정체성으로 쓰는
  분기가 남아 있다**(`시군구|학교명`을 `|`로 자름, 규칙 2·5 금지). 동작하지 않는 단축키 힌트가 화면에 보이고
  `T T`를 서로 다른 두 동작이 주장한다. 죽은 tsconfig 별칭·오래된 주석 넷.
- **web B(api·shared·entities).** `shared/lib/chart-colors.ts`가 도메인 어휘를 아는데 한 화면만 쓰고 export
  셋(`bubbleColor`·`mapTiles`·`myMarker`)은 참조 0건이다. `shared/ui`의 두 파일이 자기네 아이콘 registry를
  우회한다. `api/win-rate-distribution/index.ts`와 `auctionQueries.open`·`.detail`이 참조 0건이다.
  `rehearsal-axis.test.ts`는 같은 이름의 구현 파일이 없다.
- **db.** `core.code_mapping`의 `status`와 `relation` 두 열에 허용값 check가 없다. 저장소의 다른 상태·역할
  열은 전부 있다. 두 열의 어휘(`label_verified`·`reviewed`, `exact`·`overlaps`)는 Python 상수에만 있어
  업무 사실의 권위가 PostgreSQL이라는 원칙과 어긋난다. 운영 행 0건이라 호환 위험은 없다. `http_status`가
  bigint다(bounded number 관례와 어긋나나 서버는 안 읽음). `migrate.ts`에 모듈 책임 주석이 없다.
  EAT-153 후속 인덱스 둘의 근거가 보강됐다(명단 라벨 조회 패턴이 네 곳에서 쓰임).
  문서가 말하는 `BidWorkItem`이 저장소 전체에 0건이다.
- **dataplane.** 모듈 책임 docstring 4개 파일 누락. 300줄 초과 12개 중 큰 셋은 분리 근거를 이미 적고 있고
  `composition.py`(441줄)만 없다. `core/postgres_projection_writer.py`는 ADR 0033이 "새 기능 전에 나눈다"고
  적어 둔 부채다. `source`↔`ingest` 상호 참조가 문서에 없다. Ruff가 기본 규칙셋만 돈다.
- **domain.** 10-4 외에 `POSTGRES_SIGNED_BIGINT_MAX`가 domain과 contracts 두 곳에 독립적으로 타이핑돼 있고
  drift 테스트가 없다(오늘 EAT-152에서 그 상수를 만들 때 리뷰어가 놓쳤다). 값 자체는 contracts 감사가
  경계값 8,159개로 대조해 불일치 0건을 확인했다. type-test가 금액·좌표·`PercentagePoints`↔`Ratio`를 안 덮는다.
  **`packages/shared`는 이미 없다**(git 추적 0건, ADR 0009에서 패키지째 제거, import 0건). 디스크의 것은 잔재다.
- **contracts.** 코드 체계 진입점만 exports map에서 빠졌다(형제 넷은 있음). 내 투찰 계약 하나가 공유 401
  상수를 안 쓰고 손으로 다시 썼다. 금액·십진 경계 스키마 셋에 전용 테스트가 없다. mart 이름 어휘가 TS·Python
  두 곳인데 교차 검증이 없다(주석 스스로 "갈라지면 무효화는 성공하고 화면만 옛 build를 읽는다"고 경고).
- **tools.** `release --worktree`가 엉뚱한 저장소를 가리킬 수 있다. 경로 해석이 `.git`을 찾을 때까지 부모로
  올라가는데 대상 검사는 존재 여부와 worktree 여부만 본다. 그 경로가 실제 worktree 뿌리인지는 안 본다.
  바로 위 주석이 "조용히 fallback하면 엉뚱한 claim을 지운다"고 적으면서 가드가 그 경우를 못 막는다.
  오늘 리뷰어가 겪은 그 버그다. 한 줄로 고친다. 의미 값 검사의 registry 그래프 순회가 변경 범위 모드에서
  파일 경계에 끊긴다(병합 게이트는 안전). 300줄 기계 검사가 apps/web에만 있다. workflow 도구 오류 메시지가
  영문이다. `tools/m1`·`mechanism`·`synth`는 보존 근거가 문서에 있어 폐기 대상이 아니다.
- **server.** 감사가 아직 도착하지 않았다. 결과는 이 절에 더한다.

### 10-7. 발행 순서 제안

1. **CI 게이트 둘**(10-2). 인가 e2e와 파이썬 검사가 PR에서 돌게 한다. 가장 위험하고 코드 변경이 없다.
2. **`release --worktree` 가드 한 줄**(10-6 tools). 우리 작업 도구의 안전 문제다.
3. **`_features` 순환과 역방향**(10-3). `HistoryRow`를 `_lib`로, `useDecisionRoute`를 `_lib`로.
4. **domain subpath export**(10-4). EAT-133의 선행 작업으로 그 이슈에 넣는다.
5. **소유 단위 상대 경로 린트**(10-5). 3번을 고친 뒤에 넣어야 새 검사가 곧바로 초록이다.
6. **묶음 정리**: web 잔재(영문 오류 화면·breadcrumb·문자열 정체성 분기·단축키 힌트·죽은 코드),
   db check 제약 둘, dataplane docstring 넷, contracts 넷.
