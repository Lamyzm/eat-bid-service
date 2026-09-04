# 0031 — 결정 화면의 상태 소유·렌더링·표 전략

- Status: Accepted
- Date: 2026-09-04
- 관계: `0023`(web 모듈 경계와 상태 소유)을 결정 화면에 구체화한다. `0028`(Cache Components)의
  Suspense/searchParams 규칙은 그대로 구속한다. `0030`이 정한 우선순위(경쟁자 수·승률 곡선)를 화면
  순서의 근거로 쓴다.
- 근거: `docs/product/decision-screen-v2/architecture.md`, `spec-decision-screen-v2.md`,
  design-generators의 Merged1440·Real1440·LargeCohort 아트보드

## Context

EAT-36은 결정 화면의 셸(헤더·상태 배너·투찰 레일·빈 근거 영역)만 전달했다. 디자인이 요구하는
호가창(낙찰률 분포 ladder), 흐름(회차별 낙찰률 선), 과거 회차 표, 대형 코호트 표는 아직 없고,
그것을 어떤 상태 소유·렌더링·표 방식으로 만들지 결정되지 않았다. 레거시 web에는 recharts,
lightweight-charts, shadcn data-table(TanStack Table) 래퍼, zustand가 남아 있어 결정 없이 붙이면
`0023`이 금지한 "한 곳에 모든 상태" 형태로 되돌아간다.

규모 전제(실측): 개찰완료 공고 월 12,254건, 5년 약 74만 공고, 공고당 입찰 약 90행. 화면 하나가
클라이언트로 받는 행은 호가창 ≤ 25단, 흐름 ≤ 60점, 과거 회차 12행(더 보기로 페이지), 대형
코호트/업체 명단 ≤ 수백 행이다. 수천만 행은 mart에서 집계되어 화면에 오지 않는다.

## Decision

1. **필터(모집단·기간·품목)는 URL이 소유한다.** `nuqs`만 사용한다. RSC는 `nuqs/server` loader로
   읽고, 클라이언트 칩은 `useQueryStates`로 쓴다. React Context, zustand, browser storage로 필터를
   들지 않는다. 링크 공유와 뒤로 가기가 곧 상태 복원이다.
2. **첫 화면 데이터는 RSC가, 상호작용 갱신은 TanStack Query가 맡는다.** 근거 영역(호가창·흐름·
   과거 회차)은 Suspense leaf에서 `api/_transport`로 계약 응답을 parse해 서버에서 렌더한다.
   클라이언트가 다시 부르는 것은 내 기록 저장·복사·새로고침처럼 사용자 행위가 있는 경우뿐이며
   그때만 `queryOptions`를 노출한다. Provider는 shell의 QueryClient와 theme 둘로 제한한다.
3. **호가창과 흐름은 우리가 소유한 inline SVG/HTML 컴포넌트로 그린다.** recharts와
   lightweight-charts는 새 코드에서 import하지 않고, legacy disposition Gate에서 제거한다.
   이유: 25단·60점 규모에 차트 라이브러리는 번들과 스타일 통제 비용만 크고, `currentColor`
   테마, tabular-nums, 내 값 행 강조, 키보드 접근을 디자인대로 맞추려면 직접 그리는 편이 짧다.
   축·눈금·표본 수·산출 시각은 컴포넌트 props로 받아 `AGENTS.md` 7항을 화면에서 만족한다.
4. **표는 TanStack Table headless만 쓰고 렌더는 우리 table primitive로 한다.** shadcn data-table
   래퍼(`components/ui/table/*`, `use-data-table`)는 재사용하지 않는다. 정렬·열 정의·행 모델만
   TanStack에 맡기고, 페이지는 URL cursor(`nuqs`)가 소유한다.
5. **가상화는 측정된 행 수가 100을 넘는 표에만 붙인다.** 과거 회차(12행)와 호가창은 가상화하지
   않는다. 대형 코호트·업체 명단이 100행을 넘는 것이 계약 응답으로 확인되면 그 표에만
   `@tanstack/react-virtual`을 추가하고, 추가 시점에 행 수와 렌더 시간을 이 ADR에 기록한다.
6. **컴포넌트는 route-private에서 시작한다.** `(workspace)/auctions/[auctionId]/_ui`에 두고, 두
   번째 route가 실제로 쓸 때만 `shared/ui`로 승격한다(`0023`).
7. **캐시 태그는 공고와 mart 발행 단위로 건다.** 근거 영역은 `use cache` + `cacheTag('auction:<id>')`
   와 `cacheTag('mart:<release>')`를 쓰고, ingest가 검증된 실행 단위를 발행할 때만 revalidate한다.
   부분 수집으로 현재 뷰를 덮지 않는다(`AGENTS.md` 변경 절차).

## Consequences

- 필터가 URL에 있으므로 서버 컴포넌트가 필터별로 캐시 키를 갖는다. 모집단 4종 × 기간 4종 ×
  품목 수만큼 캐시 항목이 늘지만 각 항목은 작다.
- 차트 라이브러리 두 개와 data-table 래퍼가 제거 대상이 된다. 제거는 legacy-disposition Gate
  3–5에서만 한다.
- 가상화를 미루므로 대형 표는 처음엔 페이지네이션으로만 다룬다. 100행 초과가 확인되면 그때
  붙인다.
- 잘못됐을 때 비용: 직접 그린 차트가 디자인 변경마다 손이 간다. 대신 디자인 생성기
  (`design-generators/*.py`)의 좌표 규칙을 컴포넌트가 그대로 따르므로 변경 지점은 한 곳이다.

## 화면 조각과 계약 대응

| 화면 조각 | 계약 | 렌더 | 상태 |
| --- | --- | --- | --- |
| 헤더 칩(품목·기간·모집단) | — | client, nuqs | URL |
| 상태 배너 | `auctions.find` | RSC | — |
| 호가창 | 낙찰률 분포(EAT-38) | RSC → inline SVG/HTML | URL 필터 |
| 흐름 | 기관 회차 이력(EAT-37) | RSC → inline SVG | URL 필터 |
| 과거 회차 표 | 기관 회차 이력(EAT-37) | RSC → TanStack Table headless | URL cursor |
| 대형 코호트/업체 명단 | EAT-39 | TanStack Table (+virtual, 측정 후) | URL cursor |
| 투찰 레일·내 기록 | 내 기록 port(EAT-40) | client, TanStack Query | local + server |
