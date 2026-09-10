# 0047 — 상대 경로 import 깊이를 한 단계로 제한하고 별칭은 각 패키지의 해석기만 쓴다

- Status: Accepted
- Date: 2026-09-11
- Supersedes: 없음
- 관련 작업: EAT-177, [ADR 0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md)(변경 범위 검사),
  [ADR 0044](0044-route-segment-slice-structure.md)(route segment 슬라이스), AGENTS 11·18

## Context

깊은 상대 경로 import는 두 가지를 깨뜨린다. 파일을 옮기는 순간 그 파일이 참조하던 경로가 전부 틀어지고,
읽는 사람은 `../../../_lib/bid-rate`가 어느 계층을 가리키는지 `/`를 세어 봐야 안다. 저장소는 이미 계층
경계를 검사로 강제하는데(`web-boundaries`, `server-boundaries`) 그 경계를 넘는 **경로 표기**는 자유롭다.

2026-09-11 `origin/main`을 TypeScript AST로 세어 실제 module specifier만 집계했다. 문자열 리터럴이나
`new URL("../../", import.meta.url)` 같은 파일 경로 계산은 import가 아니므로 제외한 수다.

| 경로 | `../../` 이상 |
| -- | -- |
| `apps/server` | 234 |
| `packages/contracts` | 164 |
| `apps/web` | 89 |
| `docs/product/prototypes` | 3 |
| `packages/db` | 1 |
| `packages/domain` | **0** |
| `tools` | **0** |

합계 491곳이며 한 번에 고칠 크기가 아니다. 그런데 `packages/domain`과 `tools`가 0이다. 규칙이 실현
가능하다는 증거이자, 어떻게 0이 되는지가 이 결정의 출발점이다.

### `packages/domain`이 0인 이유는 별칭이 아니라 구조다

`packages/domain/src`는 최대 2단계다. `src/{geo,identity,numeric,time}/<파일>.ts`뿐이고 그 아래로 더
내려가지 않는다. 어떤 파일에서 어떤 이웃 영역에 닿아도 `../numeric/rates.js` 한 단계면 끝난다. 별칭이
없어서 0인 것이 아니라 **깊이가 없어서** 0이다. `tools`도 `tools/<영역>/<파일>.mjs` 2단계라 같다.

이 방식은 파일 수가 적을 때 성립한다. `packages/domain`은 production 모듈 11개다. `apps/server`는
ADR 0045가 정한 `modules/<이름>/{domain,application,infrastructure,presentation}/…` 구조라 층을 가로지르는
참조가 본질적으로 3단계 이상이며, 그 234곳을 평평하게 만드는 것은 모듈 경계를 지우는 것과 같다.

### 별칭을 오늘 쓸 수 있는 패키지는 `apps/web`뿐이다

| 패키지 | module | moduleResolution | 별칭 |
| -- | -- | -- | -- |
| `apps/web` | esnext | bundler | `@/*` → `./src/*` |
| `apps/server` | commonjs | node | 없음 |
| `packages/contracts` | commonjs | node | 없음 |
| `packages/db`·`packages/domain` | NodeNext | NodeNext | 없음 |

`tsc`는 `paths`를 출력물에 다시 쓰지 않는다. `apps/server`에 `"@/*"`를 넣고 컴파일하면 emit된 CommonJS에
`require("@/foo")`가 그대로 남아 Node가 죽는다. `apps/server/tsconfig.build.json`에 이미 있는 `effect` paths
항목은 `.d.ts`만 가리키는 **타입 전용** 매핑이라 런타임 해석과 무관하며, 이것이 소스 별칭이 아니라는 점이
오히려 위 사실을 보여 준다. `moduleResolution: "node"`(Node10)는 package.json의 `imports`·`exports`도 읽지
못하므로 `#foo/*` subpath도 그대로는 안 된다.

**그래서 검사보다 별칭 해석 방식이 먼저다.** 검사를 먼저 켜고 별칭을 쓰라고 하면 런타임이 깨진 코드가
게이트를 통과한다.

### `moduleResolution` 상향의 실제 비용을 쟀다

추정 대신 재기 위해 `module`·`moduleResolution`만 `node16`으로 바꾼 probe tsconfig로 typecheck를 돌렸다
(2026-09-11, 다른 설정은 각 패키지의 실제 빌드 구성 그대로).

| 대상 | 현재 | `node16` | 지배적 오류 |
| -- | -- | -- | -- |
| `apps/server` (`tsconfig.build.json`) | 오류 0 | 오류 **105** | TS1479 80, TS1541 25 |
| `packages/contracts` (`tsconfig.json`) | 오류 0 | 오류 **319** | TS2835 263, TS2307 44, TS2834 6 |

