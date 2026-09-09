# 0042 — legacy ledger 철거와 변경 범위 검사

- Status: Accepted
- Date: 2026-09-10
- Supersedes: [ADR 0020](0020-semantic-values-temporal-zod-contracts.md) §시간의 "정적 예외 ledger"와
  §강제와 전환의 "exact occurrence ledger" 조항(0021이 이어받은 부분), [ADR 0023](0023-nextjs-web-modular-boundaries.md)
  Consequences의 legacy 공존을 삭제 전용 baseline으로 운영하던 규칙, [ADR 0035](0035-administrative-region-canonical-and-mapping.md)
  확정 근거의 "ledger는 비어 있다"는 운영 방식. 세 ADR의 나머지 결정은 그대로다.
- 관련 작업: EAT-121

## Context

저장소에는 "삭제 전용" legacy baseline ledger가 넷 있었다. 한국어 module 책임 주석(파일 바이트 sha256,
기준 commit `e7fdcd2` 바이트 동일성, 123개), Web boundary(AST node sha256과 reason/owner/splitTrigger, 17개),
의미 값(0개), 지역 어휘(0개)다. 네 ledger는 다음 문제를 공유했다.

- ledger가 자기 상태를 모른다. 파일이 삭제돼도 항목이 남고 어떤 검사도 stale을 실패로 보고하지 않아,
  2026-09-09 하루에 stale 항목 123+155+86개를 손으로 걷어냈다.
- 형식 넷, 검사기 넷, drift 정의 넷이 같은 파일을 서로 다르게 다뤘다. `components/ui/sidebar.tsx`를 한국어
  ledger는 "고치면 주석을 달아라", boundary ledger는 "고치지 마라"라고 말했다.
- 위치·크기 규칙(`legacy-*-directory`, `source-file-size`)이 파일 내용 전체 지문을 잠가 위반과 무관한 한 줄
  수정도 drift로 막혔다. vendored shadcn `sidebar.tsx`가 그 상태였고 `use-mobile`·`lib/utils`·
  `application-shell`의 항목까지 붙잡았다.
- `architecture:check`가 13개 스크립트를 `&&`로 직렬 실행해 node·uv·bun 프로세스를 매번 새로 띄우며
  순차 47초가 걸렸고, 변경 범위만 보는 모드가 없어 커밋 시점에는 메시지 언어만 검사했다.

grandfathering이 필요했던 큰 legacy 표면은 EAT-119에서 대부분 사라졌다(web-boundary 172→17,
semantic-value 123→0). 얼릴 대상이 없는데 얼음틀만 남았다.

## Decision

### 1. ledger 파일과 baseline 처리 코드를 삭제한다

`tools/quality/korean-comment-legacy-baseline.json`, `tools/architecture/web-boundary-legacy-baseline.json`,
`semantic-value-legacy-baseline.json`, `region-vocabulary-legacy-baseline.json`과 그것을 읽고 대조하고
`--write-baseline`으로 쓰던 코드를 모두 없앤다. 의미 값 검사와 지역 어휘 검사는 `apps/web`을 포함한
governed source 전체에 예외 없이(zero tolerance) 적용한다. 코드에 남는 예외는 exact 경로·선언으로 이름이
있는 것(`AuctionRow`·`postgresInstant`·`systemClock`)뿐이다. Web boundary의 `client-domain-calculation` 규칙은
대상 파일 목록(`lib/band.ts` 등)이 전부 삭제돼 주어가 없어졌으므로 규칙과 목록을 함께 없앤다. 그 파일이
되돌아오면 `legacy-lib-directory`가 변경 범위 규칙으로 막는다.

### 2. "변경 범위"의 정의는 한 모듈이 소유한다

`tools/git/changed-paths.mjs`가 기준 commit과 변경 경로 집합을 정하고 모든 검사기와 드라이버가 이것을 쓴다.

