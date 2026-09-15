# EAT-215 새 상세의 공고 정보와 스티키 비교조건

## 실행 기준

- branch/worktree: `eat-215-detail-filters` / `.worktrees/eat-215-detail-filters`
- 기준 commit: `8dd81f6e` (EAT-213 병합). 구현 종료 전 fetch에서도 origin/main과 같은 기준.
- 시안: `g-methods/?revision=region-comparison-2`
- 명세: PDR-0006, `docs/product/analysis-common-contracts.md`, Linear EAT-215
- 사용자 승인: 같은 프로젝트의 새 상세 경로에서 시안 중심으로 구현한다. 최종 상세 URL은 하나다.
- 전환/철거: [EAT-224 계획](2026-09-15-detail-cutover.md). 기존 상세의 JSX·탭·loader는 새 구현의 기준이 아니다.

## 구현 범위

개발 경로는 `/auctions/[auctionId]/analysis`다. 기관·공고 사실 → 시간별 추이/낙찰값 분포 탭과
스티키 공통 비교조건 → 기관 vs 지역/전국 분석 → 같은 조건의 전체 개찰 이력 순서를 제공한다.
아직 집계 자료를 읽는 endpoint는 없으므로 표본과 그래프는 준비 상태로 표시한다. 가짜 점·0건·표본 수를 넣지 않는다.

- 새 route의 loader는 기존 공고 단건 resource를 재사용하고 기존 기관 이력·분포 loader는 호출하지 않는다.
- 공고와 확인된 ID·코드 체계·라벨로 필터 초안을 구성한다. 이름·지역·하한율·상태 미확인을 추정으로 채우지 않는다.
- 공통 필터 전체를 URL 한 값으로 적용한다. 초안 수정은 조회하지 않는다. 날짜·명단 오류는 입력 옆에 설명한다.
- 탭·전체보기는 표시 상태로 바꾸며 조건을 보존한다. 전체보기는 브라우저 콘텐츠 뷰포트 전체를 차지한다.
  Escape와 일반보기 스크롤/초점 복귀를 제공한다.
- 현재 URL과 응답 조건이 다르면 이전 자료를 표시하지 않는다. 기관과 비교군 설명·추이·분포·이력에 같은 gate를 쓴다.
- 날짜 프리셋은 오늘 KST까지 12/6/3/2/1개 달력월이다. 첫 달 1일부터 오늘까지 포함한다.
- 명단은 철회 포함 관측 행 수이며 최소·최대 양끝을 포함한다. 한쪽만 입력할 수도 있다.
- 선택지 resource 전에는 현재 공고에서 관측된 공고지역·하한율·낙찰방식만 사용한다.
  코드 사전의 활성 상태나 조회 가능성을 관측 코드로 대신 증명하지 않는다.
- 보유 양끝을 모르므로 전 기간은 비활성이다. 기관 품목 코드는 아직 공급 전이어서 전체 품목과 설명을 표시한다.
- 공통 ApplicationShell, Toss 토큰, ChartFullscreenFrame을 사용한다. shell과 전역 메뉴를 복제하지 않는다.

## 소유 경로

- `apps/web/src/app/(workspace)/auctions/[auctionId]/analysis/**`
- `apps/web/e2e/analysis-filters.spec.ts`, `apps/web/package.json`의 e2e 등록
- `packages/domain/src/analysis/month-period.ts`와 테스트, domain index export
- 이 계획과 상세 전환 계획

기존 상세에 이번 작업에서 추가했던 미커밋 통합 변경은 분리했다. 기존 화면의 UI·API 폐기는 EAT-224에서
실제 소비자 전환 증거와 함께 수행한다. 공통 API를 새 페이지용으로 복제하지 않는다.

## 검증 결과

- [x] 신규 단위 13건, domain 분석 3건 통과
- [x] 브라우저 3건 통과: 기본 필터·초안/적용·오류/초점·sticky·키보드 탭·URL 복귀·휴대폰·잘못된 URL
- [x] 1440×900, 375×812 전체보기의 x/y=0과 viewport 전체 크기 검증
- [x] Web typecheck와 production build 통과
- [x] architecture 전체 18개 통과. contracts JSON Schema/Python 생성물 check 포함
- [x] Web lint 오류 0. 변경 밖 기존 경고 7개는 유지
- [x] 실제 dev에서 공고 89의 새 경로·Toss 지면 확인
- [x] c47c31fe의 AI advisory finding 없음. PR #26 required CI 두 개 성공 후 0a0a1c68로 병합
- [x] 2026-09-15 교대 시 Linear EAT-215 Done 갱신. [대화 없는 재개 인계](../../operations/handoffs/2026-09-15-detail-mvp.md)

브라우저 첫 실행은 접근 가능한 제목의 공백에서 1건 실패해 실제 공백을 보완했다. tablist의 roving focus도
lint에 맞춰 연결한 뒤 브라우저 3/3과 lint를 다시 확인했다. 이후 기관 ID가 있지만 이름만 없는 경우의
표시를 구분했고 단위 13건을 재검증했다.

## 시안과 실제 화면 비교

실제 dev는 `http://localhost:3215/auctions/89/analysis`, 실행 worktree는 EAT-215다.
공고 기관을 앞세운 요약, 상단 탭+공통 조건, 비교 제목, 연속된 분석/전체 이력의 순서를 시안과 대조했다.
시안의 명단 preset은 승인된 명세에 따라 최소·최대 직접 입력으로 구현했고 날짜 양끝도 직접 입력한다.
전체보기는 시안의 본문 높이 확대보다 뒤에 확정된 요구인 viewport 전체 점유를 따른다.

시안과 계약 fixture/실제 공고의 기관·자료·viewport가 다르므로 점 위치나 픽셀 일치를 주장하지 않는다.
현재 이슈의 그래프·행은 준비 상태다. 추이/분포/전체 이력의 실제 연결·전국 부하·스냅샷 동일성은 EAT-216~222 범위다.
실제 공고 89는 기관 ID가 있어도 기관 이름, 공고지역·방식 라벨의 표시가 미확인이다.
표제의 문자열로 그 값을 만들지 않았으며, 공급 계약과 코드 사전/표시 연결 확인이 필요하다.

당시 dev 실행: 3215 포트, PID 32968, 도구 세션 78699. 다른 서버 4400/3000은 변경하지 않았다.
2026-09-15 22:15 KST 재확인에서는 3215/4400/8769 listener가 없다. 이 기록을 현재 실행 증거로 쓰지 않는다.
production build는 dev 시작 전에 종료해 같은 .next 디렉터리를 동시 사용하지 않았다.
