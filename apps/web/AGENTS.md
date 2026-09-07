# eatbid web 작업 계약

루트 [`AGENTS.md`](../../AGENTS.md)의 모든 규칙이 이 디렉터리에도 적용된다. 이 파일은
`apps/web`에서만 필요한 현재 구현 제약을 추가하며 별도 제품 정의를 만들지 않는다.

## 제품 경계

- 이 앱은 범용 admin starter가 아니라 eatbid 운영 워크스페이스다. 화면 의미와 우선순위는
  [`docs/product/roadmap.md`](../../docs/product/roadmap.md)에서 읽는다.
- 관측 사실, 분석 파생값, 사용자 작성 상태를 같은 라벨이나 필드로 합치지 않는다.
- 분석에는 표본 수, 기간/cohort, `as_of`, 계산 버전, 산출 시각과 원본 provenance를 함께
  표현한다. `unknown`, stale, 부분 수집을 정상값처럼 숨기지 않는다.
- 추천 투찰가·예정가 예측·자동 NeaT 입력으로 해석될 기본값이나 행동 유도 문구를 만들지 않는다.

## 현재 기술 계약

- 목표 모듈 경계와 의존 방향은 [ADR 0023](../../docs/adr/0023-nextjs-web-modular-boundaries.md)과
  [Frontend application foundation](../../docs/architecture/frontend-application-foundation.md)을 따른다.
- 현재 manifest와 frozen lock은 Next.js `16.3.4`, React/React DOM `19.2.8`, TypeScript `5.9.3`,
  TanStack Query `5.102.8`, TanStack Form `1.33.5`, Tailwind CSS `4.3.3`을 사용한다. Tailwind v5를
  가정하지 않고 stable v4 lane을 유지한다.
- `typedRoutes: true`와 `next typegen && tsc --noEmit`을 사용한다. route 오류를 `as Route`, `as any` 또는
  `string` widening으로 숨기지 않는다.
- React Compiler는 annotation mode이며 아직 opt-in source가 없다. 첫 `"use memo"`에는 동작 regression과
  전후 성능 증거가 필요하다. Rust compiler path는 별도 감사 전까지 활성화하지 않는다.
- Cache Components는 [ADR 0028](../../docs/adr/0028-cache-components-and-self-hosted-cache.md) 조건 아래 켜져
  있다. `cookies()`·`headers()`·`params`·`searchParams`는 Suspense 안 loader에서만 await하고, root layout과
  shell은 static을 유지한다. `export const instant = false`는 legacy `/dashboard` layout과 공개 `/s/[token]`에만 두며
  canonical route에 새로 추가하지 않는다. nuqs adapter와 legacy infobar provider도 dashboard layout이
  소유하므로 canonical route에서 URL 상태가 필요하면 그 route의 Suspense 경계 안에서 새로 마운트한다. `use cache`는 `api/<resource>/server.ts` read 함수에만 허용하고 사용자별·session
  데이터에는 쓰지 않는다.
- `use cache` read 함수는 예상된 실패(404·사라진 cursor)를 예외 대신 `{ kind: ... }` 결과 값으로 돌려준다.
  캐시 경계를 넘은 예외는 Flight로 옮겨져 class 정체성을 잃으므로 호출자가 `instanceof`로 가려낼 수 없고,
  `notFound()`로 가야 할 404가 error 경계로 샌다. 예상 밖 실패만 그대로 던진다.
- 모노레포 package manager는 루트 `package.json`에 고정된 `pnpm 10.12.1`이다. 앱 내부
  script가 Bun 명령을 호출하더라도 workspace 설치·실행 계약을 Bun으로 바꾸지 않는다.
- Server Component를 기본으로 하고 브라우저 상태나 상호작용이 필요할 때만 `'use client'`를
  사용한다.
- 같은 endpoint의 consumer adapter와 `queryOptions()`는 해당 `api/<resource>`가 한 번 소유한다. capability별
  `api/types.ts → api/service.ts → api/queries.ts` 복제나 다른 capability 내부 역참조를 만들지 않는다.
- canonical API method/path/schema는 `packages/contracts` operation registry가 소유한다. Nest/OpenAPI/Web
  경로를 같은 semantic path definition에서 파생하고 frontend `ENDPOINTS` mirror나 `/api/v1/...` literal을
  만들지 않는다. API origin은 browser same-origin 또는 Git-owned non-secret runtime config가 소유한다. Web strict
  lint에 연결하는 repository endpoint gate를 우회하거나 예외 범위를 넓혀 신규 literal을 숨기지 않는다.
- Web은 `@eatbid/contracts` package root가 아니라 browser-safe resource/identifier subpath만 import한다.
  ingestion registry, generator, Node 전용 코드와 `@eatbid/domain` runtime을 client bundle에 넣지 않는다.
- API resource끼리 직접 import하지 않는다. browser-safe 공개 표면은 `index.ts`, internal origin/cookie/cache를
  쓰는 RSC 표면은 `server.ts`로 분리하고 server entry를 client-safe barrel에서 재수출하지 않는다.
- route는 metadata, RSC read/prefetch와 shell model 주입에 한해 API resource server entry를 직접 쓴다.
  shell은 제품 endpoint를 읽지 않고 상위 layout이 전달한 serializable view를 렌더링한다.
