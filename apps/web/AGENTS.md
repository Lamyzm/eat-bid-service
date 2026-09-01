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
  전후 성능 증거가 필요하다. Cache Components와 Rust compiler path는 별도 감사 전까지 활성화하지 않는다.
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
- 아이콘은 `@/components/icons`에서만 가져온다.
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
- 한 화면의 1차 질문과 주 행동은 하나로 유지한다.
- 확정 사실을 먼저, 직접 비교를 다음에, 원자료·산식·revision을 상세 단계에 둔다.
- 상태는 색만으로 전달하지 않고 텍스트를 함께 제공한다.
- 화면 문구를 enum이나 계산 로직으로 다시 읽지 않는다.
- formatting은 single quote, JSX single quote, no trailing comma, 2-space indent를 따른다.
- source가 300줄을 넘으면 책임 분리를 검토한다. 유지할 경우 reason, owner와 다음 split trigger가 있는
  명시적 waiver가 필요하다.
- 신규·변경 테스트 이름은 한국어로 작성한다.

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
