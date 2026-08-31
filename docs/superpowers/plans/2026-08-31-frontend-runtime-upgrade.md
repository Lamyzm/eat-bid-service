# 프론트엔드 런타임 업그레이드 구현 계획

> **에이전트 작업자 필수:** `superpowers:executing-plans` 스킬로 이 계획을 작업 단위로 구현한다.

**목표:** Web 런타임을 검토된 정확한 Next/React/TanStack/Tailwind 버전으로 옮기고 React 19와 호환되지
않는 command palette 의존성을 제거한다. 깨끗한 checkout에서도 type 생성이 결정적으로 동작하게 만들고,
무관한 실험 기능을 켜지 않은 채 기본적으로 비활성인 React Compiler 경계를 설치한다.

**아키텍처:** 현재 App Router 배포 단위를 유지하면서 하부 런타임을 교체한다. 저장소 검사가 정확한 Web
런타임 정책을 소유하고 `typedRoutes`와 annotation mode React Compiler를 명시적인 Next 최상위 option으로
관리한다. Cache Components, Rust compiler 경로와 TanStack Form v2는 비활성으로 유지한다.

**기술 스택:** Next.js 16.3.4, React/React DOM 19.2.8, TypeScript 5.9.3, TanStack Query 5.102.8,
TanStack Form 1.33.5, Tailwind CSS 4.3.3, Zod 4.5.4, React Compiler Babel plugin 1.0.0,
Bun test types 1.2.22, Testing Library 16.3.3/user-event 14.6.6, Happy DOM 20.12.0, pnpm 10.12.1.

**명세:** [프론트엔드 모듈 아키텍처 설계](../specs/2026-08-31-frontend-modular-architecture-design.md)

## 전역 제약

- 저장소 통합 순서상 이 runtime 작업을 canonical branch에 병합하기 전에 `main` PR gate와 ingestion spine
  hardening이 끝나야 한다. 격리된 EAT-9 worktree에서 준비할 수 있지만 선행 통합 작업을 우회하지 않는다.
- claim한 EAT-9 worktree에서만 작업하고 writing owner 한 명을 유지한다.
- 이 계획이 지정한 기반 의존성은 모두 exact version을 쓴다. Zod는 root catalog exact entry를 유지하고
  `pnpm-lock.yaml`은 pnpm으로만 갱신한다.
- `cacheComponents`, `experimental.turbopackRustReactCompiler`와 TanStack Form v2를 활성화하지 않는다.
- Sentry `reactComponentAnnotation`을 React Compiler annotation mode로 취급하지 않는다. 둘은 무관한 설정이다.
- 사람이 읽는 계획·문서·테스트명·커밋 메시지·이유 주석은 한국어로 작성한다.
- 현재 shell의 Node 24.2.0은 진단 전용이다. 최종 release 증거는 저장소 고정 Node 24.20.0을 요구한다.
- 기존 theme 동작과 application route를 보존한다. 제품 UI 재설계는 이 계획의 범위가 아니다.
- 끊긴 navigation의 목적지를 발명하지 않는다. 제품 기획이 실제 route를 만들 때까지 사용할 수 없는 action은
  제거하거나 노출하지 않는다.
- 각 작업에 명시된 검사가 통과한 뒤에만 작업 단위로 커밋한다.

---

## 작업 1: 런타임 목표를 기계적으로 강제한다

**대상 파일:**

- 생성: `tools/architecture/check-web-runtime.mjs`
- 생성: `tools/architecture/check-web-runtime.test.mjs`

