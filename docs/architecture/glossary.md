# 용어집

| 용어 | 정의 | 사용하지 않을 대체 표현 |
|---|---|---|
| AuctionAttempt | eaT 외부 `ELCTRN_BID_ID`로 식별되는 한 번의 입찰 시도 | 공고번호 문자열을 곧 엔터티로 보는 “공고” |
| AuctionRevision | 한 AuctionAttempt의 source 내용 변경을 보존한 불변 revision | 현재 행 overwrite |
| AuctionRelation | 재입찰·상위/하위 공고 등 source가 제공한 시도 간 관계 | 공고번호 접미사 추론 |
| Organization | 구매/대표/수요/배송 역할을 맡을 수 있는 기관 | 모든 기관을 School로 부르기 |
| SupplierParty | 사업자등록번호 등으로 식별되는 법적 사업자 | source 계정과 혼용한 업체 코드 |
| SourceSupplierAccount | 특정 source의 업체 참여 계정 | 법적 사업자와 자동 동일시 |
| BidSubmission | source에서 관측한 업체의 제출/취소/무효/순위 사실 | 사용자 기록값, 단순 won flag |
| AwardDecision | 낙찰·유찰·재공고 등 source의 결과 결정 | submission의 boolean 속성 |
| BidWorkItem | workspace×supplier×auction 단위의 사용자 작업 상태 | 공고 단위 전역 찜/투찰 상태 |
| RawObservation | 특정 요청에서 받은 원본 응답과 메타데이터 | 덮어쓰는 최신 XML 파일 |
| Publication | 완전성 검증 후 원자적으로 활성화된 canonical 변경 집합 | 부분 성공을 섞은 현재 상태 |
| CodeScheme | 코드의 소유기관·namespace·버전·의미 경계 | 모든 지역 코드를 한 표로 취급 |
| CodeMapping | 서로 다른 CodeScheme 값 사이의 근거·유효기간 있는 관계 | 라벨 문자열 동등 비교 |
| Taxonomy | eatbid가 소유하는 분류 체계 | 가짜 정부 코드 |
| core | source observation을 규칙으로 해석한 canonical 업무 사실 | raw 또는 사용자 상태 |
| app | 사용자가 작성·확인한 workspace 상태 | source 사실 |
| mart | 버전/시점/표본을 가진 재생성 가능 분석 결과 | master/SSOT |
| replay | 지정 raw 집합을 지정 코드 버전으로 다시 해석하는 실행 | source 재수집과 혼용 |
| NeaT 입력 확인 | 사용자가 외부 화면에 입력했다고 eatbid에 남긴 확인 | source-observed submission |

코드, API, 화면, 문서에서 새 동의어를 만들기 전에 이 표를 갱신한다. 한국어 UI 표현은
달라질 수 있지만 도메인 계약과 혼동되지 않게 매핑을 문서화한다.
