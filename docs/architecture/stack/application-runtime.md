# 애플리케이션 런타임 감사

최종 조사일은 2026-09-01이다. 저장소 선언이 의도를, lockfile이 resolve된 JavaScript/Python 의존성을
증명한다. 개발자 PC에 우연히 설치된 실행 파일은 저장소 pin이 아니며, 승인된 목표도 frozen lock과 관련
gate가 통과하기 전에는 현재 상태로 기록하지 않는다.

## 현재 기준선

root와 CI는 Node `24.20.0`, root는 pnpm `10.12.1`, TypeScript `5.9.3`, Turborepo `2.10.12`를 exact로
고정한다. 현재 shell은 Node `24.2.0`이므로 이 환경의 engine warning이 있는 결과는 source 진단 증거이지
release 증거가 아니다. CI는 Bun 1.2.22와 uv 0.12.6을 고정하고 Docker image는 digest로 고정한다. Python
setup action은 아직 3.12 계열만 선택하므로 exact patch binary 증거는 아니다.

Server는 exact Nest 12 package(`12.0.0`/`12.0.1`), TypeScript `5.9.3`, `effect@4.0.0-rc.112`를 사용한다.
Nest CLI/schematics 없이 `tsc`로 build하는 것이 현재 계약이다.

Web manifest와 frozen lock은 Next `16.3.4`, React/React DOM `19.2.8`, TypeScript `5.9.3`, TanStack Query
`5.102.8`, TanStack Form `1.33.5`, Tailwind/PostCSS plugin `4.3.3`, Zod `4.5.4`를 사용한다. `kbar`와 그
React 16/17 전용 `react-virtual` closure는 제거했고 기존 `cmdk` primitive로 command palette를 교체했다.
`typedRoutes: true`, deterministic `next typegen && tsc --noEmit`, annotation mode React Compiler와 Web-local
Happy DOM/Testing Library preload가 적용됐다. Next 16.3.4 production build와 Web 한국어 테스트 47개가 현재
shell에서 통과했다. build는 `Google Sans Flex` fallback 값을 찾지 못했다는 non-blocking warning 하나를 남겼다.

Web은 `@eatbid/contracts`를 선언했지만 browser-safe resource subpath와 contract validating transport는 다음
architecture slice에서 완성한다. 따라서 runtime upgrade 완료가 API 계약 migration 완료를 뜻하지 않는다.

dataplane은 Python `>=3.12`를 요구하고 `uv.lock`은 Pydantic 2.13.5, defusedxml 0.7.1, httpx 0.28.1,
psycopg 3.3.4, pytest 9.1.1, Ruff 0.16.5, Pyright 1.1.411을 resolve한다.

## 결정표