두 패키지의 실패 이유가 서로 다르다.

- `apps/server`의 105개는 **전부 module format 충돌**이다. TS1479는 "CommonJS 파일은 ESM을 `require`할 수
  없다"이며 대상은 `@nestjs/common` 30, `@eatbid/domain` 18, `effect` 11, `@nestjs/swagger` 10, `@nestjs/core` 3,
  `@eatbid/db` 2, `better-auth` 계열 4 등 **의존성 표면 전체**다. TS1541은 그 type-only 형태다. 확장자를
  붙이라는 오류(TS2835)는 production 빌드 대상에 **0개**다. 즉 `apps/server`의 비용은 확장자가 아니라
  "`apps/server`를 ESM으로 전환한다"이고, 그것은 Nest 12 decorator·`emitDecoratorMetadata` 런타임과 bun 테스트
  레인을 같은 변경에서 함께 검증해야 하는 별도 작업이다.
- `packages/contracts`의 319개 중 263개가 TS2835 확장자다. `packages/contracts/src/package.json`이
  `{"type":"module"}`을 선언해 `src`는 ESM인데 패키지 자신은 `"type":"commonjs"`이고 `dist`는 CJS로 나가는
  **이중 형식**이기 때문이다. 상향하려면 이 이중 형식을 먼저 정리하고 263곳에 `.js`를 붙여야 한다.

## Decision

### 1. 상대 경로 import는 `../` 한 단계까지만 허용한다

`./foo`와 `../foo`는 허용하고 `../../foo`부터 막는다. 같은 폴더와 바로 위 폴더는 함께 바뀌는 응집된
이웃이라 별칭이 오히려 읽기를 해친다. 판정 대상은 `import`·`export … from`·동적 `import()`·`require()`·
`import type`의 module specifier이며, 문자열 리터럴과 `new URL(…, import.meta.url)` 같은 파일 경로 계산은
import가 아니므로 보지 않는다.

### 2. 별칭 해석기를 새로 만들지 않는다. 각 패키지의 module 체계가 이미 소유한 것만 쓴다

- `apps/web/src`: Next와 Turbopack이 소유하는 기존 `@/*`를 쓴다. 이미 동작하며 런타임 위험이 없다.
  `apps/web` 안에서도 `src` 밖(`e2e/`, `scripts/`)은 Playwright·bun이 각자 해석하고 `@/` 사용 실적이 0이라
  별칭이 보장되지 않으므로 대상에서 뺀다.
- `packages/domain`·`packages/db`·`tools`: 별칭을 **도입하지 않는다**. 위반이 0·1·0곳이고 세 곳 모두 2단계
  구조라 `packages/domain`이 증명한 방식(구조)으로 충분하다. 쓰지 않을 해석 계층을 미리 만들지 않는다.
- `apps/server`·`packages/contracts`: 오늘 해석기가 없으므로 **검사 대상에서 뺀다**. 뺀 사실과 편입 조건은
  검사 코드의 `EXCLUDED_SCOPES`에 이유와 함께 남긴다. 조용히 빼면 다음 사람이 검사가 전부를 본다고 믿는다.

### 3. 편입 조건은 module format 정리이지 별칭 도입이 아니다

목표는 Node 표준 subpath `imports`(`#…`)다. 런타임 의존도 빌드 재작성도 없이 Node와 `tsc`가 같은 규칙으로
해석하기 때문이다. 다만 그 전제는 `moduleResolution` 상향이고, 위 측정이 보여 주듯 상향의 실제 비용은
module format이다. 그래서 편입 조건을 별칭이 아니라 format으로 적는다.

- `apps/server`: ESM 전환이 끝나 `module: "node16"` 아래 `tsconfig.build.json` typecheck가 오류 0이 될 것.
- `packages/contracts`: `src/package.json`의 `{"type":"module"}`과 CJS `dist`가 공존하는 이중 형식을 정리하고
  상대 import에 확장자를 붙이는 작업이 끝날 것.
- 두 조건 중 하나가 충족되면 그 패키지를 `check-import-depth.mjs`의 `TARGET_SCOPES`로 옮기고, 그때 `#…`
  subpath를 도입할지 구조로 해결할지는 그 작업에서 정한다. 이 ADR은 문을 열어 둘 뿐 미리 고르지 않는다.

### 4. 검사는 변경 범위에서만 판정하고 baseline ledger를 만들지 않는다

