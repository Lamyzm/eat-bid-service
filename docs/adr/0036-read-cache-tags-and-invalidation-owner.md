# 0036 — 결정 화면 읽기 캐시의 태그 어휘와 무효화 소유자

- Status: Proposed
- Date: 2026-09-06
- 관계: [0031](0031-decision-screen-frontend-rendering.md) **7항을 대체한다.**
  [0028](0028-cache-components-and-self-hosted-cache.md) 4항의 `use cache` 범위 규칙 안에서 동작하며
  그 조건을 넓히지 않는다. [0023](0023-nextjs-web-modular-boundaries.md)이 web `route.ts`의 예외로
  요구한 "별도 ADR, Web owner operation, non-`/api` prefix, ingress rule"의 그 별도 ADR이다.
  [0034](0034-mart-build-identity-and-atomic-activation.md)가 만든 build 정체성을 읽기 쪽 어휘로 번역한다.

## Context

ADR 0031-7은 근거 영역을 `cacheTag('auction:<id>')`와 `cacheTag('mart:<release>')`로 캐시하라고 정했다.
그 뒤 두 가지가 변했다. EAT-44가 자유 문자열 `mart_release`를 지우고 `mart.build`의 `buildId`로 옮겼고
(ADR 0034), `apps/web/src`에는 `use cache`가 한 줄도 없어 결정 화면은 열 때마다 Nest를 세 번 부른다.

`mart:<buildId>`를 그대로 무효화 태그로 쓸 수 없다는 것이 이 결정의 출발점이다. 캐시 항목이 지닌 것은
그 응답이 **읽은** build id이고, 무효화를 부르는 `build-marts`가 아는 것은 방금 **활성화한** build id다.
두 값은 정의상 다르므로 새 id로 태그를 지우면 아무것도 지워지지 않는다. 양쪽이 추가 상태 없이 부를 수
있는 이름은 mart 이름뿐이며, 그것은 build를 건너 안정적이다.

`revalidateTag`는 Next 프로세스 안에서만 실행된다. push 방식은 web에 HTTP 진입점 하나를 만드는 것을
반드시 포함하고, ADR 0023은 그 대가를 이미 정해 두었다.

## Decision

1. **읽기 태그의 권위는 mart 이름과 resource id다.** 캐시된 read 함수는 다음을 붙인다.
   `getAuctionFromServer` → `auction:<auctionId>` + `allAuctions`.
   `listOrganizationAuctionAttemptsFromServer` → `org:<organizationId>` + `mart:org_round_summary`.
   `findWinRateDistributionFromServer` → `mart:win_rate_distribution_monthly`.
   태그 문자열은 `packages/contracts`의 `values/cache-tag.ts`가 소유하고 읽는 쪽과 지우는 쪽이 같은
   생성기를 쓴다. `org:<id>`는 붙이되 지금은 아무도 지우지 않는다 — 기관 회차 이력의 신선도는 함께
   걸린 `mart:org_round_summary`가 좌우하며, 이 태그는 기관 단위 정밀 무효화가 필요해질 때의 자리다.
2. **무효화 소유자는 dataplane이다.** `project`가 core 발행 뒤에, `build-marts`가 활성 전환 뒤에
   클러스터 내부 Service URL(`EATBID_WEB_INTERNAL_URL`, 예 `http://web`)로
   `POST /internal/cache/revalidate`를 부른다. Argo가 단계를 실행하고 Kubernetes CronJob이나 별도
   스케줄러를 만들지 않는다(AGENTS 9). 새 배포 단위·큐도 만들지 않는다(AGENTS 11).
3. **무효화 실패는 발행·빌드를 실패시키지 않는다.** 활성 포인터는 이미 움직였고 되돌리지 않는다.
   실패는 JSON 한 줄 로그로 남기며(ADR 0011: 파생물은 stale이 정상 상태), 화면은 5항의 `cacheLife`
   상한 안에서 스스로 회복한다.
4. **요청 본문은 태그 문자열이 아니라 의미 범위다.** `{ marts?, auctionIds?, allAuctions? }`.
   태그 문자열을 만드는 자리는 각 API resource의 `server.ts`뿐이고(ADR 0028-4), route handler는
   범위를 resource 무효화 함수로 나눠 보내는 dispatcher다. 공고 무효화는 `allAuctions` 한 방으로 한다.
   발행 결과에 organization id 목록이 없고, 그것을 얻으려고 CLI 결과 스키마를 늘리지 않는다(AGENTS 11).
   공고 상세는 PK 1행 조회라 통째로 비워도 재계산 비용이 병목이 아니다.
5. **push는 유일한 신선도 수단이 아니다.** 세 read 함수 모두
   `cacheLife({ stale: 300, revalidate: 900, expire: 3600 })`을 명시한다. 기본 profile은 만료가 없어
   push 한 번의 유실이 무기한 stale이 된다. 이 상한은 신선도 요구가 아니라 push 유실의 최대 피해를 정한다.
6. **진입점은 web 소유 operation이다.** `packages/contracts/src/api/internal`에 `implementationOwner: "web"`,
   non-`/api` prefix `/internal/cache/revalidate`로 정의한다. 이 operation은 Nest 공개 OpenAPI를 모으는
   `publicHttpOperationRegistry`에 넣지 않는다 — 클러스터 내부 표면이라 공개 계약 문서에 광고하지 않는다.
   `check-http-operations.mjs`의 route handler 금지 규칙은 이 registry에서 파생한 예외만 통과시키며,
   손으로 적은 예외 목록이나 baseline을 두지 않는다(AGENTS 19).
