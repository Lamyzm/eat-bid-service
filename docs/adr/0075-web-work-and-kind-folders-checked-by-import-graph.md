# 0075 — Web 단위 안은 일 폴더와 종류 폴더로 두고, 사사 파일·층 방향·순환을 import 그래프 검사기가 막는다

- Status: Accepted
- Date: 2026-11-18
- Supersedes: [ADR 0044](0044-route-segment-slice-structure.md)의 segment 안 배치(`_widgets/`·`_features/<name>/{ui,model,lib}`·`_lib/`)와
  결정 5(기존 화면은 건드리는 변경에서 옮긴다), [ADR 0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md) 결정 1의
  "ledger를 두지 않는다"를 이 ADR의 폴더 꼴·import 그래프 규칙에 한해서. 0044의 `entities` 층·승격 조건·`packages/domain` 소유와
  0042의 변경 범위 규칙·파일 머리 waiver는 그대로다.
- 관련 작업: #234, 온누리 출석부 저장소 ADR 0016(2026-11-06 "폴더 꼴"·2026-11-15 "폴더 안 종류 폴더" 개정)
- 승인: 사용자 결정(2026-11-17, "온누리의 폴더구조랑 hook 원칙같은거 전부 가져오고싶음", "해볼래")

## Context

온누리 ADR 0016은 eatbid ADR 0023·0044를 원형으로 출발해 두 걸음 더 갔다. 원칙을 검사기로 강제했고, 화면 안을
밖은 일·안은 종류(`components`·`hooks`·`remotes`·`utils`)로 바꿨다. eatbid는 같은 원칙을 문장으로만 두었다.

- ADR 0044의 `_features/<name>/{ui,model,lib}`는 한 겹 깊다. `/work`처럼 기능이 하나뿐인 화면도 `_features/pass-values/model/`
  세 겹을 만들었고, 파일 하나짜리 칸 폴더가 흔하다. 온누리는 같은 꼴을 2026-11-06에 걷었다(칸 폴더 151개 중 파일 하나짜리가 대부분).
- 0044 결정 5("건드리는 변경에서 옮긴다")는 걷을 화면에 맞지 않는다. `/today`·`/review`·`/setup`·`/floor`·`/auctions/[auctionId]`는
  교체 지도에서 지울 화면인데, 고치는 순간 옮기라고 하면 곧 지울 파일을 옮기는 일이 생긴다.
- 층 방향(ADR 0023 "실제 내부 의존 방향")·다른 화면 사사 파일 import·일 폴더 순환을 보는 기계 검사가 없다. 2026-11-18 이 ADR을
  쓰며 검사기를 돌리자 `capabilities/account`가 `shell`을 부르는 줄 6개, `entities/floor-line`이 `routing`을 부르는 줄 1개,
  `/floor`의 일 폴더 넷이 서로 부르는 순환 1개가 나왔다. 모두 ADR 0023 문장으로는 금지인데 아무도 몰랐다.

## Decision

### 1. 층 이름은 그대로 두고 온누리 층을 이렇게 대응한다

| 온누리 | eatbid | 까닭 |
|---|---|---|
| `app/<화면>/` | `app/<route>/` | 같다 |
| `domains/<d>/` | `entities/<e>/`(도메인 표시 조각)·`capabilities/<c>/`(독립 사용자 흐름) | eatbid는 "두 화면 이상이 쓴다"를 승격 조건이 다른 두 층으로 이미 나눴다 |
| `shared/` | `shared/` | 같다 |
| `shell/` | `shell/` | 같다 |
| `runtime/` | 없음 | 탭 수명 불변식을 지킬 상태가 아직 없다 |
| `server/<d>/`·`src/lib` | `api/<resource>/`·`api/_transport` | 서버 업무는 Nest가 갖고 Web은 계약 adapter만 둔다(ADR 0023) |

`domains` 하나로 합치지 않는다. 합치면 ADR 0023의 "여러 route에서 쓴다는 이유만으로 capability로 승격하지 않는다"가 무너지고,
`entities`·`capabilities`라는 이름을 쓰는 문서·검사기·AGENTS 전부를 바꿔야 하는데 얻는 것이 이름 하나다.

온누리의 도메인 순서(`DOMAIN_ORDER`)는 이렇게 옮긴다. **entity끼리는 서로 부르지 않는다**(순서 목록 없이 모든 entity가 한 계단 —
ADR 0023 문장을 `entity-cross-import`로 검사). capability끼리는 상대의 public `index.ts`만 부르고(기존 `capability-internal-import`)
순환하지 않는다(`slice-cycle`). 지금 entity 넷·capability 하나라 순서를 정할 edge가 없다. entity 사이 edge가 실제로 필요해지면 이
ADR을 고쳐 순서 목록을 먼저 둔다.

### 2. 화면 폴더 바로 아래는 Next 파일·로더와 밑줄 붙은 종류 폴더뿐이다

