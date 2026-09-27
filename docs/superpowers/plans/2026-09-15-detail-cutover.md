# 상세 화면 전환과 기존 조회 코드 정리

EAT-176 · EAT-215 · [EAT-224 전환·철거](https://linear.app/eatbid/issue/EAT-224), 2026-09-15. 시안과 명세가 화면의 기준이다.
사용자 승인: 새 상세를 별도 경로에서 개발하되 최종 상세 화면·URL은 하나로 통합하고 기존 API 사용처까지 정리한다.

## 최종 상태

- 최종 사용자 상세 URL은 기존 `/auctions/[auctionId]`다.
- `/auctions/[auctionId]/analysis`는 개발·검증 중의 임시 진입점이다. 두 화면 선택 메뉴를 제품에 만들지 않는다.
- 새 상세의 필수 컴포넌트가 연결되고 검증되면 새 조립을 기존 URL로 옮기고 임시 route를 제거한다.
- 기존 상세의 JSX·상태·탭 구조는 새 페이지의 구현 기준이 아니다. 신규 route는 기존 `decision-screen`과
  `load-auction-page`를 import하지 않는다. 승인된 공통 분석 계약과 시안을 직접 소비한다.
- 최종 URL 교체만으로 완료 처리하지 않는다. 아래 사용처 정리와 사용 중지된 코드·검증 제거까지 완료 조건이다.

## 조회와 상태의 사용처 조사

아래는 2026-09-15 EAT-215 worktree에서 확인한 참조다. 구현·삭제 전 전체 저장소에서 다시 확인한다.
이름이 같은 데이터라는 이유로 새 분석 요청에 그대로 번역하지 않는다.

| 현재 자원·상태 | 관측된 소비자 | 새 상세에서의 판단 | 전환 완료 시 정리 |
|---|---|---|---|
| `api/auctions/server.ts` 공고 한 건 | 기존 상세 route | 새 header/facts에서도 같은 resource를 재사용 | 기존 상세 loader만 제거. 오늘 목록과 같은 resource에 있는 함수는 개별 사용처로 판단 |
| `api/auctions/queries.ts` 참여 명단 | 기존 `auction-roster-panel` | EAT-219 선택 회차 상세의 계약·권한·revision을 검토하여 재사용 | 기존 패널 전용 상태/선택 provider 제거 여부 확인 |
| `api/organizations/server.ts` 기관 회차 | 기존 상세 loader, 내부 revalidate 경로의 관련 export | 기존 조회는 새 공통 관측 집합과 snapshot을 보장하지 않음. EAT-216/218에 맞춰 대체 | Web read/adapter/error/cache-tag/revalidate의 남은 소비자 확인 후 삭제 |
| `api/win-rate-distribution` | 기존 상세 loader·분포 표시, 내부 revalidate 경로 | EAT-217의 공통 조건·동일 구간·스냅샷 조회로 대체 | 기존 Web 전용 query/formatter/cache/revalidate 및 분포 UI 정리 |
| `api/account` 내 사업자·내 투찰 관측 | 기존 own-bid provider와 계정 기능 | 사용자 작성 상태와 인증은 유지. MVP 밖 overlay는 후속 단계에서 연결 | 기존 상세 전용 provider는 분리 제거 가능. 계정 API와 PostgreSQL app의 사용자 기록은 UI 철거로 삭제하지 않음 |
| 기존 `period/scope/item/pages/historyRead/view/expand` query | 기존 상세 필터·확대·회차·분포 | 새 분석은 `AnalysisFilterValue`와 표시 전용 탭/전체보기 사용 | 저장·공유된 URL의 유효 입력만 명시적으로 해석. 대응 불가능한 조건은 안내하며 조용히 비슷한 조건으로 치환하지 않음 |
| `ChartFullscreenFrame`·Toss·공통 shell | 여러 화면 | 새 상세에서도 재사용 | 상세 전용 CSS만 제거. 공통 프레임·shell은 유지 |

## 서버·계약·집계까지의 철거 경계

Web import가 사라졌다는 사실만으로 공개 endpoint를 바로 지우지는 않는다.
공개 API와 실제 업무 사실의 권위는 화면과 별개다. 다음 의존 사슬을 확인해 폐기 여부를 확정한다.

1. 화면 loader/hook/query key와 API resource adapter.
2. `packages/contracts` operation 및 response/query schema, codec, registry/OpenAPI 생성·검증.
3. `apps/server/modules/procurement` controller/presenter/application reader/Drizzle adapter와 DI 등록.
4. 내부 캐시 무효화 route·발행 후 호출자·cache tag. 중지된 resource로 계속 무효화 요청을 보내지 않는다.
5. mart reader를 쓰는 다른 endpoint·운영 작업·Argo 집계/발행·재실행. 조회 폐기와 집계 폐기를 별개로 검증한다.
6. 불필요해진 테스트·fixture·문서·스크린샷 검증을 정리하고 새 계약의 경계 테스트를 유지한다.

새 화면마다 API family를 복제하지 않는다. 같은 operation의 Web adapter는 `api/<resource>` 하나가 소유한다.
기존 operation을 수정할지 폐기하고 새 공통 분석 operation으로 바꿀지는 EAT-216~220에서 의미와 소비자를
비교해 결정한다. endpoint의 method/path/schema는 계속 packages/contracts가 소유한다.
원본 R2와 core 사실·app 사용자 기록을 화면 전환에 맞춰 지우는 작업은 이 계획에 포함하지 않는다.

## 전환 순서와 완료 판정

- EAT-215: 새 route의 공고 정보·스티키 조건·두 탭·전체보기 틀. 새 분석 자료 없는 상태를 명시한다.
- EAT-216~220: 같은 공통 필터·스냅샷으로 추이·분포·전체 이력·선택 회차를 실제 연결한다.
- 전환 작업: 새 화면을 최종 URL로 옮기고 기존 UI와 임시 route를 제거한다. 신규 화면의 private 코드는
  최종 segment로 옮기며 이전 화면의 내부 모듈을 보존하기 위한 wrapper를 남기지 않는다.
- API 정리 작업: 위 조사표를 실제 소비자 기준으로 갱신하고, 폐기하기로 한 경로의 참조를 전부 해소한다.
  별도 writing owner가 있는 서버/계약/집계 작업은 해당 issue·worktree에서 수행한다.

최종 확인에는 목록에서 상세 진입, 로그인 후 원래 URL 복귀, 공유 URL 조건 처리, 공고 조회와 권한,
개찰점/행에서 명단 열기, 차트 전체보기·Escape·초점 복귀, 조건별 추이/분포/이력의 같은 표본,
사용자 기록 보존을 포함한다. 폐기된 API로의 Web 요청과 캐시 무효화 호출이 남지 않은지도 확인한다.
준비 화면이나 문서 등록을 최종 전환 완료의 증거로 삼지 않는다.

## 진행 기록

### 2026-09-27 화면 전환 (EAT-224 첫 PR)

- 새 상세를 `/auctions/[auctionId]`로 올리고 `/auctions/[auctionId]/analysis`를 없앴다. 오늘 목록의 링크는
  원래 `/auctions/{id}`라 바꾸지 않았다.
- 옛 상세의 화면·모델·테스트와 옛 화면 전용 브라우저 검증(결정 화면·흐름·차트 전체보기·내 투찰)을 지웠다.
  공통 셸 검증은 새 상세의 기관 제목과 회차 명단 패널로 같은 경계를 본다. 캐시 검증은 새 상세의 공고·추이·
  분포 읽기가 재열람마다 Nest를 부르고 활성 build 전환을 곧바로 읽는지 보며, 세 번 여는 동안 기관 회차·옛
  분포 API 요청이 0건임을 기록한다.
- 사용자 결정(2026-09-27): 투찰률 손잡이·"이 값이면"과 내 투찰 기록 겹쳐 보기는 새 상세에 아직 없고 이번
  전환에서 화면에서 사라진다. 다시 붙이는 일은 후속 이슈가 맡는다. 계정 API와 app의 사용자 기록은 그대로다.
  옛 `own-bid.spec.ts`가 증명하던 "로그인한 사용자가 실제 Nest 위에서 공고 상세를 본다"도 그 후속 이슈에서
  새 상세 위로 되살린다.

### 2026-09-27 옛 조회 API 폐기 (EAT-224 둘째 PR)

- 기관 회차 이력(`listOrganizationAuctionAttempts`)과 낙찰률 분포(`findWinRateDistribution`)의 계약·Nest
  controller·use case·reader·presenter·테스트와 Web 조회 adapter·e2e 가짜 응답기를 지웠다. 새 분석 use case가
  쓰던 `OrganizationNotFound`는 `application/organization-not-found.ts`로 옮겼다.
- 두 mart(`org_round_summary`, `win_rate_distribution_monthly`)와 dataplane의 무효화 push는 그대로다. Web의
  `revalidateOrgRoundSummaryCache`·`revalidateWinRateDistributionCache`는 지울 캐시가 없지만 push 계약을 받기
  위해 남긴다(사용자 결정 2026-09-27). 지우면 route가 push에 500으로 답한다.
- 공유 read 게이트 목록에서 두 옛 경로를 빼고 분석 조회 넷을 넣었다. 이전에는 분석 조회가 목록에 없어 게이트가
  빠져도 테스트가 잡지 못했다.
- 옛 API를 현재형으로 설명하던 ADR 0032·0036, PDR-0004, 결정 화면 v2 두 문서, 상세 MVP 인계 문서에는 폐기
  표시 한 줄만 붙였다.

### 남은 일

- 투찰률 "이 값이면"과 내 투찰 기록 겹쳐 보기, 로그인 사용자의 real-Nest 상세 검증을 새 상세에 되살린다(EAT-283).
- 셸의 도구 줄(`shell/layout/workspace-dock`)은 옛 상세만 도구를 등록했다. 남은 사용처를 확인하고 정리한다.
- 무효화 push의 두 mart 항목을 route·계약·dataplane에서 함께 걷어낼지는 캐시가 다시 필요한지 보고 정한다.
