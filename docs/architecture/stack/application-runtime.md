# Application runtime audit

Research was checked on 2026-08-31. Repository declarations are the authority for intent;
lockfiles are the authority for a resolved JavaScript/Python dependency. An executable available
on a developer machine is not a repository pin, and an approved target is not current state until
the frozen lock and applicable gates pass.

## Current baseline

The root and CI pin Node `24.20.0`; the root also pins pnpm `10.12.1`, TypeScript `5.9.3`, and
Turborepo `2.10.12` exactly. The current shell runs Node `24.2.0`, so its engine warning is not
release evidence. CI pins Bun 1.2.22 and uv 0.12.6; Dockerfiles pin base images by digest. CI still
selects Python 3.12 by family, so that setup action is not an exact patch-binary pin.

Server already runs exact Nest 12 packages (`12.0.0`/`12.0.1`), TypeScript `5.9.3`, and
`effect@4.0.0-rc.112`. It builds with `tsc` and intentionally has no Nest CLI/schematics lane.
Those are current implementation facts, not future targets.

Web currently declares Next `16.2.12`, React/React DOM `19.2.4`, TypeScript `5.7.2`, broad
TanStack/Tailwind ranges, and legacy `@eatbid/shared`. The frozen lock resolves TanStack Query
`5.102.6`, TanStack Form `1.33.5`, Tailwind/PostCSS plugin `4.3.3`, Zod `4.5.4`, nuqs `2.10.1`,
and Zustand `5.0.15`. Web does not declare or import `@eatbid/contracts`; its current fetch helpers
cast unchecked JSON. The current `kbar` closure also resolves `react-virtual@2.10.4`, whose peer lane
stops at React 17. ADR 0023 therefore defines an approved target, not a completed cutover.

The dataplane requires Python `>=3.12`; `uv.lock` resolves Pydantic 2.13.5, defusedxml 0.7.1,
httpx 0.28.1, psycopg 3.3.4, pytest 9.1.1, Ruff 0.16.5, and Pyright 1.1.411.

## Decision table