- [ ] 최소 root/Web package와 config fixture를 만드는 한국어 이름의 실패 `node:test`를 작성하고 다음을 거부한다.
  - Next, React, React DOM, TypeScript, Query, Query Devtools, Form, Tailwind, Tailwind PostCSS, React Compiler,
    Bun types, Testing Library, user-event, Happy DOM, `server-only`, `@eatbid/contracts`가 exact가 아니거나 잘못된
    위치에 선언되면 거부한다.
  - root Zod catalog가 exact `4.5.4`가 아니거나 Web Zod 선언이 `catalog:`를 우회하면 거부한다.
  - Web manifest의 모든 `kbar` 선언을 거부한다.
  - `next typegen && tsc --noEmit` typecheck 명령이 없으면 거부한다.
  - 최상위 `typedRoutes: true`가 없으면 거부한다.
  - `compilationMode: 'annotation'` 없는 React Compiler 설정을 거부한다.
  - `cacheComponents` 또는 `experimental.turbopackRustReactCompiler` 활성화를 거부한다.
  - TanStack Form `2.x` 또는 prerelease range를 거부한다.
- [ ] `check-web-runtime.mjs`에서 `checkWebRuntime({ repositoryRoot })`를 export한다. CLI는 파일을 고치지 않고
  모든 위반을 출력한 뒤 0이 아닌 code로 종료한다.
- [ ] 작업 2와 3에서 실제 저장소를 green으로 만들기 전에는 root `architecture:check`에 이 검사를 연결하지
  않는다. 검사 자체 테스트는 따로 커밋할 수 있지만 필수 저장소 gate를 의도적으로 red인 채 커밋하지 않는다.
- [ ] 다음 집중 RED 명령을 실행하고 실패 출력을 보존한다.

```text
node --test tools/architecture/check-web-runtime.test.mjs
```

- [ ] 테스트가 통과할 때까지 fixture checker를 구현한다. 현재 package drift에 맞추려고 fixture를 약화하지 않는다.
- [ ] 커밋한다.

```text
test(architecture): Web 런타임 계약을 고정한다
```

## 작업 2: Web 의존성 버전을 올리고 호환되지 않는 KBar closure를 제거한다

**대상 파일:**

- 수정: `apps/web/package.json`
- 수정: `pnpm-lock.yaml`
- 생성: `apps/web/src/components/command-palette/command-palette.tsx`
- 생성: `apps/web/src/components/command-palette/command-palette.test.tsx`
- 생성: `apps/web/src/components/command-palette/context.tsx`
- 생성: `apps/web/src/components/command-palette/theme-actions.ts`
- 생성: `apps/web/bunfig.toml`
- 생성: `apps/web/test/setup-dom.ts`
- 수정: `apps/web/src/app/dashboard/layout.tsx`
- 수정: `apps/web/src/components/search-input.tsx`
- 삭제: `apps/web/src/components/kbar/index.tsx`
- 삭제: `apps/web/src/components/kbar/render-result.tsx`
- 삭제: `apps/web/src/components/kbar/result-item.tsx`
- 삭제: `apps/web/src/components/kbar/use-theme-switching.tsx`

- [ ] 현재 저장소에 runtime checker를 실행하고 예상된 RED 결과를 보존한다.
- [ ] Web manifest를 다음 exact 선언과 위치로 변경한다.
  - production dependency: `next: 16.3.4`, `react: 19.2.8`, `react-dom: 19.2.8`, `@tanstack/react-query: 5.102.8`, `@tanstack/react-query-devtools: 5.102.8`, `@tanstack/react-form: 1.33.5`, `zod: catalog:`, `server-only: 0.0.1`, `@eatbid/contracts: workspace:*`
  - development dependency: `typescript: 5.9.3`, `tailwindcss: 4.3.3`, `@tailwindcss/postcss: 4.3.3`, `babel-plugin-react-compiler: 1.0.0`, `@types/bun: 1.2.22`, `@testing-library/react: 16.3.3`, `@testing-library/user-event: 14.6.6`, `happy-dom: 20.12.0`, `@happy-dom/global-registrator: 20.12.0`
  - root catalog: exact `zod: 4.5.4`
- [ ] `kbar`를 제거한다. lock된 `react-virtual@2.10.4` closure는 React 16/17 peer만 선언하므로 React 19
  release candidate에 남길 수 없다. peer override로 숨기지 않는다.
- [ ] 이미 설치된 `cmdk`와 shared Command primitive로 기존 command palette를 다시 만든다. Cmd/Ctrl+K,
  keyboard selection, filtered navigation, theme action, focus restoration와 search trigger를 보존한다. 이는
  시각 재설계가 아니라 호환성 migration이다.
