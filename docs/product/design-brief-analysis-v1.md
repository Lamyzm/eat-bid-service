---
id: PRODUCT-DESIGN-BRIEF-ANALYSIS-V1
status: exploration
canonical_for: none
derived_from:
  - PRODUCT-SCREEN-SYSTEM
  - PRODUCT-DECISION-SUPPORT
last_reviewed: 2026-08-31
---

# Claude Design 브리프 — eatbid 분석 상세 V1

> 이 문서는 시각 탐색용 입력이다. 제품·분석 계약의 권위는
> [`screen-system.md`](screen-system.md)와 [`decision-support.md`](decision-support.md)에 있다.
> 디자인 탐색 결과가 이 문서들을 자동으로 변경하지 않는다.

## Claude Design에 전달할 요청

```text
당신은 한국 B2B 금융·데이터·업무도구를 설계하는 시니어 프로덕트 디자이너다.

eatbid의 “투찰 판단을 위한 분석 상세” 화면을 다시 설계하라. 코드를 구현하지 말고,
먼저 정보구조와 필터 interaction을 설계한 뒤 실제 검토 가능한 데스크톱 시안을 제시하라.

이 제품은 특정 투찰가를 추천하거나 낙찰을 예측하지 않는다. 정부 원본에서 관측한 사실,
버전이 있는 비교집단 분석, 사용자가 직접 작성한 후보를 분리해 보여 주고, 사용자가 자기 판단을
검토하고 나중에 복기할 수 있게 하는 근거 재현형 업무도구다.

핵심 사용자:
- 월 30건 이상 eaT 공고를 검토하는 급식 납품업체 대표 또는 소규모 실무팀
- 1~3개의 법적 사업자를 운영
- 과거 기관별 값과 최근 결과를 직접 비교해 투찰 후보를 정함
- 숫자에 익숙하지만 통계·데이터 계보 용어에는 익숙하지 않을 수 있음

이 화면의 유일한 질문:
“이번 공고와 실제로 비교 가능한 과거 관측은 무엇이고, 내가 직접 적은 후보를 검토하기에
이 근거가 충분한가?”

현재 프로토타입 URL:
https://eatbid.net/dashboard/analysis/%EA%B9%80%ED%95%B4%EC%8B%9C%7C%EC%9C%A8%ED%95%98%EC%A4%91%ED%95%99%EA%B5%90

업계 사용자 언어 참고:
- 비드큐 공개 FAQ: https://www.bidq.co.kr/bidq/customer/faq?category=1
- FAQ에서 확인되는 mental model은 발주처/기관, 업종·품목, 지역, 가격, 일시 filter와
  발주처 흐름·값의 구간 빈도·경쟁사 투찰 흐름의 분리다.
- 잘못된 값·누락·검색조건 불일치에 대한 FAQ가 별도로 존재하므로 0건, 제외, 미수집, mapping unknown을
  같은 상태로 표현하지 말라.
- 비드큐의 추천구간·낙찰확률·난수/등비 산출과 G2B 전용 A값 공식은 eatbid에 복제하지 말라.

현재 프로토타입의 문제:
1. 기관 과거 조회, 이번 공고 값 결정, 경쟁업체 분석, 산출기를 한 화면에 병렬 배치한다.
2. 상단 차트는 하한 90의 49회인데 기록표와 산출기는 하한 88을 포함한 77회를 함께 사용한다.
3. 낙찰 투찰률·2등값·실효하한·참여 수를 한 차트에 겹쳐 무엇을 읽어야 할지 모호하다.
4. 서로 경쟁구조가 다른 축산·수산·김치 등을 연결선으로 이어 추세처럼 보이게 한다.
5. 77건 중 49건을 사용한 이유와 제외된 28건의 사유가 보이지 않는다.
6. 차트 점을 클릭하면 산출기 후보값이 바뀌어 과거값 추천처럼 느껴진다.
7. “보통 쓰는 자리” 등 산식·기간·표본이 없는 정밀 숫자가 신뢰를 떨어뜨린다.
8. source 관측값, 파생 계산값, 사용자 작성값이 시각적으로 충분히 분리되지 않는다.

절대 조건:
- 화면 target은 Workspace × SupplierParty × AuctionAttempt × selected revision으로 고정한다.
- 기관명·주소·URL 문자열을 identity로 사용하지 않는다.
- 추천값, 추천범위, 안전구간, 낙찰확률, AI 정답을 표현하지 않는다.
- 차트 또는 표를 클릭해 사용자 후보를 자동 입력하지 않는다.
- 차트·분포·표·표본 수·선택 회차가 하나의 동일한 analysis result/member set을 사용한다.
- 관측 사실, 파생 분석, 사용자 후보·결정은 위치·라벨·색으로 구분한다.
- stale, unknown, 표본 부족, 이상치, 계산 불가를 숨기지 않는다.
- 카드가 반복되는 일반적인 SaaS dashboard나 KPI card soup를 만들지 않는다.
- 그래디언트, 과도한 그림자, 장식용 아이콘과 모든 값을 badge로 만드는 표현을 피한다.

필터는 이 디자인의 핵심이다. 필터를 단순한 chip 모음으로 만들지 말라.

필터 계층:
1. 근거 렌즈: [정확한 기관 이력] / [김해시 소재 기관 맥락]
2. 사용자가 조정: 품목 / exact 하한 / 사전 등록 기간
3. 정책이 고정하되 화면에 공개: 입찰방식 / 가격방식 / 금액대 / 기관유형
4. 표시 옵션이며 cohort를 바꾸지 않음: 내 실제 투찰 / 검증된 재구성 2등 표시

필터 규칙:
- 기본은 target과 같은 기관·품목·하한·정책 기간이다.
- 김해시는 eaT 공고지역이나 참가제한지역이 아니라 검증된 구매기관 소재 행정구역이다.
- “전체 품목”은 탐색용으로만 제공한다. 품목별로 분리 표시하고 통합 평균·대표구간·연결선을 만들지 않는다.
- 하한 88과 90을 하나의 요약이나 연결선으로 합치지 않는다.
- 필터 변경은 chart·table·trust funnel을 원자적으로 함께 변경한다.
- 0건이면 조건을 자동으로 넓히지 말고 비교 가능한 기록이 없다는 이유를 표시한다.
- target과 measure가 달라진 필터에서는 사용자 후보 overlay를 끄고 이유를 설명한다.
- 모바일 필터 drawer를 먼저 만들지 말고 1440px desktop의 reading order를 먼저 해결한다.

필수 정보구조:
1. compact target header
   - 공고·차수·revision·선택 사업자·품목·기초금액·명시 하한·마감·eaT 원문
2. filter/query area
   - 위 필터 계층을 사용자가 한 문장 또는 한 reading group으로 이해
3. trust funnel
   - 원천 후보 77건 / 계산 가능 53건 / 최종 포함 49건 / 전체 제외 28건
   - 제외사유, 실제 기간, 현재 공고 사실의 신선도, 과거 분석의 기준시각을 구분
4. evidence surface
   - 기본 주 measure는 source-observed “관측 낙찰 투찰률” 하나
   - X축은 개찰일, 점 하나는 하나의 AuctionAttempt
   - 참여 수는 같은 시간축의 별도 band
   - 동일 품목·동일 하한일 때만 시간 순서를 돕는 얇은 선 허용
5. connected evidence table
   - 개찰일 / 품목 / 기초금액 / 하한 / 관측 낙찰 투찰률 / 검증된 경우 재구성 2등 /
     선택 사업자 실제 투찰 / 참여 / 근거
   - chart point와 동일 회차를 양방향 highlight
6. selected observation inspector
   - 직접 관측값과 파생값의 차이, 계산 가능 여부, source 원문과 raw lineage
7. candidate rail
   - 후보 A/B/C는 빈 상태에서 사용자가 직접 입력
   - 저장된 후보만 opt-in overlay
   - 후보 저장 ≠ 결정 기록 ≠ NeaT 사용자 확인

값의 정확한 언어:
- source fact: “관측 낙찰 투찰률”
- derived fact: “재구성 2등 투찰률 · complete bid-list · formula version”
- source submission: “선택 사업자 실제 투찰”
- app state: “사용자 저장 후보”
- source scope가 불완전하면 빈칸 또는 미제출이 아니라 “관측 불가”

예시 선택 회차:
- 기관: 율하중학교
- 소재지: 경상남도 김해시
- 품목: 축산물
- 하한: 90
- 기간: 최근 24개월
- 개찰일: 2026-08-24
- 관측 낙찰 투찰률: 90.026
- 재구성 2등 투찰률: 90.031
- 선택 사업자 실제 투찰: 90.084
- 참여: 70
- 사용자 저장 후보 A: 90.050

먼저 서로 다른 세 가지 방향을 제안하라:
A. 토스증권형: 한국어 scan-first, 자연어에 가까운 필터, 차분하고 친절한 계층
B. Vercel형: monochrome research workbench, query token, 조밀한 표와 inspector
C. 한국 공공기관형: 명시적 조회조건, 표 우선, 데이터 기준·원천·제외사유 강조

세 방향은 색상만 바꾸지 말고 shell, filter 위치, chart/table 비중, inspector 위치가 실제로 달라야 한다.
각 방향의 장점·위험과 이 사용자에게 맞는 이유를 설명하라.

그 다음 최종 권장안 한 개를 별도로 만들어라. 권장안은 특정 브랜드를 복제하지 말고 다음을 결합한다.
- 토스형의 한국어 인지계층과 자연스러운 filter reading
- Vercel형의 dense workbench, 선택 회차 inspector와 좁은 metadata 문법
- 공공기관형의 표본·제외·기준시각·원천 명시와 정확한 표

필수 산출물:
1. 1440×900 desktop 시안 3개
2. 최종 hybrid 시안 1개
3. 시안마다 filter interaction 설명
4. 화면 영역별 정보 우선순위와 사용자의 시선 흐름
5. normal / 표본 0 / stale / 지역 mapping unknown / 2등 계산 불가 / 내 투찰 관측 불가 상태
6. component inventory와 semantic color 규칙
7. 없애거나 후순위로 보낼 현재 기능 목록

디자인 완료 기준:
- 사용자가 30초 안에 “77건 중 왜 49건이 포함됐는지” 설명할 수 있다.
- 이 화면이 다음 낙찰값·추천값·안전구간을 말한다고 오해하지 않는다.
- 임의 chart point에서 같은 표 행과 eaT 원문까지 2회 이내 도달한다.
- 필터가 chart·표·표본 수에 동일하게 적용됐음을 사용자가 확인할 수 있다.
- 점을 클릭해도 후보가 바뀌지 않는다.
- 직접 관측값과 파생 2등값, 사용자 후보를 구분할 수 있다.
```