| 항목 | 저장소 선언 또는 resolve 상태 | 2026-09-01 확인 근거 | 결정 | 이유와 재검토 조건 |
|---|---|---|---|---|
| Node.js | root/CI exact `24.20.0`, 현재 shell 24.2.0 | [Node release policy](https://nodejs.org/en/about/previous-releases) | 출시 전 필수 | local 또는 CI의 exact patch에서 frozen install/test/typecheck/build/hard navigation을 다시 증명한다. Node 24 LTS 종료나 image patch 변경 시 재검토한다. |
| TypeScript | root/Server/Web exact `5.9.3` | [TypeScript 5.9 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) | 채택 | Next typegen 뒤 strict typecheck를 실행한다. compiler major 또는 strictness 변경 시 재검토한다. |
| pnpm | `packageManager`와 engine exact `10.12.1`, frozen lock | [pnpm package manager field](https://pnpm.io/package_json#packagemanager) | 채택 | 유일한 workspace install/dependency 권위다. frozen install 결과가 lock과 달라지면 즉시 재검토한다. |
| Turborepo | root exact `2.10.12` | [Turborepo releases](https://github.com/vercel/turbo/releases) | 채택 | task cache 정확성 실패 또는 major upgrade 시 재검토한다. |
| Bun | root test가 사용하고 CI는 1.2.22 | [Bun releases](https://github.com/oven-sh/bun/releases) | 채택 | test runtime이며 workspace package manager가 아니다. Bun 변경이나 DOM 동작 차이 발생 시 재검토한다. |
| Next.js | Web exact `16.3.4`, production build 통과 | [August 2026 security release](https://nextjs.org/blog/august-2026-security-release) | 채택 | Active LTS security release를 exact로 유지한다. 보안 release 또는 App Router major마다 재검토한다. |
| React / React DOM | Web exact `19.2.8` | [React package](https://www.npmjs.com/package/react), [React DOM package](https://www.npmjs.com/package/react-dom) | 채택 | 둘을 함께 올리고 Next peer lane을 검증한다. React major 또는 Next peer 변경 시 재검토한다. |
| App Router와 RSC | App Router 사용, legacy route-level Client Component 존재 | [Next project structure](https://nextjs.org/docs/app/getting-started/project-structure), [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 채택 | RSC가 기본이며 상호작용 leaf만 Client Component다. route/layout에 `'use client'`가 필요할 때 재검토한다. |
| typed route | 최상위 `typedRoutes: true`, deterministic typegen | [typedRoutes](https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes), [Next TypeScript guide](https://nextjs.org/docs/app/api-reference/config/typescript) | 채택 | navigation은 generated `Route`를 사용하고 `as Route`로 우회하지 않는다. route generation 실패 시 재검토한다. |
| Tailwind CSS | Tailwind/PostCSS plugin exact `4.3.3` | [Tailwind Next guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs) | 채택 | production v5를 가정하지 않고 CSS custom property를 runtime token 권위로 둔다. v5 stable과 migration 증거가 함께 있을 때 재검토한다. |
| TanStack Query | exact `5.102.8` | [Query Options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options), [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) | 채택 | resource API가 `queryOptions()`와 supplied signal을 소유한다. universal state로 쓰지 않는다. cache/hydration 정책 변경 시 재검토한다. |
| TanStack Form | stable exact `1.33.5` | [v2 alpha announcement](https://tanstack.com/blog/announcing-tanstack-form-v2-alpha), [stable package](https://www.npmjs.com/package/%40tanstack/react-form) | 채택 | contract-backed command에는 v1을 쓴다. v2 stable과 persistence/submit-intent 필요가 확인된 뒤 adapter issue에서 검토한다. |
| nuqs | lock `2.10.1` | [nuqs documentation](https://nuqs.dev/docs) | 채택 | 공유 가능한 filter/sort/page/tab URL state를 소유한다. typed search 연동 변경 시 재검토한다. |
| Zod public contract | Web Zod `4.5.4`, `@eatbid/contracts` workspace 선언 | [Zod basics](https://zod.dev/basics) | 출시 전 필수 | browser-safe ESM resource subpath와 API boundary의 `unknown` parse를 구현하고 clean dev/typecheck/build/import graph를 증명한다. |
| React Compiler | plugin exact `1.0.0`, annotation mode, opt-in source 0개 | [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1), [Next config](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler) | 채택 | 현재는 최적화 성과가 아니라 비활성 정책 경계다. 첫 `"use memo"` 후보는 동작 regression과 전후 성능 증거를 요구한다. |
| command palette | `kbar` 제거, 기존 `cmdk` 사용 | [cmdk repository](https://github.com/pacocoursey/cmdk) | 채택 | Cmd/Ctrl+K, 검색, keyboard 실행, theme action과 focus 복귀를 한국어 interaction test로 고정한다. |
| Web interaction test | Testing Library `16.3.3`, user-event `14.6.6`, Happy DOM `20.12.0` | [Testing Library setup](https://testing-library.com/docs/react-testing-library/setup/), [Happy DOM repository](https://github.com/capricorn86/happy-dom) | 채택 | Web-local Bun preload로 실제 keyboard/focus/DOM behavior를 검증한다. source regex test로 대체하지 않는다. |
| Rust React Compiler | 미설정 | [Next 16.3](https://nextjs.org/blog/next-16-3) | 연기 | `experimental.turbopackRustReactCompiler`는 stable support와 parity evidence가 생긴 뒤 검토한다. |
| Cache Components | 미설정, 현재 dynamic/uncached route 존재 | [Cache Components](https://nextjs.org/docs/app/getting-started/partial-prerendering), [self-hosting](https://nextjs.org/docs/app/guides/self-hosting) | 연기 | route/Suspense, auth/cookie, tag invalidation과 multi-instance cache coordination 감사 전에는 전역 활성화하지 않는다. |
| Zustand | lock `5.0.15` | [Zustand documentation](https://zustand.docs.pmnd.rs/) | 채택 | 입증된 deep client editor state에만 쓴다. server fact, candidate authority와 URL state에는 쓰지 않는다. |
| shadcn/Base UI/Tailwind primitive | 기존 template stack | [shadcn components](https://ui.shadcn.com/docs/components), [Base UI](https://base-ui.com/react/overview/quick-start) | 채택 | semantic CSS token과 composable primitive를 보존한다. base Button은 design/accessibility/motion, capability action은 auth/logging/command를 소유한다. |
| NestJS | exact runtime package 12.0.0/12.0.1, CLI 없음 | [Nest migration guide](https://docs.nestjs.com/migration-guide) | 채택 | runtime major와 TypeScript 5.9.3, compiled Node compatibility를 유지한다. CLI는 compatible lane에서만 재검토한다. |
| Effect | exact `4.0.0-rc.112` | [Effect repository](https://github.com/Effect-TS/effect), [Effect runtime](https://effect.website/docs/runtime/) | 채택 | Nest 소유 `EffectRunner` 뒤에서 사용한다. request scoped runtime이나 두 번째 global Layer container를 만들지 않는다. |
| Python | dataplane `>=3.12`, image digest pin, CI 3.12 계열 | [Python status](https://devguide.python.org/versions/) | 출시 전 필수 | production 전 exact CI interpreter 증거를 남긴다. Python support나 image digest 변경 시 재검토한다. |
| uv | CI 0.12.6, digest-pinned builder, frozen lock | [uv releases](https://github.com/astral-sh/uv/releases) | 채택 | 실행 파일/action/image digest나 lock format 변경 시 재검토한다. |
| Pydantic / defusedxml / httpx | lock 2.13.5 / 0.7.1 / 0.28.1 | [Pydantic releases](https://github.com/pydantic/pydantic/releases), [Python XML security](https://docs.python.org/3.12/library/xml.html#xml-vulnerabilities), [httpx releases](https://github.com/encode/httpx/releases) | 채택 | major/security advisory 또는 source contract/transport 변경 시 재검토한다. |
| pytest / Ruff / Pyright | lock 9.1.1 / 0.16.5 / 1.1.411 | [pytest releases](https://github.com/pytest-dev/pytest/releases), [Ruff releases](https://github.com/astral-sh/ruff/releases), [Pyright releases](https://github.com/microsoft/pyright/releases) | 채택 | major upgrade, plugin incompatibility 또는 gate output 변경 시 재검토한다. |

## 제외 또는 연기

두 번째 workspace package manager, universal client query layer, global server-state store, persistent browser
authority, business BFF Route Handler, capability local duplicate API scaffold, premature microfrontend와 별도
design-system package는 도입하지 않는다. 최상위 `api`는 resource 중심 server-state module에만 사용하며 UI,
authorization, toast policy, form orchestration과 business rule을 쌓는 공간이 아니다. Resource module끼리 직접
import하지 않는다.

React Compiler를 켰다는 이유로 explicit memoization을 일괄 삭제하지 않고 Cache Components를 config-only
optimization으로 취급하지 않는다. TanStack Form v2 alpha, Rust React Compiler, Immer와 es-toolkit은 현재
foundation default가 아니라 증거 기반 재검토 대상이다.

## 재검토 조건

package manifest나 lock이 바뀌면 frozen install과 관련 generation/typecheck/lint/test/build를 실행한다. runtime
family/pinning 정책, Web import DAG, server/client API entry, global state ownership, hydration/cache 정책 또는 제품
Route Handler/BFF를 바꾸기 전에 ADR을 작성한다. security advisory, EOL, dependency rule 예외, 신규 persistent
browser store 또는 CI/container 재현성 차이는 즉시 재검토한다. protected branch에서 실행한 증거와 배포
digest/signature를 보존하기 전에는 commit된 pin만으로 production 완료를 선언하지 않는다.
