# 공통 셸 배치 비교 시안

2026-09-08 사용자가 승인한 비교 작업이다. 제품 구현이나 확정된 정보구조가 아닌 디자인 검토물이다.
실제 `ApplicationShell`, 대시보드 라우트, API와 사용자 설정은 수정하지 않는다.
제품 방향은 `roadmap.md`, 현재 화면 계약은 `screen-system.md`가 권위다.

## 비교 방법

1. 상단 검토 바에서 홈·설정·공고 분석을 선택한다.
2. 같은 본문을 유지한 채 A 왼쪽 메뉴 / B 상단 메뉴를 바꾼다.
3. A에서는 메뉴를 접어 본문 폭을 회복할 수 있다.
4. 오른쪽 관심·최근 본·내 공고와 공고 정보·선택 회차 기록은 한 공간에서 전환한다.
5. 공고 분석에서 크게 보기, 표의 기록 보기, 차트 확대 후 패널 열기·닫기를 비교한다.
6. 1200px 미만에서는 오른쪽 아이콘 줄을 완전히 숨기고 상단 `바로가기`로 세 목록을 연다.

기존 shadcn Sidebar·Select·Sheet·Input과 shared Button·Table을 직접 import한다.
차트는 dev의 `createFlowChart`와 `buildFlowChartModel`, 색은 기존 Eatbid/Toss 테마를 재사용한다.
레이아웃 비교 셸만 독립적으로 조립한다. 프로덕션 셸에 이 시안 코드를 복사할 계획은 없다.

모든 기관·사업자·공고·이력·참여 값은 명시된 fixture다. 분석은 가람고등학교 한 예시만 지원한다.
지역·품목·검색은 예시 목록만 좁힌다. 차트의 조건 칩은 이번 배치 비교에서 읽기 전용이다.
설정 변경은 시안 메모리에만 남으며 실제 계정에 저장하지 않는다. 사업자 선택도 배치 검토용이다.
관심·최근 본의 실제 저장, 지도 집계, 권한, 수집 완전성은 구현/검증하지 않는다.

## 실행

frozen install이 된 작업 사본의 루트에서 실행한다. 기본 결과물은 OS 임시 폴더에만 생성한다.

```powershell
node docs/product/prototypes/shell-comparison-2026-09-08/serve.mjs
```

출력 폴더를 첫 인자로 지정할 수 있으며 저장소 밖이어야 한다. 로컬 주소는 `127.0.0.1:8770`이다.
시안이 열린 뒤 소스를 바꾸면 서버를 종료하고 같은 명령으로 다시 빌드한다.
리뷰 시안은 제품의 API 경로, 레거시 예외, 전역 내비게이션 계약에 예외를 추가하지 않는다.

## 검증과 advisory 판단

- 시안 TypeScript와 scoped lint, 저장소 `quality:check`를 통과했다.
- 홈·설정·분석의 A/B와 패널 열림을 5개 viewport에서 검토했고 문서 가로 넘침은 없었다.
- 차트 확대 후 패널 전환·닫기에서 캔버스 픽셀, 선택 회차와 표 스크롤을 보존했다.
- `pnpm review:ai -- --base HEAD~1`의 Windows 출력 경로 검사 지적은 확인 후 반영했다.
  대소문자를 구분하는 문자열 prefix 대신 운영체제의 상대 경로 해석으로 내부 출력을 거부한다.
- 테마 지적은 재사용한 `createFlowChart`의 `MutationObserver`가 HTML 테마를 관찰해
  모든 계열 색을 갱신하므로 채택하지 않았다. 엔진을 다시 만들면 확대 보존을 해친다.
- Effect Event 지적은 Effect에서 등록·해제하는 차트 구독 콜백이라는 실제 경계를 확인했다.
  [React 공식 문서의 외부 이벤트 구독 예시](https://react.dev/reference/react/useEffectEvent#using-an-event-listener-with-latest-values)와
  같은 수명주기이며 다른 React 컴포넌트나 Hook에 함수를 전달하는 경우가 아니므로 유지했다.
