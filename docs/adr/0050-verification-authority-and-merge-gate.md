# 0050 — 검증 권위와 병합 게이트

- Status: Accepted
- Date: 2026-09-12
- Supersedes: [ADR 0024](0024-free-github-tag-gated-publication.md)의 "GitHub Free에서는 branch protection과 ruleset을 쓸 수 없다"는 전제와 그로부터 나온 권한 근거. 태그가 prod publication을 시작하는 유일한 canonical ref라는 결론은 유지하며 이유만 바꾼다.
- 관련 작업: EAT-191 공개 전환, EAT-143 build 누락, 2026-09-11 main red

## Context

검증이 세 곳에서 따로 판정하고 셋 다 "통과"라고 말한다. 범위는 서로 다르다.

| 자리 | 무엇을 보는가 | 걸리는 시간 |
|---|---|---|
| 커밋 훅 | 변경 경로에 해당하는 아키텍처 검사 | 초 |
| 로컬 push 게이트(main) | 아키텍처 전체, TypeScript 테스트, 빌드 | 12분 |
| CI | 위 전부 + dataplane lint·typecheck·test + Playwright 여섯 | 15분 |

2026-09-11에 로컬 게이트가 초록인 채로 main이 빨갛게 들어갔다. 결함은 둘이고 **둘 다 게이트에 없는
검사가 잡았다.** ruff import 정렬은 `dataplane:lint`가, 서버 응답이 공개 계약의 `eligibilityAreas`를
빠뜨린 것은 Playwright가 잡았다. 마침 GitHub Actions가 결제 한도로 멈춰 있어서 11시간 동안 아무도 몰랐다.

전례가 있다. EAT-143에서 `build`가 게이트에 없어 main이 14시간 red였고 그 사이 병합이 열세 번 있었다.
그때 구멍 하나를 막았는데, 지금 세어 보니 넷이 남아 있었다. 구멍을 하나씩 발견해서 막는 방식은 이미
두 번 실패했다.

같은 날 저장소를 공개로 바꿨다(EAT-191). ADR 0024는 `403`을 직접 받아 보고 "현재 플랜에서 사용할 수
없는 기능"이라고 적었다. 그 조건이 사라졌다. 공개 저장소는 ruleset과 required check를 서버가 강제한다.

마지막으로 [ADR 0051](0051-dev-overlay-and-unsigned-main-image-lane.md)의 dev 레인은 "dev가 main을
따라간다"를 전제로 한다. main이 조용히 빨갈 수 있는 동안 그 레인은 깨진 코드를 더 빨리 배포하는 장치다.

## Decision

1. **`main`은 서버가 보호한다.** 직접 push 금지, pull request 필수, required check 초록 필수, 병합 전
   최신화 필수, force-push와 삭제 금지. **우회 권한은 사람에게도 기계에도 없다.**

   기계가 우회를 필요로 하지 않게 만드는 쪽을 택했다. 릴리스 publication은 digest를 `main`이 아니라
   기계가 소유한 `deploy/prod`에 쓰고, Argo CD는 그 ref를 본다. `main`에 쓰는 경로가 아예 없으므로
   면제할 것도 없다.

   이 결정은 처음에 "릴리스 workflow에만 pull request 요구를 면제한다"로 적혀 있었고 그것은 틀렸다.
   사용자 소유 저장소는 GitHub Actions를 ruleset의 bypass 주체로 등록할 수 없다(`Actor GitHub Actions
   integration must be part of the ruleset source or owner organization`). 면제를 설정할 수 없다는
   사실을 확인하기 전에 적은 문장이었다(2026-09-12, EAT-202).

   promote가 스스로 pull request를 여는 안도 막힌다. `GITHUB_TOKEN`으로 만든 pull request는 재귀를
   막기 위해 `pull_request` workflow를 띄우지 않으므로 required check가 붙지 않고 자동 병합이 영원히
   멈춘다. 개인 access token을 두면 풀리지만 장기 생존 자격 하나가 생기고 그 토큰은 사실상 소유자
   계정만큼의 것이 된다. 그 자격을 만들지 않는 쪽을 골랐다.