ADR 0042의 changed-scope 모델을 그대로 쓴다. merge-base(main) 대비 신규·수정된 파일만 보므로 기존 491곳을
지금 고치라고 요구하지 않고, 손대는 파일은 규칙을 지킨다. 예외 목록은 만들지 않는다 — 변경 범위 판정이
그 역할을 대신하며, 이것이 ADR 0042가 ledger 넷을 철거한 이유와 같은 이유다.

검사는 `tools/architecture/check-import-depth.mjs`이고 `run-checks.mjs`의 검사 목록에 `import-depth`로
등록한다. 새 lint 도구나 새 실행 경로를 만들지 않는다.

## Consequences

- 대상 패키지(`apps/web/src`, `packages/db/src`, `packages/domain/src`, `tools`)에서 파일을 옮겨도 그 파일의
  import가 깨지지 않는다. `apps/web`은 89곳 중 이 작업에서 고칠 수 있는 곳을 `@/`로 바꿨고, 남은 곳은
  다른 issue가 소유한 경로다(EAT-176 `_features/flow/**`).
- `apps/server`와 `packages/contracts`의 398곳은 그대로 남는다. 검사가 이 두 패키지를 보지 않는다는 사실이
  검사 코드와 이 ADR 두 곳에 적혀 있으므로 "검사가 전부를 본다"는 오해가 생기지 않는다.
- 상향 비용이 숫자로 남았다. 다음 사람은 `apps/server` 105·`packages/contracts` 319라는 측정치와 그 원인
  (format 충돌 / 이중 형식)에서 시작하며, 같은 probe를 다시 만들 필요가 없다.
- `apps/web`의 segment 내부 import가 `@/app/(workspace)/auctions/[auctionId]/_lib/…`처럼 길어진다. 짧은
  상대 경로보다 타이핑이 길지만 어느 층인지 세지 않아도 되고 파일 이동에 견딘다. 대신 `../` 한 단계는
  계속 허용하므로 같은 슬라이스 안(`ui` → `model`)의 이웃 참조는 짧게 남는다.
- 검사가 늘어 `run-checks.mjs`의 검사 선택 테스트가 함께 바뀐다. 새 검사를 추가할 때마다 치러야 하는
  비용이며 `pnpm test:quality`가 그것을 드러낸다.

## Rejected alternatives

- **런타임 resolver(`tsconfig-paths` 류)**: `apps/server`에 production 의존과 부팅 hook이 늘어난다. 진입점이
  `main.js`, bun 테스트, `openapi:generate`, `dev-login-seed`, `compatibility-probe`로 여럿이라 하나라도 hook을
  빠뜨리면 그 경로만 런타임에 죽는다. 게이트가 통과시킨 코드가 운영에서 깨지는 형태이며, 측정된 병목
  없이 계층을 더하지 말라는 AGENTS 11에 반한다.
- **빌드 단계 재작성(`tsc-alias` 류)**: 빌드 단계가 하나 늘고 `dist`가 소스와 1:1이 아니게 되어 생성물
  신뢰가 한 겹 얇아진다. 결정적으로 `packages/contracts`의 `exports`는 `bun` 조건에서 `./src/*.ts`를 직접
  내보내고 `apps/server` 테스트는 그 경로로 bun이 소스를 실행한다. 재작성은 `dist`에만 적용되므로 이
  레인에는 결국 런타임 resolver가 또 필요하다. 메커니즘 둘이 공존한다.
- **지금 `moduleResolution`을 `node16`으로 올린다**: 방향은 옳지만 측정 결과 `apps/server` 105·
  `packages/contracts` 319개 오류가 나며 원인이 확장자가 아니라 module format이다. 이 작업의 non-goal이고,
  결정 3이 조건으로 남겨 두었다.
- **`apps/web`에 segment 전용 별칭(`@decision/*` 같은 것)을 추가한다**: 경로가 짧아지지만 별칭 어휘가
  둘로 늘고, `check-web-boundaries`의 program 옵션이 `paths: { "@/*": ["*"] }` 하나만 알아 새 별칭으로 쓴
  import를 해석하지 못한다. 경계 검사가 조용히 눈이 머는 대가는 짧은 경로보다 비싸다.
- **구조 변경만으로 전부 해결한다(`packages/domain` 방식의 전면 적용)**: `packages/db`·`tools`에는 그대로
  적용했지만 `apps/server` 234곳에는 성립하지 않는다. ADR 0045의 모듈 층을 가로지르는 참조는 본질적으로
  3단계 이상이고, 깊이를 없애려면 층을 없애야 한다.
- **기존 491곳을 baseline 예외 목록으로 얼린다**: AGENTS가 금지하고 ADR 0042가 같은 이유로 ledger 넷을
  철거했다. 목록은 stale을 스스로 알지 못하고 파일이 옮겨지면 무의미해진다.