| Item | Repository declaration / resolved state | Official evidence checked 2026-08-31 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Node.js | root and CI exact `24.20.0`; current shell 24.2.0 | [Node release policy](https://nodejs.org/en/about/previous-releases) | Adopted | Use the exact root patch in dev, CI and image compatibility evidence. Review when Node 24 leaves LTS or the image/runtime patch changes. |
| TypeScript | root/server `5.9.3`; web `5.7.2`; db/shared ranges resolve separately | [TypeScript 5.9 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) | Required before production | Move Web to exact `5.9.3` with Next type generation, typecheck and build. Review on compiler major or strictness change. |
| pnpm | `packageManager` and engine exact `10.12.1`; frozen lock | [pnpm package manager field](https://pnpm.io/package_json#packagemanager) | Adopted | It is the only install/dependency authority. Review if frozen install differs from the lock. |
| Turborepo | root exact `2.10.12` | [Turborepo releases](https://github.com/vercel/turbo/releases) | Adopted | Review on task-cache correctness failure or major upgrade. |
| Bun | root tests invoke Bun; CI pins 1.2.22 | [Bun releases](https://github.com/oven-sh/bun/releases) | Adopted | It is the test runtime, not the workspace package manager. Review on test-runtime divergence or Bun change. |
| Next.js | current exact `16.2.12`; approved exact target `16.3.3` | [August 2026 security release](https://nextjs.org/blog/august-2026-security-release) | Required before production | Upgrade to the Active LTS security release and pass typegen/typecheck/build/hard-navigation checks. Review every security release or App Router major. |
| React / React DOM | current exact `19.2.4`; approved exact target `19.2.8` | [React package](https://www.npmjs.com/package/react), [React DOM package](https://www.npmjs.com/package/react-dom) | Required before production | Upgrade together within Next's peer lane. Review on React major or Next peer change. |
| App Router and RSC | existing App Router, but many route-level Client Components and direct fetches | [Next project structure](https://nextjs.org/docs/app/getting-started/project-structure), [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | Adopted | RSC is the default; Client Components are interactive leaves. Review when a route/layout needs `'use client'` or non-serializable props. |
| Typed routes | not configured | [typedRoutes](https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes), [Next TypeScript guide](https://nextjs.org/docs/app/api-reference/config/typescript) | Required before production | Set top-level `typedRoutes: true`; deterministic typecheck is `next typegen && tsc --noEmit`. Review on route-generation failure. |
| Tailwind CSS | manifest `^4.2.2`; lock `4.3.3` for Tailwind and PostCSS plugin | [Tailwind Next guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Tailwind package](https://www.npmjs.com/package/tailwindcss) | Adopted | There is no production v5 target. Align the manifest exactly in EAT-9, keep CSS custom properties as runtime token authority, and review on v5 stable plus migration evidence. |
| TanStack Query | manifest `^5.95.2`; lock `5.102.6`; approved exact target `5.102.8` | [Query Options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options), [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) | Required before production | Resource API owns reusable `queryOptions()` and consumes the supplied signal. It is not universal state. Review on cache/hydration policy or major change. |
| TanStack Form | manifest `^1.28.5`; lock and approved target `1.33.5`; v2 is `2.0.0-alpha.2` | [v2 alpha announcement](https://tanstack.com/blog/announcing-tanstack-form-v2-alpha), [stable package](https://www.npmjs.com/package/%40tanstack/react-form) | Adopted | Keep stable v1 for contract-backed commands. Test v2 behind an adapter in a separate issue after stable release and missing persistence/submit-intent needs are resolved. |
| nuqs | lock `2.10.1` | [nuqs documentation](https://nuqs.dev/docs) | Adopted | It owns shareable filter/sort/page/tab URL state. Review on App Router/typed-search integration change. |
| Zod public contracts | Web has Zod `4.5.4`; contracts currently expose one CJS root and ignored build output | [Zod basics](https://zod.dev/basics) | Required before production | Add browser-safe ESM resource subpaths, keep server/generator exports outside the client graph, and parse `unknown` at each API resource boundary. Clean dev/typecheck/build and bundle-graph evidence are required. Review on Zod major, module format or operation change. |
| React Compiler | plugin absent; approved exact `babel-plugin-react-compiler@1.0.0` | [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1), [Next config](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler) | Required before production | Start with `reactCompiler: { compilationMode: 'annotation' }` and zero opted-in source files. This is an inert policy boundary, not an optimization claim; the first `"use memo"` candidate requires behavior and comparative performance evidence before merge. |
| Command palette | current `kbar@0.1.0-beta.48` resolves a React-16/17-only `react-virtual` peer; `cmdk` is already present | [cmdk repository](https://github.com/pacocoursey/cmdk) | Required before production | Remove KBar rather than masking peers; preserve keyboard, navigation, theme-action and focus behavior on the existing Command primitive, then pass strict-peer frozen install. |
| Web interaction tests | no DOM harness; approved exact Testing Library `16.3.3`, user-event `14.6.6`, Happy DOM/global registrator `20.12.0` | [Testing Library setup](https://testing-library.com/docs/react-testing-library/setup/), [Happy DOM repository](https://github.com/capricorn86/happy-dom) | Required before production | Use a Web-local Bun preload for actual keyboard/focus/component behavior. Source-regex tests do not substitute for interaction tests. Review on Bun DOM compatibility or React major change. |
| Rust React Compiler | absent | [Next 16.3](https://nextjs.org/blog/next-16-3) | Deferred | `experimental.turbopackRustReactCompiler` remains experimental; reconsider only after stable Next support and parity evidence. |
| Cache Components | absent; current routes use dynamic/uncached patterns | [Cache Components](https://nextjs.org/docs/app/getting-started/partial-prerendering), [self-hosting](https://nextjs.org/docs/app/guides/self-hosting) | Deferred | Do not enable globally until route/Suspense, auth/cookies, tag invalidation and multi-instance cache coordination are audited. |
| Zustand | lock `5.0.15` | [Zustand documentation](https://zustand.docs.pmnd.rs/) | Adopted | Restrict it to proven deep client-owned editor state; never server facts, candidate authority or URL state. Review each new store. |
| shadcn/Base UI/Tailwind primitives | existing template stack | [shadcn components](https://ui.shadcn.com/docs/components), [Base UI](https://base-ui.com/react/overview/quick-start) | Adopted | Preserve semantic CSS tokens and composable primitives. Base Button owns design/accessibility/motion; capability actions own auth/logging/commands. |
| NestJS | exact runtime packages 12.0.0/12.0.1; no CLI/schematics | [Nest migration guide](https://docs.nestjs.com/migration-guide) | Adopted | Keep one runtime major, TypeScript 5.9.3 and compiled Node compatibility. Revisit CLI only in a compatible TypeScript lane. |
| Effect | exact `4.0.0-rc.112` | [Effect repository](https://github.com/Effect-TS/effect), [Effect runtime](https://effect.website/docs/runtime/) | Adopted | Use behind one Nest-owned `EffectRunner`; no request-scoped runtime or second global Layer container. Replace RC only through frozen compatibility gates. |
| Python | dataplane `>=3.12`; image digest pinned; CI selects 3.12 family | [Python status](https://devguide.python.org/versions/) | Required before production | Select exact CI interpreter evidence before production. Review on Python 3.12 support changes or image digest changes. |
| uv | CI 0.12.6, digest-pinned builder, frozen lock | [uv releases](https://github.com/astral-sh/uv/releases) | Adopted | Review whenever executable/action/image digest or lock format changes. |
| Pydantic / defusedxml / httpx | lock 2.13.5 / 0.7.1 / 0.28.1 | [Pydantic releases](https://github.com/pydantic/pydantic/releases), [Python XML security](https://docs.python.org/3.12/library/xml.html#xml-vulnerabilities), [httpx releases](https://github.com/encode/httpx/releases) | Adopted | Review on major/security advisory or source contract/transport behavior change. |
| pytest / Ruff / Pyright | lock 9.1.1 / 0.16.5 / 1.1.411 | [pytest releases](https://github.com/pytest-dev/pytest/releases), [Ruff releases](https://github.com/astral-sh/ruff/releases), [Pyright releases](https://github.com/microsoft/pyright/releases) | Adopted | Review on major upgrade, plugin incompatibility, or changed gate output. |

## Rejected or deferred

No second workspace package manager, universal client-side query layer, global server-state store,
persisted browser authority, business BFF Route Handler, capability-local duplicate API scaffold,
premature microfrontend, or separate design-system package is introduced. A top-level `api` directory
is adopted only as resource-oriented server-state modules; it may not become a dumping ground for UI,
authorization, toast policy, form orchestration, or business rules. Resource modules may not import one
another.

React Compiler does not justify removing explicit memoization blindly, and Cache Components is not a
config-only optimization. TanStack Form v2 alpha, the Rust React Compiler path, Immer, and es-toolkit
remain evidence-triggered rather than foundation defaults.

## Review triggers

Run a frozen install and the applicable generation/typecheck/lint/test/build chain whenever a package
manifest or lock changes. Open an ADR before changing the runtime family/pinning policy, Web import DAG,
server/client API-entry policy, global state ownership, hydration/cache policy, or introducing a product
Route Handler/BFF. Treat a security advisory, EOL notice, dependency-rule exception, new persistent browser
store, or reproducibility difference between CI and container execution as an immediate review trigger.
A committed pin is not production evidence until the protected-branch run and published digest/signature
verification are retained.
