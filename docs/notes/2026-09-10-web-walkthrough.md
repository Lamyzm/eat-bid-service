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

## 4. web 읽기 경로(캐시·하이드레이션) 관찰

- 세 캐시 층: Next `use cache`(공유, 태그 push 무효화, stale 5분/만료 1시간), TanStack(브라우저별, staleTime 60초, 소비처 셋: `/setup` 사업자 목록, `AccountHub` 세션, 명단 패널), CF(현재 정적만).
- 하이드레이션 설정(`dehydrate.shouldDehydrateQuery`)만 있고 `HydrationBoundary`·`dehydrate()`·`prefetchQuery`는 저장소에 없다. `/setup`은 서버가 세션을 읽어 redirect 판정 → 클라이언트가 세션을 다시 읽음 → 사업자 목록 mount 뒤 조회. 왕복 셋. 서버가 읽은 걸 `HydrationBoundary`로 넘겨 하나로.
- 명단 패널은 브라우저 → Nest 직행, Nest 캐시 없음. revision당 불변이라 `(공고, revision)` 키 캐시.
- 로그인 게이트 없음: `proxy.ts`는 `NextResponse.next()`뿐. `/today`·결정 화면·Nest 공유 read가 공개. 정책대로 proxy 게이트 + Nest guard + 앱 route `noindex`. ADR 0032에 한 절.
- 대칭으로 만든 미사용 client query factory(`auctions.open/detail`, account·win-rate index 재수출).
- 시간 리터럴: `query-client.ts` `60_000`, `read-cache-life.ts` `300/3600`(EAT-133 규칙 대상).

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

## 6. 열어 둔 issue

- EAT-133 의미 값 SSOT(domain 9개 삭제·시간 규칙·KST·milli 연산·scale/통화 JSON·CronWorkflow 시간대 테스트)
- EAT-134 lint 이관(`pnpm lint`·권고형 file-size·검사 카탈로그)
- EAT-124 운영 뷰(ADR 먼저, Backlog)
- (미발행) web 읽기 경로 정합과 부하 목표 / 수집 주기 10분 / web 잔재(UI 두 벌·명령 검색·404·테마는 유지) / `/today` 클라이언트 필터링·내 기록 열

## 7. 다음에 볼 것

`/today` 나머지 파일(`present-open-auctions.ts`, `today-search-params.ts`, `open-auction-table.tsx`, `today-filters.tsx`) → `/auctions/[auctionId]` → `/login`·`/setup` → `shell`·`components`·`shared` → `api/` 층 → `packages/contracts`.