- 기준 결정: 명시한 `--base <ref>`(또는 드라이버가 넘긴 env)가 있으면 그것과 HEAD의 merge-base다. 없으면
  `main`, `origin/main` 순서로 HEAD와 **다른** merge-base를 먼저 취한다. 두 후보가 모두 HEAD와 같으면
  (main 자체이거나 branch에 아직 commit이 없는 경우) HEAD가 기준이며 작업 트리 변경만 범위가 된다. 이 순서
  덕에 main에서 push 전에는 `origin/main` 이후 commit이 범위가 되고, CI의 main push에서는 범위가 비어
  이미 검사된 것을 다시 묻지 않는다.
- 변경 경로: `git diff --name-only --diff-filter=ACMR <기준>`(작업 트리 기준이라 staged·unstaged 모두 포함)과
  `git ls-files --others --exclude-standard`의 합집합 중 지금 존재하는 파일이다.
- 명시한 base가 해석되지 않으면 설정 오류이므로 실패한다. CI는 `pnpm architecture:check -- --base origin/main`
  으로 base를 명시해 잘못된 checkout이 조용히 통과하지 못하게 하고, 그래서 `fetch-depth: 0`을 유지한다.
- 후보 branch가 하나도 없어 기준을 못 찾은 경우(unresolved)는 실패도 통과도 아닌 **판정 불가**다.
  실패로 만들면 shallow clone·source archive에서 gate가 자기 자신을 막고, 조용히 통과시키면 약해진 사실이
  숨는다. 그래서 변경 범위에 관한 규칙만 경고로 강등해 exit 0으로 끝내고, 예외 없는 규칙은 그대로
  판정한다. 실패 판정을 원하면 `--base`를 명시한다.

### 3. 한국어 module 책임 주석은 변경 범위 검사다

규칙 23은 신규·실질 변경 모듈에만 설명을 요구하므로 `check-korean-comments.mjs`는 변경 경로 안의
production 모듈만 검사한다. 건드리지 않은 기존 모듈은 묻지 않고, 수정하는 순간 설명을 넣어야 한다.
기준 미정이면 전체를 검사하되 결과를 경고로 낮추고, `--all`은 전체를 실패 판정하는 감사 모드다. Python
파일의 판정은 기존처럼 `check-python-korean-comments.py`가 파일 단위로 맡고 범위는 JS 쪽이 정한다.
규칙 23의 예외(테스트·fixture·생성물·순수 barrel·선언형 config/schema)는 그대로다.

### 4. Web boundary는 변경 범위 규칙과 파일 안 waiver로 나뉜다

- `legacy-import`, `legacy-hooks-directory`, `legacy-lib-directory`는 "새 파일을 받지 않고 새 edge를 만들지
  않는다"는 규칙이므로 변경된 파일에서만 판정한다. 나머지 규칙은 파일이 언제 생겼든 예외 없이 판정한다.
- `source-file-size`는 파일 머리 주석의 waiver 한 줄로만 면제한다.

  ```text
  // @boundary-waiver source-file-size owner=EAT-121 reason="…한국어 이유…" splitTrigger="…한국어 분리 조건…"
  ```

  waiver는 shebang·빈 줄·주석·directive만 이어지는 파일 머리에만 둘 수 있고, `owner`·`reason`·`splitTrigger`가
  모두 있어야 한다. owner는 `EAT-N` 형식의 Linear issue 식별자이고(AGENTS 20의 소유권 단위) reason과
  splitTrigger는 한국어 문장이다. 면제 대상 finding이 없는 waiver는 stale로
  실패한다(파일이 300줄 이하로 돌아오면 지운다). 다른 규칙의 waiver는 실패다. 근거는 AGENTS 18과
  `apps/web/AGENTS.md`의 "명시적 waiver" 문장이며, 이 결정에서 `components/ui/sidebar.tsx`에 "vendored shadcn
  sidebar는 upstream과 diff를 맞추는 재vendoring 단위라 한 파일로 유지한다"는 waiver를 달았다.
- 남은 17개 legacy finding(`shell/layout/application-shell.tsx` 4, `shell/theme/theme-mode-toggle.tsx` 4,
  `shell/theme/theme-selector.tsx` 4, `hooks/use-breadcrumbs.tsx`·`use-mobile.ts`·`use-nav.ts` 3, `lib/utils.ts` 1)은
  건드리지 않으면 보고되지 않고 건드리면 그 변경에서 해결한다. `sidebar.tsx`는 waiver 1개다.