2. **검증은 세 고리이고 고리마다 질문이 하나다.** 고리를 검사 범위가 아니라 답하는 질문으로 나눈다.

   | 고리 | 질문 | 어디서 | 실패하면 |
   |---|---|---|---|
   | 작업 중 | 방금 바꾼 것이 규칙을 어겼나 | 커밋 훅, 변경 범위 | 커밋이 안 된다 |
   | 병합 전 | 이것이 `main`에 들어가도 되나 | CI, pull request | 병합이 안 된다 |
   | 릴리스 | 이것을 운영에 올려도 되나 | CI, 태그 | publication이 안 된다 |

3. **같은 검사를 두 고리에서 돌리지 않는다.** 로컬 push 게이트의 main 전용 전체 검사를 없앤다. 그 검사는
   CI가 어차피 다시 돌리던 것의 부분집합이었고, 더 좁은 범위로 "통과"라고 말해서 사람을 속였다. `pre-push`에는
   main 직접 push를 로컬에서 먼저 거절하는 안내만 남긴다. 서버가 거절하기 전에 12분을 낭비하지 않기 위해서다.

4. **병합을 막는 검사는 CI의 검증 job 전부다.** 느리다고, 가끔 흔들린다고 required에서 빼지 않는다. 뺀
   검사가 잡던 결함은 그날로 main에 들어간다. 흔들리는 테스트는 통과시킬 대상이 아니라 고칠 결함이다.

5. **브라우저가 필요 없는 판정을 브라우저 밖으로 뺀다.** 결정 4를 감당 가능하게 만드는 것은 예외가 아니라
   분리다. 판정을 둘로 가른다.

   - **계약 판정**: 서버를 띄우고 공개 응답이 `packages/contracts`를 만족하는지 본다. 결정적이고 초 단위다.
   - **렌더 판정**: 폭별 밀림처럼 실제로 브라우저가 있어야 답할 수 있는 것만 남긴다.

   `eligibilityAreas` 결함은 화면 결함이 아니라 계약 결함이었는데 Playwright 안에 있어서 15분을 기다려야
   알 수 있었고 폰트 경고와 같은 통에 담겼다. 옮기고 지우는 것을 한 번에 하지 않는다. 계약 레인이 같은
   결함을 잡는 것을 먼저 확인하고 그 뒤에 브라우저에서 뺀다.

6. **태그는 prod publication의 시작점으로 남되 이유가 바뀐다.** ADR 0024에서 태그는 branch를 막을 수 없어서
   고른 대체 권한이었다. 이제는 prod가 매 병합마다 움직이면 안 되기 때문에 남긴다. 권한 문제는 결정 1이
   직접 푼다.

## Consequences

- 작업 흐름이 worktree → pull request → CI 초록 → 자동 병합으로 바뀐다. 병합마다 내던 12분 로컬 대기가
  사라지고 대기가 CI로 옮겨간다. 에이전트 세션은 기다리지 않고 다음 이슈로 간다.
- 빨간 `main`에서 required check를 켜면 모든 pull request도 빨갛다. CI는 병합 결과를 검사하기 때문이다.
  그래서 결정 1을 켜기 전에 `main`을 초록으로 만들어야 한다. 이 순서는 선택이 아니다.
