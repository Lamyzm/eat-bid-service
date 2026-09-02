# 0028 — Cache Components를 조건부로 활성화하고 self-hosted cache 경계를 고정한다

- Status: Accepted
- Date: 2026-09-02
- Supersedes: 없음. [0023](0023-nextjs-web-modular-boundaries.md)의 모듈 경계와
  [`frontend-application-foundation.md`](../architecture/frontend-application-foundation.md)의 로딩 전략 문장을
  이 결정에 맞게 갱신한다.

## Context

Web은 Next.js `16.3.4` App Router이며 `apps/web/next.config.ts`는 Cache Components를 "route/Suspense/auth/cache
조합을 별도로 검토하기 전까지" 보류해 왔다. 2026-09-02 사용자 결정은 활성화하되 조건을 ADR로 남기는 것이다.

공식 문서(16.3.4, 2026-06-22/08-25)에서 확인한 사실은 다음과 같다.

- Cache Components는 route를 static shell과 dynamic hole로 나눈다. `cookies()`, `headers()`, `params`,
  `searchParams`는 Suspense 경계 안에서 await해야 하고, 경계 밖의 dynamic 접근은 build에서 blocking-prerender
  오류로 실패한다. 상위 `loading.tsx`도 유효한 경계지만 static shell을 위해서는 page 안 Suspense가 권장된다.
- root layout이 `cookies()`로 `<html data-theme>`을 정하면 감쌀 자식이 없어 shell 전체가 dynamic이 된다.
  `<head>` inline script로 첫 paint 전에 속성을 설정하면 shell을 static으로 유지할 수 있다.
- legacy route는 `export const instant = false`로 검증에서 제외할 수 있다. 다만 `new Date()`,
  `Math.random()` 같은 동기 IO는 `instant = false`로 우회되지 않는다.
- `use cache`의 결과는 pod별 in-memory다. self-hosting에서 replica를 늘리면 `cacheHandlers`와
  `refreshTags`로 공유 cache handler를 붙여야 한다. 현재 web replica는 1이다(`infra/k8s/base/app.yaml`).
- PPR은 streaming 없이는 이점이 없다. Cloudflare Tunnel + Ingress 경유 시 응답 버퍼링 여부를 확인해야 한다.
- Activity로 route 상태가 보존돼 dialog·dropdown·sidebar가 뒤로가기 후 열린 채 남을 수 있다.

현재 저장소에서 위 조건에 걸리는 곳은 root layout의 theme cookie, `ApplicationShell`의 sidebar cookie,
`/auctions/[auctionId]`의 `params` await, 그리고 legacy `/dashboard/**` 전체다.

## Decision

1. `apps/web/next.config.ts`에 `cacheComponents: true`를 켠다. canonical route(`app/(workspace)`)는
   blocking-prerender 오류 0건이어야 하며, 이를 `pnpm --filter @eatbid/web build`가 gate한다.
2. dynamic 접근은 Suspense 안 loader component로 격리한다.
   - root layout은 `cookies()`를 읽지 않는다. `data-theme`는 `<head>` inline script가 cookie에서 첫 paint 전에
     설정하고, client `ActiveThemeProvider`는 DOM 속성을 초기값으로 읽는다.
   - `ApplicationShell`의 sidebar cookie 읽기는 Suspense 안 `SidebarStateLoader`로 옮긴다.
   - `/auctions/[auctionId]`는 `params` await를 Suspense 안 loader로 옮기고 fallback으로
     `AuctionScreenSkeleton`을 쓴다.
3. legacy `/dashboard/**` page/layout은 `export const instant = false`로 검증에서 제외한다. 이 export는
   삭제 전용이며 canonical route에 새로 추가하지 않는다.
4. cache 사용 경계:
   - replica 1에서는 Next 기본 in-memory cache를 허용한다. replica를 늘리기 전에 공유 cache handler
     (`cacheHandlers`, `refreshTags`)를 같은 변경에서 도입해야 하며, 그 전의 replica 증가는 금지한다.
   - edge runtime은 사용하지 않는다.
   - `use cache`는 `api/<resource>/server.ts`의 read 함수에만 허용한다. 사용자별·session 의존 데이터와
     `cookies()`/`headers()`에 의존하는 함수에는 금지한다.
   - `updateTag`/`revalidateTag`는 해당 resource의 server entry가 소유한다. route나 capability가 tag 문자열을
     직접 만들지 않는다.
5. streaming 확인: dev 환경의 Tunnel + Ingress 경로에서 첫 chunk가 shell을 먼저 보내는지 확인하고 결과를
   PR evidence에 남긴다. 버퍼링되면 `X-Accel-Buffering: no` header를 `next.config.ts` `headers()`에 추가한다.

## Consequences

- canonical route는 static shell을 즉시 보내고 dynamic 부분만 streaming한다. e2e는 `/auctions/:id`에서
  status role이 heading보다 먼저 보이는 것, light/dark hard refresh에서 FOUC가 없는 것,
  `/dashboard/today`가 그대로 렌더되는 것을 고정한다.
- theme 초기값이 server render에서 client inline script로 옮겨가므로 JavaScript가 막힌 환경에서는 기본
  theme으로 렌더된다. 운영 워크스페이스에서 허용한다.
- `instant = false` 항목 수가 legacy route 부채의 크기를 드러낸다. legacy route를 canonical로 옮길 때
  export를 지운다.
- replica 증가·edge runtime·`use cache` 범위 확대는 이 ADR의 조건을 갱신하는 새 ADR 없이는 할 수 없다.

## Rejected alternatives

- **전역 활성화 보류 유지**: canonical route가 늘어날수록 나중 전환 비용이 커지고, 첫 slice 하나뿐인 지금이
  가장 싸다. 사용자 결정으로 기각.
- **root layout을 dynamic으로 두고 Cache Components만 켜기**: 모든 route의 shell이 dynamic이 돼 Cache
  Components의 이점이 없다.
- **처음부터 공유 cache handler 도입**: replica 1에서는 측정된 필요가 없고 운영 의존성만 늘린다.
  [AGENTS.md](../../AGENTS.md) 11항(측정된 병목 없이 인프라를 늘리지 않는다)에 따라 기각.
- **`use cache`를 capability·route에서 자유롭게 사용**: 사용자별 데이터가 pod cache에 섞일 위험과 tag 소유권
  분산 때문에 기각.