### 5. `architecture:check`는 단일 Node 드라이버다

`tools/architecture/run-checks.mjs`가 검사 목록·변경 범위 선택·병렬 실행·종합 판정을 소유한다.

- JS 검사는 같은 프로세스의 `worker_threads`로, uv·bun이 필요한 단계는 child process로 병렬 실행하고
  출력과 종료 코드를 검사별로 모아 끝나는 순서대로 보고한다. 무거운 검사부터 시작한다.
- `--changed`는 변경 경로에 scope가 닿는 검사만 고른다. 검사 도구·루트 manifest·lockfile이 바뀌면 전부
  고른다. 변경 경로 목록은 env(`EATBID_CHANGED_PATHS`)로 검사기에 넘겨 같은 범위를 두 번 계산하지 않으며,
  규칙에 예외가 없는 `semantic-values`·`test-names`도 이 목록으로 program root를 좁혀 시간을 줄인다
  (portable registry는 graph 검사 진입점이라 항상 포함).
- `--base`, `--only`, `--list`, `--jobs`를 둔다. `quality:check`는 같은 드라이버의
  `--only test-names,korean-comments`다.
- `.githooks/pre-commit`이 `run-checks.mjs --changed`를 실행한다. main pre-push와 CI는 전체 모드다.
  `--no-verify`로 건너뛴 커밋은 pre-push와 CI에서 같은 판정을 받는다.

### 6. 검사 대상은 작업 트리다

pre-commit의 검사는 index가 아니라 작업 트리를 본다. 일부만 staging한 커밋은 unstaged 변경까지 검사하므로
실제 커밋보다 넓게 판정할 수 있지만 좁게 판정하지는 않는다.

## Consequences

- 네 ledger JSON과 그 검사 코드가 사라지고 형식·검사기·drift 정의가 하나(변경 범위)로 줄었다. stale 상태는
  변경 범위에서는 자동으로 사라지고 waiver는 stale이면 실패한다.
- 2026-09-10 이 worktree의 실측: 직렬 `architecture:check` 46.8초 → 드라이버 전체 병렬 실행은 가장 긴
  검사(Web boundary program 생성, 단독 6.2초) 정도로 끝나며, 검사 도구 변경으로 13개 전부를 고른
  `--changed`도 다른 부하가 있는 상태에서 11.3초였다. 한 파일 수정의 전형적인 pre-commit은 그보다 짧다.
- Web boundary finding에서 `sha256` 지문이 사라지고 `rule`·`path`·`kind`·`reason`(·`members`)만 남는다.
- 건드리지 않은 legacy 16개 finding은 계속 존재한다. PR evidence에는 "변경 범위 밖 legacy finding N개 생략,
  waiver M개"가 함께 찍히므로 잔존 부채가 숨지 않는다.
- 기준을 못 찾는 환경에서는 변경 범위 규칙이 경고로 내려간다. CI는 `--base origin/main`을 명시해 그
  강등이 CI에서는 일어나지 않게 했다.

## Rejected alternatives

- ledger에 stale 검출만 추가: 형식 넷·검사기 넷을 계속 유지해야 하고 `sidebar.tsx` 같은 충돌은 남는다.
- 전체 파일 zero tolerance로 전환(한국어 주석 123개를 즉시 채우기): 규칙 23은 신규·실질 변경 모듈에 관한
  규칙이라 건드리지 않은 파일에 주석을 채우는 것은 "주석 수를 채우기 위한 설명"에 가깝다.
- waiver를 별도 JSON 목록으로: 파일 밖 목록은 다시 ledger가 되고 파일이 옮겨지면 stale이 된다.
- 기준 미정을 실패로: shallow clone·archive에서 gate가 자기 자신을 막는다. 대신 CI는 base를 명시한다.
- `--changed`를 `git diff --cached`(index) 기준으로: 부분 staging에서 좁게 판정할 수 있고, 검사기가 index
  내용을 읽으려면 파일 대신 blob을 읽어야 해 모든 검사기가 바뀐다.
- 병렬화를 turbo나 별도 task runner에 위임: 검사 목록이 여러 package.json에 흩어지고 변경 범위 선택을
  넣을 자리가 없다.
