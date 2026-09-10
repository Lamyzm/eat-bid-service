# 0044 — route segment 내부를 기능 슬라이스로 나눈다

- Status: Accepted
- Date: 2026-09-10
- Amends: [ADR 0023](0023-nextjs-web-modular-boundaries.md)의 "한 route에서만 쓰는 presentation과
  interactive leaf는 route segment의 private `_model`/`_ui`/`_lib`가 소유한다" 조항. 여섯 층과 의존 방향,
  capability 승격 조건은 그대로 둔다.
- 관련 작업: EAT-137

## Context

> 이 ADR은 `mw-auction` 저장소의 `component-layers.md`·`folder-structure.md`를 대조해 다시 썼다. 처음에는
> "우리 관행은 FSD가 아니다"라며 현행을 옹호했는데, 그것은 질문에 답한 것이 아니라 기록을 방어한 것이었다.
> 아래 결정은 그 대조에서 실제로 배울 것을 받아들인 결과다.


2026-09-10 web 훑기에서 결정 화면(`app/(workspace)/auctions/[auctionId]`)을 파일 단위로 봤다. `_model` 16개,
`_ui` 30여 개이며 다음이 나왔다.

- `_ui`에 렌더링하지 않는 계산 모듈이 있다. `create-flow-chart.ts` 171줄, `own-bid/own-bid-series.ts` 115줄.
- 흐름 차트 하나를 고치려면 `_ui/flow-chart.tsx`, `_ui/create-flow-chart.ts`, `_ui/flow-legend.tsx`,
  `_model/flow-chart-model.ts`, `_model/flow-series.ts` 다섯을 두 폴더에서 오간다.
- `own-bid-provider.tsx` 145줄이 13갈래 상태 판정과 query 셋과 선택 상태와 표시 모델 조립을 함께 갖는다.
- 내 투찰은 ADR 0023이 정한 capability 승격 조건(독립된 사용자 intent, 권한 흐름, 여러 resource
  orchestration)을 이미 충족하는데 화면 폴더에 있다.

`_model`/`_ui`/`_lib`는 **파일 유형별 분리**다. 토스 Frontend Fundamentals는 유형별 폴더(`components`,
`hooks`, `utils`)를 응집도가 낮은 구조로 들고 함께 수정되는 파일을 같은 디렉터리에 두라고 한다.
Feature-Sliced Design도 slice를 먼저 나누고 그 안을 `ui`/`model`/`lib` 세그먼트로 나눈다. 두 자료가 같은 곳을
가리키며, 같은 조직의 다른 저장소(`mw-auction`)는 이미 그 형태를 규칙으로 갖고 있다.

여섯 층(`app`·`shell`·`capabilities`·`api`·`routing`·`shared`)과 의존 방향에는 문제가 없다. 문제는 층이 아니라
**세그먼트 내부**다.

## Decision

route segment 내부를 유형이 아니라 **변경 단위**로 나눈다.

```
<segment>/
  page.tsx            # 오케스트레이터. 조회 주입과 조립만 한다
  _widgets/           # 페이지 섹션 단위의 자족적 블록. feature와 표시 조각을 조합한다
  _features/<name>/
    ui/               # 렌더링만
    model/            # 상태·표시 변환. JSX 없음
    lib/              # 순수 함수. React·hook·JSX 없음
  _lib/               # 그 segment 전체가 쓰는 URL parser 같은 조각
```

1. `_features/<name>/lib`는 React를 import하지 않는다. `_features/<name>/model`은 JSX를 만들지 않는다.
   `ui`는 렌더링하지 않는 모듈을 두지 않는다. 이 셋을 `lint:web-boundaries`가 검사한다.
2. capability 승격 조건(ADR 0023)을 충족하면 `_features/<name>`을 `capabilities/<name>`으로 올린다. 조건은
   그대로이며 이 ADR은 승격 전 자리를 정할 뿐이다.
3. 도메인 계산(사정률·금액·시간)은 어느 자리도 아니고 `packages/domain`이 소유한다(AGENTS 15).
4. `ui`가 커지면 파일 수를 늘리기 전에 합성을 먼저 검토한다. prefix로 자연히 묶이면 하위 폴더를 만들지 않는다.
5. 기존 화면은 건드리는 변경에서 옮긴다. 전면 이동을 별도 작업으로 만들지 않는다.
6. **`entities/` 층을 새로 둔다.** 도메인을 알지만 화면에 매이지 않은 표시 조각의 자리다. 금액 표시,
   사정률 칩, 기관 라벨, 표본 수 문구, 판정 어휘가 여기 산다. 승격 조건은 하나다. **두 화면 이상에서 쓴다.**
   미리 만들지 않는다. `shared`는 도메인을 모르는 primitive만 유지하고, `capabilities`는 독립된 사용자
   흐름만 유지한다. entity끼리 서로 import하지 않는다.
7. `page.tsx`는 오케스트레이터다. 조회 주입과 조립만 하며 길어지면 로직이 샌 것이다.

## Consequences

- 한 기능을 고칠 때 한 폴더만 연다. 삭제도 폴더 단위로 끝나 죽은 코드가 남지 않는다.
- 잘못된 참조가 import 경로에 드러난다. `../distribution/model/...`을 흐름 기능이 부르면 눈에 띈다.
- 검사 가능한 규칙이 생긴다. 오늘 훑기에서 나온 반려 사유 다섯 중 넷이 lint 대상이 된다.
- 전환 비용이 있다. 결정 화면만 파일 40여 개가 자리를 옮긴다. 한 번에 하지 않고 변경과 함께 옮긴다.
- ADR 0023의 층·의존 방향·승격 조건은 유효하다. 이 ADR은 그 아래 한 겹을 정한다.

## Rejected alternatives

- **Full FSD 채택(`_pages`·`widgets`·`entities` 층 신설, steiger 도입).** 이득은 공용 어휘와 기성 linter다.
  비용은 파일 300여 개 이동과 `web-boundaries` 재작성이며, `packages/domain`이 이미 entities의 도메인 부분을
  갖고 있어 entities 층이 반쪽이 된다. 이 ADR의 결과물이 그대로 FSD slice 모양이므로 나중에 판단해도 늦지 않다.
- **병렬 라우트(`@slot`)로 영역을 나눈다.** 폴더 격리와 슬롯별 loading·error를 얻지만, 영역별 streaming은
  Suspense 경계로 이미 얻을 수 있고 독립 navigation은 오히려 없애려는 것이다. 무엇보다 지금 loader가 보장하는
  교차 일관성(시각 한 번 읽기, build 고정)이 슬롯마다 흩어진다.
- **현행 유지.** 유형별 폴더가 세그먼트 안에서 반복되며, 계산 모듈이 `_ui`에 쌓이는 것을 막을 규칙이 없다.