- [ ] Bun의 Web-local test preload에 Happy DOM과 Testing Library cleanup을 등록한다. preload가 결정적으로
  적용되도록 `apps/web` package directory에서 Web test를 실행하며 interaction assertion을 source regex로
  대체하지 않는다.
- [ ] 열기/닫기, keyboard selection, route 실행, theme action 실행과 trigger focus 복귀를 한국어 테스트로 검증한다.
- [ ] legacy page가 아직 import하므로 `@eatbid/shared`는 임시 유지한다. 제거는 이 upgrade가 아니라 slice
  retirement에서 수행한다.
- [ ] local과 CI gate가 같은 재현 가능한 entry를 쓰도록 Web `test` script를 `bun test src`로 추가한다.
- [ ] Web typecheck script를 `next typegen && tsc --noEmit`으로 교체하고 `@eatbid/domain`,
  `@eatbid/contracts`, `@eatbid/shared`를 dependency 순서로 build하는 `pretypecheck`를 추가한다.
- [ ] 깨끗한 checkout에서도 `pnpm --filter @eatbid/web build`가 동작하도록 같은 dependency build를
  `prebuild`에 추가한다.
- [ ] filtered Web startup을 위한 clean-checkout `predev` dependency build를 추가한다. 이는 bootstrap
  보장일 뿐이다. Web이 contract를 import하기 전에 아키텍처 계획의 contract export 작업에서 검증된
  source/watch 경로를 추가해 개발 정확성이 오래된 ignored `packages/contracts/dist`에 의존하지 않게 한다.
- [ ] lock은 다음 명령으로만 갱신한다.

```text
pnpm install --lockfile-only --strict-peer-dependencies
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm --filter @eatbid/web... install --frozen-lockfile --strict-peer-dependencies
```

- [ ] resolve된 최상위 버전을 검증한다.

```text
pnpm --filter @eatbid/web list --depth 0
pnpm why react-virtual
pnpm --filter @eatbid/web test
```

- [ ] 커밋한다.

```text
build(web): 검토된 런타임 버전을 고정한다
```

## 작업 3: 안정된 typed route와 통제된 compiler 설정을 활성화한다

**대상 파일:**

- 수정: `apps/web/next.config.ts`
- 수정: `tools/architecture/check-web-runtime.test.mjs`
- 수정: `package.json`

- [ ] Next React Compiler config와 Sentry component annotation을 구분하는 실패 repository fixture test를 추가한다.
- [ ] `baseConfig`에 다음 최상위 `NextConfig` field를 설정한다.

```ts
typedRoutes: true,
reactCompiler: {
  compilationMode: 'annotation'
}
```

- [ ] `cacheComponents`와 모든 Rust compiler option을 두지 않는다. Cache Components를 켜기 전에
  route/Suspense/auth/cache 조합을 감사해야 한다는 짧은 이유 주석을 추가한다.
- [ ] 기존 Sentry wrapper와 `webpack.reactComponentAnnotation` 설정은 변경하지 않는다.
- [ ] source tree에 아직 `"use memo"`/`"use no memo"` 후보가 없음을 확인한다. 따라서 annotation mode는
  최적화 성과 주장이 아니라 검토된 설정 경계다. 첫 opt-in component에는 별도 동작 테스트와 전후 성능
  증거가 필요하다.
- [ ] 실제 저장소가 checker를 통과한 뒤에만 `node tools/architecture/check-web-runtime.mjs`를 root
  `architecture:check`에 연결한다.
- [ ] 실행한다.

```text
node --test tools/architecture/check-web-runtime.test.mjs
node tools/architecture/check-web-runtime.mjs
```

- [ ] 커밋한다.

```text
build(web): typed route와 compiler annotation mode를 활성화한다
```

## 작업 4: cast 없이 기존 navigation이 typed route를 만족하게 한다

**대상 파일:**