- CI 실행 수가 는다. 공개 저장소라 Actions에 한도가 없어 비용 제약이 아니다. 대신 실행 시간이 사람의
  대기 시간이 되므로 [EAT-190](https://linear.app/eatbid/issue/EAT-190)의 변경 범위 검사가 값을 갖는다.
- 결정 5의 계약 레인이 생기기 전까지 브라우저 스위트가 계약 결함도 잡는다. 그 기간에는 병합이 느리다.
- 결정 1은 병합을 막지만 태그 레인 실패와 예약 실행 실패는 못 막는다. [ADR 0046](0046-telemetry-wire-correlation-and-alert-origin.md)
  결정 5의 "원격 `main`의 최신 CI가 초록이다" 기대는 여전히 필요하다.
- 운영이 보는 ref가 `main`에서 `deploy/prod`로 옮겨간다. 덤으로 `main`의 `infra/product`를 고쳐도
  운영이 즉시 움직이지 않는다. 운영은 릴리스가 `deploy/prod`를 옮길 때만 바뀌며, 이것은
  [ADR 0051](0051-dev-overlay-and-unsigned-main-image-lane.md) 결정 5의 "prod는 이름 붙은 걸음으로
  움직인다"를 구조로 만든 것이다.
- `deploy/prod`는 기계가 소유한 파생 ref다. 매 릴리스의 digest 커밋이 그 릴리스 commit을 부모로 다시
  서므로 fast-forward가 되지 않아 강제로 옮긴다. 그 push가 무엇을 담는지는 promote의 guard가 증명하며,
  ref가 지워져도 릴리스 태그에서 다시 만들 수 있다.
- `main`은 코드의 진실 원천으로 남고 배포 상태만 갈라진다. 두 ref가 어긋나 보일 수 있으므로 "운영에 도는
  digest가 저장소가 가리키는 것과 같다" 기대가 무엇을 비교하는지 분명히 해야 한다. 비교 대상은
  `deploy/prod`다.
- `--no-verify`로 건너뛴 커밋도 pull request에서 같은 판정을 받는다. 로컬 훅은 편의가 되고 판정은 서버로
  간다. [ADR 0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md)의 변경 범위 규칙은 첫째
  고리에만 적용되고 둘째·셋째 고리는 전체를 본다.

## 대안과 기각 이유

- **push 게이트에 CI의 검사를 전부 넣는다.** 푸시가 25분을 넘고 로컬에 Chromium이 필요해진다. 사람은 그
  시점에 `--no-verify`를 쓰기 시작하고, 그러면 게이트는 이름만 남는다. 게이트를 무겁게 해서 얻은 안전은
  게이트를 우회하는 순간 0이 된다.
- **브라우저 스위트를 required에서 뺀다.** 오늘 main을 세운 결함 둘 중 하나를 못 잡는다. 느리다는 이유로
  잡히던 것을 놓는 교환이다.
- **관리자 우회 권한을 둔다.** 급할 때 쓰려고 만들면 급한 날이 기본이 된다. 우회가 필요할 만큼 급한 상황은
  ruleset을 잠시 끄는 것으로 충분히 드러나게 처리한다.
- **개인 access token으로 promote가 pull request를 열게 한다.** `GITHUB_TOKEN`의 재귀 방지를 우회해
  required check가 붙게 만든다. 구조는 지금과 거의 같지만 장기 생존 자격 하나를 만들고, 그것은 사실상
  소유자 계정만큼의 권한이 된다. 감시 대상이 하나 늘고 회수 절차가 필요해진다.
- **릴리스 promote가 만든 pull request를 사람이 병합한다.** 새 자격도 아키텍처 변경도 없지만 릴리스를
  자주 내자는 방향과 부딪친다. 자동화가 사람 한 번을 기다리는 지점이 생기면 릴리스 빈도가 그 사람의
  가용성에 묶인다.
- **merge queue를 쓴다.** 서로 초록인 pull request 둘이 합쳐져 빨개지는 경우를 막지만, 동시에 열리는
  pull request가 몇 개 수준이라 "병합 전 최신화" 요구로 같은 효과를 얻는다. 규모가 커지면 다시 본다.
- **ADR 0024를 통째로 대체한다.** 0024의 결론(태그가 publication을 시작한다, `master`는 복구 기준)은 여전히
  옳다. 틀린 것은 그 근거 하나뿐이므로 그 부분만 대체한다.