```
app/(workspace)/<화면>/
  page.tsx  loading.tsx  error.tsx  load-<화면>.ts  load-<화면>.test.ts
  __fixtures__/
  _components/  _hooks/  _remotes/  _utils/      ← 조립·틀·뼈대·여러 일이 같이 쓰는 것
  _<일>/
    components/  hooks/  remotes/  utils/        ← 파일 있는 종류만, 한 겹, 시험은 원본 곁
    __fixtures__/
entities/<e>/{components,hooks,remotes,utils}/
capabilities/<c>/
  index.ts  server.ts                            ← 공개 입구만 바로 아래(ADR 0023)
  components/  hooks/  remotes/  utils/
```

- 밑줄 없는 `components/`는 Next가 주소 조각으로 읽으므로 화면 바로 아래 종류 폴더에는 밑줄을 붙인다(Next "Private folders").
  일·entity·capability 안에서는 밑줄 없이 둔다.
- 일 폴더 `_<일>/`은 사람이 이름 붙이는 일 하나다. 일이 하나뿐인 화면도 일 폴더를 둔다(`/work`의 `_pass-values/`).
- 하위 route(`auctions/[auctionId]`)는 그 자체가 화면이라 같은 꼴을 따로 갖는다.
- `shared`·`shell`·`api`·`routing`은 이 꼴 밖이다. `shared/{ui,lib}`는 ADR 0023 그대로다(아래 미결).

### 3. 이름이 종류를 고른다

- `components/`: 그리기 `.tsx`, css, 높이 상수 `*.frame.ts`
- `hooks/`: 훅 `use-*.ts`, API를 부르지 않는 흐름 `*.model.ts`
- `remotes/`: 쿼리 옵션 `*-queries.ts`, `@/api/…`를 값으로 부르는 `*.model.ts`. 같은 endpoint의 adapter와 `queryOptions()`는 여전히
  `api/<resource>`가 한 번 소유하므로(ADR 0023) 화면 `remotes/`는 그것을 조합하는 자리일 뿐 fetcher를 복제하지 않는다.
- `utils/`: 나머지 `.ts` — `present-*.ts` 같은 표시 변환도 React를 모르면 여기다.
- 폴더와 이름이 어긋나면(`hooks/` 안의 셈 `.ts`, `components/` 안의 `use-*.ts`) 막는다. 시험은 원본 곁에 둔다.
- ADR 0044 결정 1의 칸 규칙은 새 이름으로 이어 간다. `utils/`는 React를 import하지 않고(`feature-lib-react`), `hooks/`·`remotes/`는
  JSX를 만들지 않으며(`feature-model-jsx`), `components/`에는 렌더링하지 않는 모듈을 두지 않는다(`ui-non-render-module`,
  `*.frame.ts`는 뺀다). 셋은 지금처럼 변경 범위 규칙이다.

### 4. import 그래프 검사

`pnpm lint:web-boundaries`(`tools/architecture/web-boundaries/`)가 production source의 import(type import·다시 내보내기 포함)로 판정한다.

| 규칙 | 막는 것 |
|---|---|
| `route-private` | 다른 화면의 사사 파일(사사 폴더 안 파일과 화면 바로 아래 Next 파일이 아닌 파일) import, 화면이 아닌 윗 route(layout만 있는 route group)의 사사 파일을 하위 화면이 부르는 것 |
| `layer-direction` | ADR 0023 의존 방향을 거스르는 층 사이 import. app은 모두, shell은 shared·routing, capabilities는 api·entities·shared·routing, entities는 shared, api는 shared, routing과 shared는 자기 층만 부른다. 이미 다른 규칙이 잡는 짝(shell→api·capabilities, routing→app)은 두 번 보고하지 않는다 |
| `entity-cross-import` | 서로 다른 entity 사이 import |
| `feature-cycle` | 한 화면의 일 폴더(`_<일>/`, 옛 `_features/<일>/`) 사이 순환 |
| `slice-cycle` | `capabilities/<c>`·`entities/<e>`·`shared/<칸>` 사이 순환 |
| `kind-folder` | 평평하게 둔 파일·ADR 0044 옛 꼴. 오류 문장이 파일마다 갈 자리를 말한다 |
| `kind-folder-mismatch` | 종류 폴더의 밑줄·겹·이름 어긋남 |

### 5. 옛 위반은 줄어들기만 하는 기준 목록에 싣는다

`tools/architecture/web-boundaries/folder-baseline.json`이 `kind-folder`·`route-private`·`layer-direction`·`entity-cross-import`·
`feature-cycle`·`slice-cycle`의 옛 위반을 규칙별 열쇠로 담는다. 열쇠는 파일 경로(`kind-folder`), `from -> to` edge, 순환 구성원이다.
`kind-folder-mismatch`는 새 꼴을 쓰기 시작한 자리의 실수라 목록에 올릴 수 없다.

변경 범위(ADR 0042 결정 4)를 쓰지 않는 까닭: 걷을 화면을 옮기지 않고 지우려면 그 파일을 고쳐도 판정이 바뀌지 않아야 한다.
파일 머리 waiver를 쓰지 않는 까닭: 크기 규칙 하나에만 허용된 장치이고, 200개 가까운 파일 머리를 고치면 그것이 곧 옮기는 비용이다.