- 한 route에만 필요한 presentation과 interactive leaf는 segment private `_model`/`_ui`/`_lib`에 둔다.
  단순 조회 화면이나 두 곳에서 쓴다는 이유만으로 capability를 만들지 않는다. 독립된 사용자 intent,
  command/permission/feedback lifecycle 또는 여러 resource orchestration이 있을 때만 승격한다.
- raw `fetch`와 `Response` body decode는 `api/_transport`만 수행한다. resource는 승인된 request adapter에
  operation schema를 주입해 `unknown` public response를 parse한다. generic `res.json() as T`, resource의
  transport 우회와 수동 public DTO를 새로 만들지 않고 TanStack Query의 `AbortSignal`을 fetch까지 전달한다.
- 제품 데이터는 NestJS API 계약을 통해 읽는다. 새 화면을 mock store나 Next Route Handler의
  별도 업무 진실 원천에 연결하지 않는다.
- `/api/**`는 Nest ingress다. 신규 Next Route Handler는 별도 ADR, Web owner operation, non-`/api` prefix와
  ingress rule 없이는 만들지 않는다. Server Action에는 DB/domain/business logic을 넣지 않는다.
- URL 검색 상태는 기존 `nuqs` parser를 재사용한다.
- 화면 URL의 권위는 `app/` file-system과 generated route type이다. one-off 정적 path는 typed literal로 쓰고,
  반복되는 동적 path만 `src/routing/<resource>.ts`의 작은 builder로 추출한다. 전체 `ROUTES` mirror,
  존재하지 않는 placeholder와 `as Route` cast로 typecheck를 우회하지 않는다.
- `routing`은 Next `Route` type과 `@eatbid/contracts` identifier atom만 소비한다. Nest API operation path,
  network 호출, query key나 server state를 화면 route builder에 섞지 않는다.
- 아이콘은 `@/components/icons`에서만 가져온다. 단 canonical layer(`app/(workspace)`, `shell`, `capabilities`,
  `api`, `shared`, `routing`)는 legacy-import gate 때문에 이 module을 직접 import할 수 없으므로, 필요한 아이콘을
  `shared/ui`로 옮긴 뒤 사용한다. shell/theme의 기존 import는 삭제 전용 ledger 항목이다.
- 내부 bigint ID는 HTTP 경계에서 선행 0 없는 양의 10진 문자열이다. JavaScript `Number`로
  변환하지 않는다. 상세 계약은 ADR 0018을 따른다.
- Button primitive는 시각·접근성·공통 press motion만 소유한다. 인증·권한·로깅·command는 capability의
  action component에서 합성한다.
- canonical 업무 route와 dashboard는 `ApplicationShell`의 탐색·테마·사이드바 chrome을 공유한다.
  route layout에서 같은 셸 markup을 복제하거나 기획 없이 navigation 항목을 추가하지 않는다.
- `loading.tsx`는 sibling 화면 전용 `ScreenSkeleton` 하나만 반환한다. 실제 화면과 skeleton은 같은 frame과
  section 순서를 공유하며 refetch·mutation을 최초 route loading으로 위장하지 않는다.

## 화면과 코드

- eatbid Web은 한국어 프로젝트다. 사람이 읽는 문서·화면 문구·테스트명·커밋 메시지·이유 주석과
  에이전트 작업 보고는 한국어를 기본으로 한다. 코드 식별자, 라이브러리 고유명, 명령과 외부 원문만
  정확성을 위해 필요한 범위에서 영문을 유지한다.
- 신규·실질 변경 production 모듈은 directive와 import보다 앞에 `@module 책임:` 한국어 설명을 둔다.
  화면 문구나 코드를 반복하지 말고 해당 파일이 소유하는 UI·상태·경계를 한 문장으로 설명한다.
- 한 화면의 1차 질문과 주 행동은 하나로 유지한다.
- 확정 사실을 먼저, 직접 비교를 다음에, 원자료·산식·revision을 상세 단계에 둔다.
- 상태는 색만으로 전달하지 않고 텍스트를 함께 제공한다.
- 화면 문구를 enum이나 계산 로직으로 다시 읽지 않는다.
- formatting은 single quote, JSX single quote, no trailing comma, 2-space indent를 따른다.
- source가 300줄을 넘으면 책임 분리를 검토한다. 유지할 경우 reason, owner와 다음 split trigger가 있는
  명시적 waiver가 필요하다.
- 신규·변경 테스트 이름은 한국어로 작성한다.
- 기존 hook·shared helper·`es-toolkit` 재사용과 React/Next advisory 검토는 `pnpm review:ai`의 실제
  저장소 근거를 사용한다. AI finding은 자동 수정하거나 lint·type·test·architecture 판정을 대체하지 않는다.

## 검증 명령

변경 범위에 맞는 최소 명령을 루트에서 실행한다.

```text
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web lint
pnpm --filter @eatbid/web test:e2e:foundation
pnpm --filter @eatbid/web build
```

빌드가 필요하지 않은 문서·문구 변경에 전체 build를 의례적으로 강제하지 않는다. 실행한 명령과
실행하지 못한 검증은 PR evidence에 정확히 남긴다.