## 함께 전달할 자료

우선순위대로 첨부한다.

1. 현재 실제 화면 캡처: [`../../eatbid-analysis-yulha.png`](../../eatbid-analysis-yulha.png)
2. 현재 내부 시안: [`mockups/analysis-detail-v1.png`](mockups/analysis-detail-v1.png)
3. 현재 화면 계약: [`screen-system.md`](screen-system.md)
4. 분석 의미 계약: [`decision-support.md`](decision-support.md)
5. 비드큐 화면 자료: [`../evidence/competitors/bidq-and-info21c/README.md`](../evidence/competitors/bidq-and-info21c/README.md)
6. 비드큐 FAQ 도메인 분석: [`../evidence/competitors/bidq-and-info21c/faq-domain-language.md`](../evidence/competitors/bidq-and-info21c/faq-domain-language.md)
7. 제품 방향 evidence:
   [`2026-08-31 분석 우선 제품기획 심층검증`](../evidence/product-direction/2026-08-31-analysis-first-planning-audit.md)

현재 실제 화면 캡처가 브리프 경로와 다르면 repository root의
`eatbid-analysis-yulha.png`를 직접 첨부한다.

## 요청 순서

한 번에 최종 디자인을 확정하지 않는다.

1. 위 브리프와 자료를 주고 세 방향의 구조만 먼저 받는다.
2. 각 시안에서 `필터를 바꾼 뒤 무엇이 함께 바뀌는지`를 설명하게 한다.
3. 사용자가 선택한 방향으로 hybrid desktop 한 장을 만든다.
4. normal 화면을 승인한 뒤에만 특수 상태와 responsive를 만든다.
5. 승인된 결과를 `screen-system.md`의 canonical 계약과 대조하고 충돌을 제품 결정으로 기록한다.