ADR 0042가 ledger를 걷은 까닭(자기 상태를 모름, 내용 지문이 무관한 수정까지 잠금, 형식 넷)을 이 목록은 이렇게 피한다.

- 열쇠는 경로·edge라 위반과 무관한 수정은 목록을 흔들지 않는다.
- 목록에 있는데 더는 위반이 아닌 열쇠는 실패다. `pnpm lint:web-boundaries -- --prune-baseline`이 그것만 지운다. 목록에 새 열쇠를
  더하는 명령은 없다.
- 기준 commit(merge-base)의 목록에 없던 열쇠가 생기면 실패다. 손으로 늘린 목록은 CI에서 걸린다. 기준 commit에 목록 파일이 없으면
  첫 목록으로 본다.
- 형식과 검사기는 이 하나다. 의미 값·지역 어휘·한국어 주석 검사는 ADR 0042 그대로 목록 없이 판정한다.

첫 목록(2026-11-18)은 205개다. `kind-folder` 197(걷을 화면 `/auctions/[auctionId]` 61·`/floor` 37·`/today` 33·`/setup` 15·`/review` 9,
그 밖에 `entities` 16·`capabilities/account` 9·`/seats` 7·`/login` 6·`(workspace)` layout gate 2·`internal/cache/revalidate` 2),
`layer-direction` 7(`capabilities/account`→`shell` 6, `entities/floor-line`→`routing` 1), `feature-cycle` 1(`/floor`의 일 폴더 넷).

### 6. 옮기는 차례

- 걷을 화면(`/today`·`/review`·`/setup`·`/floor`·`/auctions/[auctionId]`)은 옮기지 않는다. 지우는 변경이 목록을 줄인다.
- `/work`(넣을 공고)를 첫 본보기로 옮겼다. 목록에 `/work` 열쇠는 0이다.
- 새 화면은 처음부터 이 꼴로만 짓는다. 남은 화면·entity·capability는 그 단위를 실질적으로 고치는 변경이 통째로 옮긴다. 반만 옮긴
  단위는 `kind-folder`가 남은 파일을 그대로 가리킨다.

## Consequences

- 한 일을 고칠 때 `_<일>/` 하나를 연다. 일이 하나뿐인 화면은 `_widgets/`·`_lib/`·`_features/<f>/<칸>/` 대신 `_components/`·`_<일>/<종류>/`
  두 겹으로 끝난다.
- 층 방향·사사 파일·순환이 문장이 아니라 merge gate다. 새 위반은 목록에 싣지 못하고 고쳐야 한다.
- 기준 목록이라는 두 번째 판정 방식이 생겼다. 변경 범위 규칙과 목록 규칙이 갈리는 기준은 "걷을 파일을 옮기지 않고 남길 수 있어야
  하는가"다.
- 루트 `AGENTS.md` 변경 절차의 "예외 ledger는 없고" 문장은 이 목록을 언급하지 않는다. 그 문장을 고치는 일은 이 ADR의 변경 범위
  (`apps/web`·`tools/architecture`·`docs`) 밖이라 후속으로 남긴다.

## 미결

- `shared`의 종류 폴더화(온누리 결정 7 — shadcn 바탕 부품만 `shared/ui/`에 평평하게, 나머지는 개념 폴더 `shared/<개념>/{components,hooks,utils}/`)는
  들이지 않았다. eatbid `shared`는 `ui`·`lib` 두 칸에 파일 50개 안팎이라 개념 폴더 문턱(같은 개념 셋 이상)을 넘는 묶음이 아직 없다.
- `capabilities/account`→`shell` 6줄은 계정 허브가 셸 chrome을 조립하는 현 구조에서 나왔다. capability를 고칠지 ADR 0023 방향표를
  고칠지는 계정 허브를 다시 그릴 때 정한다.

## Rejected alternatives

- **온누리 이름(`domains/`)으로 바꾼다.** 이득은 두 저장소 어휘가 같아지는 것이다. 비용은 ADR 0023 승격 조건 둘을 하나로 뭉개는 것과
  문서·검사기 전면 수정이다.
- **ADR 0044 결정 5(건드리는 변경에서 옮긴다)를 유지하고 변경 범위로만 판정한다.** 걷을 화면을 고치면 옮겨야 해 곧 지울 파일에 비용을 쓴다.
- **지금 모든 화면을 한꺼번에 옮긴다.** 파일 200개가 걷을 화면이 대부분이라 옮긴 직후 지우는 일이 된다.
- **화면 바로 아래를 평평하게 두고 종류 폴더를 허락만 한다**(온누리 2026-11-06 꼴). 온누리가 9일 만에 이 꼴을 걷고 종류 폴더를 모든
  단위에 두었다. 평평한 단위는 파일이 늘면 한눈에 안 들어오고 "허락"은 판단을 리뷰어마다 다르게 만든다.