- 수정: `apps/web/src/types/index.ts`
- 수정: `apps/web/src/config/nav-config.ts`
- 수정: `apps/web/src/components/command-palette/command-palette.tsx`
- 수정: `apps/web/src/components/layout/sidebar-account.tsx`
- 수정: `apps/web/src/app/dashboard/today/page.tsx`
- generated route type이 보고한 나머지 navigation caller도 수정한다. 편집 전에 전체 목록을 기록한다.

- [ ] `pnpm --filter @eatbid/web typecheck`를 실행하고 첫 diagnostic만이 아니라 typed route 실패 전체를 보존한다.
- [ ] Next generated `Route` type을 import하고 내부 navigation URL을 `Route | '#'`로 정의한다. 외부 URL은
  명시적인 anchor 전용 type으로 유지한다.
- [ ] command palette navigation action을 `Route`로 type 지정하고 `router.push` 전 `'#'`을 좁힌다.
- [ ] 실제 route가 없고 제품 navigation도 승인하지 않은 `/dashboard/notifications` action을 제거한다.
  placeholder page나 조용한 redirect를 만들지 않는다.
- [ ] Today 분석 링크 같은 조합형 dynamic URL을 `URLSearchParams`와 generated route 호환 template literal로
  다시 작성하며 기존 목적지와 query 값을 보존한다.
- [ ] `as Route`, `as any` 또는 route prop을 다시 `string`으로 넓혀 오류를 숨기지 않는다.
- [ ] 실행한다.

```text
pnpm --filter @eatbid/web typecheck
pnpm --dir apps/web exec oxlint src/types/index.ts src/config/nav-config.ts src/components/command-palette src/components/layout/sidebar-account.tsx src/app/dashboard/today/page.tsx --deny-warnings
```

- [ ] 커밋한다.

```text
refactor(web): navigation route type을 안전하게 만든다
```

## 작업 5: 런타임 업그레이드를 증명하고 고정 런타임에서만 승격한다

**대상 파일:**

- 증거가 바뀐 경우에만 수정: `docs/architecture/stack/application-runtime.md`
- 명령이 바뀐 경우에만 수정: `apps/web/AGENTS.md`

- [ ] 다음 순서로 전체 집중 검증을 실행한다.

```text
node tools/architecture/check-stack-docs.mjs
node tools/architecture/check-web-runtime.mjs
node --test tools/architecture/check-stack-docs.test.mjs tools/architecture/check-web-runtime.test.mjs
pnpm architecture:check
pnpm --filter @eatbid/web test
pnpm --filter @eatbid/web typecheck
pnpm --dir apps/web exec oxlint next.config.ts src/types/index.ts src/config/nav-config.ts src/components/command-palette src/components/layout/sidebar-account.tsx src/app/dashboard/today/page.tsx --deny-warnings
pnpm --filter @eatbid/web build
pnpm --filter @eatbid/web... install --frozen-lockfile --strict-peer-dependencies
git diff --check
```

- [ ] build log가 Next 16.3.4를 사용하고 Cache Components나 Rust compiler 경로가 활성화됐다고 보고하지
  않는지 확인한다.
- [ ] production build를 시작하고 `/welcome`, `/dashboard/today`로 직접 hard navigation한다. document response,
  hydration, command palette keyboard 동작, theme 유지, browser back/forward와 browser/server console 무오류를 검증한다.
- [ ] annotation mode를 opt-in한 source 후보가 없음을 확인하고 compiler 동작이나 성능을 주장하지 않는다.
  향후 `"use memo"`를 처음 넣기 전에 해당 후보의 동작 regression test와 전후 성능 증거를 요구한다.
- [ ] Node 24.2.0 결과는 source 진단으로만 취급한다. release candidate로 부르기 전에 저장소 고정 Node
  24.20.0에서 같은 frozen install, test, typecheck, build, hard navigation 검증이 local 또는 CI에서 통과해야 한다.
- [ ] frozen lock이 다른 resolved fact를 증명할 때만 runtime 문서를 갱신한다.
- [ ] 커밋한다.

```text
docs(web): 런타임 업그레이드 증거를 기록한다
```