7. **노출은 두 겹으로 막는다.** (1) `EATBID_CACHE_REVALIDATE_TOKEN` Bearer 토큰을 상수 시간으로 비교하고
   토큰이 없거나 틀리면 401, 서버에 토큰이 설정되지 않았으면 500이다(설정 누락이 "인증 없음"으로 열리지
   않는다). (2) Traefik `ipAllowList` middleware를 붙인 `/internal` 전용 Ingress. Cloudflare Tunnel의
   cloudflared가 클러스터 안에서 돌기 때문에 remote address는 항상 pod IP다. 그래서 `ipStrategy.depth: 1`로
   `X-Forwarded-For`의 원 클라이언트 IP를 판정 대상으로 삼는다. 터널을 통해 들어온 요청은 공인 IP라 항상
   403이고, `X-Forwarded-For`가 없는 직접 요청도 403이다. 정상 호출자인 dataplane은 Service ClusterIP로
   직접 붙어 Traefik을 지나지 않는다. Cloudflare Access 정책은 채택하지 않는다 — 클러스터 밖에 미기록
   수기 자산이 하나 더 생긴다.
8. **사용자별 데이터는 이 경로에 들어오지 않는다.** 캐시되는 세 operation은 workspace·session을 입력으로
   받지 않고, 내 기록(EAT-40)은 client TanStack Query가 소유해 RSC를 통과하지 않는다. 이 경계를 사람
   규율이 아니라 `check-web-boundaries.mjs`의 두 규칙(`use cache` 위치, `cookies`/`headers` 동거 금지)이
   검사한다.
9. **서버는 이번에 캐시 헤더를 새로 내지 않는다.** buildId 기반 ETag와 304 협상은 후속 이슈로 분리한다.
   304는 본문이 없어 "unknown 응답을 계약 schema로 parse한다"는 transport 불변식과 충돌하고
   (`api/_transport/request-contract.ts`는 `if-none-match`를 보내지도 304를 다루지도 않는다), 절약 대상이
   클러스터 내부 바이트뿐이며, DB 읽기는 ETag가 아니라 태그 캐시가 없앤다. 공개 CDN이나 브라우저가 mart
   응답을 직접 받는 날 다시 검토하며, 그때는 ETag보다 `Cache-Control: public, stale-while-revalidate`가 먼저다.

## Consequences

- 같은 build에서 결정 화면 재열람의 Nest 요청이 3회에서 0회가 된다. 발행·build 전환 뒤 첫 열람은 새 값이다.
- web에 `/api`가 아닌 HTTP 표면이 하나 생긴다. 토큰이 유출돼도 할 수 있는 일은 "캐시를 비우는 것"이며
  데이터 노출도 쓰기도 아니다. 회전은 Infisical `/runtime/web`·`/runtime/dataplane`의 같은 키를 함께 바꾼다.
- 무효화 실패는 mart 활성화를 되돌리지 않고 로그로만 남는다. 실패가 잦아지면 `cacheLife` 상한이 실제
  신선도가 되므로 그 상한을 운영 지표로 본다.
- 태그 어휘가 계약에 생기므로 EAT-39(오늘 목록, `mart:open_auction_snapshot`)와 이후 화면은 같은 어휘를
  재사용하고 새 무효화 경로를 만들지 않는다.
- replica를 늘려야 하는 실측이 나오면 in-memory 태그 캐시가 pod마다 갈라진다. 그때 ADR 0028-4가 요구하는
  공유 cache handler를 도입하며, 이 결정의 태그 어휘와 진입점은 그대로 쓴다.

## Rejected alternatives

- **`mart:<buildId>`를 무효화 태그로 쓴다** — 지우는 쪽이 아는 id와 붙은 id가 정의상 다르다. 동작하지 않는다.
- **활성 build 포인터를 매 요청 읽어 캐시 키에 넣는다(pull)** — 무효화 장치가 필요 없고 정확성이 구조에서
  나오지만, 포인터 요청 자체가 Nest 왕복이라 "재열람 0회"를 만족하지 못하고 포인터가 없는
  core(`findAuction`)를 전혀 해결하지 못한다. 새 공개 endpoint도 하나 늘어난다.
- **짧은 `cacheLife`만으로 신선도를 만든다** — stale-while-revalidate라 만료 후 첫 열람이 반드시 옛 값이다.
  "전환 뒤 첫 열람은 새 값"을 정의상 만족할 수 없다.
- **Argo에 `revalidate` 단계를 따로 만든다** — mart 결과를 output parameter로 올리고 template과 task를
  두 DAG에 더해야 한다. 무효화 시점을 아는 것은 발행·빌드를 방금 끝낸 그 프로세스이며, 그 사실을
  workflow YAML로 다시 옮기면 판단이 두 곳에 산다.
- **dataplane → Nest → web으로 중계한다** — Nest가 web 캐시 수명이라는 남의 책임을 얻고 홉과 비밀이 늘며
  진입점이 `/api` ingress에 놓여 외부 노출 면이 더 넓어진다.
- **공유 cache handler가 `mart.build`를 만료 원천으로 읽는다** — 신호가 이미 DB에 있어 개념적으로 가장
  정직하지만 web이 DB 연결을 얻어 ADR 0023의 의존 방향을 깬다. replica 1에서 측정된 필요도 없다(AGENTS 11).
