# 0058 — 분석 그림은 Apache ECharts로 그린다

- Status: Accepted
- Date: 2026-09-28
- Supersedes: [ADR 0031](0031-decision-screen-frontend-rendering.md) 3항("호가창과 흐름은 우리가 소유한 inline
  SVG/HTML 컴포넌트로 그린다. recharts와 lightweight-charts는 새 코드에서 import하지 않는다")을 **분석 그림에
  한해** 대체한다. 표·호가창처럼 그림이 아닌 지면과 0031의 나머지 항은 그대로다.
- 관련 작업: EAT-285
- 승인: 사용자(2026-09-28)

## Context

0031은 결정 화면의 흐름 차트가 60점 이하라는 전제에서 "차트 라이브러리는 번들과 스타일 통제 비용만 크다"고
판단했다. 공고 상세가 새 분석 화면으로 바뀐 뒤(EAT-224) 시간별 추이 그림은 그 전제와 다르다. 이 기관 점이
최대 5천, 비교 집단이 점 2천 또는 주·달 × 사정률 0.1%p 밀도 칸, 겹쳐 보는 기관 여섯, 하한선을 한 그림에 그린다.
같은 개찰일에 회차가 여럿이라 한 시각에 점이 여러 개 선다.

직접 그린 캔버스에는 확대·이동·마우스 올림 정보가 없었고, 사용자는 운영 화면에서 트레이딩뷰 같은 조작을
요구했다(2026-09-28). 이 조작을 직접 짜는 일은 라이브러리가 이미 푼 문제를 다시 푸는 일이다.

2026-09-28 운영 규모 합성 자료(이 기관 60점, 비교 약 1만 7천 건 = 밀도 칸 약 1,400, 겹친 기관 1곳)로 후보를
실제로 돌려 쟀다. 번들은 `bun build --minify` 뒤 gzip, 그리기는 headless Chromium의 `performance.now()`다.

| 후보 | gzip | 첫 그리기 | 점 7천 개 | 같은 시각 여러 점 | 휠 확대·끌기 | 기간 막대·기간 선택 |
|---|---|---|---|---|---|---|
| lightweight-charts 5.2 (트레이딩뷰) | 70KB | — | — | **거부**: `Assertion failed: data must be asc ordered by time` | 있음 | 없음 |
| Chart.js 4.5 + zoom 플러그인 | 76KB | 52ms | 39ms | 됨 | 됨 | Shift+끌기만, 막대 없음 |
| ECharts 6.1 (필요 모듈만) | 184~203KB | 116ms | 61ms | 됨 | 됨 | 기본(`dataZoom` slider·toolbox) |
| uPlot 1.6 | 23KB | — | — | 점 그림 모드 | 플러그인 직접 | 없음 |

토스증권처럼 트레이딩뷰를 쓰는 서비스의 자료는 시각마다 값 하나인 시세다. 우리 자료는 같은 시각 여러 회차와
밀도라서 트레이딩뷰는 옛 상세처럼 우회 코드를 요구한다(옛 `own-bid-series.ts`의 custom series가 그 우회였다).

## Decision

1. **분석 그림(시간별 추이와 앞으로의 분포·비교 그림)은 Apache ECharts로 그린다.** 필요한 차트·컴포넌트·
   renderer만 `echarts/core`에 등록해 쓴다. 전체 번들을 import하지 않는다.
2. **이 제품은 그림이 중심이라 번들보다 조작과 표현을 우선한다(사용자 결정).** ECharts는 Chart.js보다 약
   110~130KB 크지만 기간 막대·기간 선택·원래대로·markLine·tooltip을 기본으로 주고, 앞으로의 그림도 한
   라이브러리로 그릴 수 있다.
3. **그림이 소유하는 것과 그 밖이 소유하는 것을 나눈다.** ECharts는 좌표·그리기·확대·마우스 올림만 맡는다.
   무엇을 그릴지(점·밀도·겹친 기관·하한·축 범위·표본 수)는 지금처럼 표시 모델(`present-time-series.ts`)이
   정하고, 서버 응답과 계약은 바꾸지 않는다. 점을 누르면 명단을 여는 것처럼 화면 상태는 React가 소유한다.
4. **색은 `shared/lib/chart-colors.ts`의 테마 팔레트에서 읽는다.** ECharts 기본 테마 색을 화면에 들이지 않는다.
5. **브라우저에서만 초기화한다.** ECharts는 `window`와 DOM 크기를 읽으므로 client 컴포넌트의 effect 안에서
   만들고 크기 변화에 `resize`, 떼어낼 때 `dispose`한다. 서버 렌더는 같은 크기의 빈 자리를 둔다.
6. **쓰지 않는 lightweight-charts와 recharts를 의존성에서 지운다.** 0031이 제거를 약속했고 지금 import하는
   코드가 없다.

## Consequences

- web 번들에 ECharts가 들어온다(추이 그림이 있는 route의 client chunk에 약 184~203KB gzip).
- 확대·이동·기간 선택을 직접 구현하지 않는다. 대신 ECharts의 선택지 이름과 동작에 묶인다. 판이 바뀌면
  (6.x → 7) 그림 모듈 하나를 다시 본다.
- 직접 그리던 `lib/draw-time-series.ts`와 누른 자리 되짚기(`model/time-series-hit.ts`)는 ECharts의 그리기와
  click 이벤트로 대체되어 지운다.
- 잘못됐을 때 비용: 번들이 체감 성능을 해치면 Chart.js로 옮긴다. 표시 모델이 그림과 분리돼 있어 바뀌는 것은
  그림 모듈 하나다.
