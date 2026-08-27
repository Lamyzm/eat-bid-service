# DESIGN.md — eatbid 디자인 시스템 v1 (2026-08-27)

기준: PC 우선(검증 뷰포트 1280 / 1920, 모바일은 후순위). 원장(ledger) 콘셉트 —
한지 톤 냉회색 지면 위 관인 녹색 1개 악센트, 인주 적색은 하한·무효 전용.
모든 색·서체는 `apps/web/src/styles/themes/eatbid.css` 토큰이 진실이다.
화면 코드에 hex를 새로 쓰지 않는다(예외: lightweight-charts 등 CSS 변수를 못 읽는
캔버스 라이브러리 — 아래 D-1의 chart 상수 파일만 허용).

## A. 토큰

### A1. 색 (라이트 기준 — 다크는 eatbid.css .dark 블록이 재정의)
| 토큰 | 값(oklch) | 용도 |
|---|---|---|
| `--background` | 0.982 0.004 140 | 지면(한지 톤 냉회색) |
| `--foreground` | 0.22 0.012 150 | 본문 잉크 |
| `--card` | 1 0 0 | 카드 지면 |
| `--primary` | 0.43 0.085 158 | **관인 녹색** — 낙찰·강조·CTA·차트 메인. 화면당 하나의 악센트 |
| `--secondary` / `--muted` / `--accent` | 0.945~0.93대 | 저강조 지면·뱃지 |
| `--muted-foreground` | 0.5 0.014 150 | 보조 텍스트·축 라벨 |
| `--destructive` | 0.55 0.2 27 | **인주 적색** — 하한선·무효·동가 경고 전용. 다른 데 쓰지 않는다 |
| `--border` / `--input` | 0.9~0.92대 | 구분선·입력 테두리 |
| `--chart-1..5` | 녹/적/**앰버**/회/연녹 | 차트 시리즈. chart-3(0.62 0.1 75)=앰버가 '밀림' 색의 토큰 |

**시맨틱 상태색 (판정 4색)** — 아래 조합 외 금지:
- 낙찰 = `--primary` · 밀림 = 앰버(`--chart-3`, tailwind `text-amber-600` 임시 허용→D-3) ·
  무효/하한 = `--destructive` · 기회/내 값 = 코발트 `#2962ff`(chart 상수, "나"의 색)
- 구경 중(타지역) 경고 = 앰버 테두리+10% 지면 (`border-amber-500/50 bg-amber-500/10`)

### A2. 타이포
- 본문: `--font-sans` Pretendard Variable. 수치: `--font-mono` Geist Mono + `tabular-nums` 필수
- 스케일: 페이지 제목 `text-2xl font-semibold`(고정 — 3xl 금지, welcome 제외) /
  카드 제목 `text-base font-semibold` / 본문 15px(`text-[15px]`) / 보조 `text-sm` /
  각주·축 라벨 `text-xs`(12px 미만 금지)
- **히어로 숫자**: `text-3xl font-bold tabular-nums` — 화면당 정확히 1개 (C표 참조)

### A3. 간격·형태
- radius `--radius` 0.375rem 단일. 카드 그림자 `--shadow-sm` 이하만
- 페이지 패딩 `p-4 md:p-6`, 섹션 간 `space-y-5~6`, 카드 내부 `p-4`(표 카드 `p-0`)
- 나열 구분자 `·` (COPY-GUIDE), em-dash 수사 금지

## B. 패턴

| 패턴 | 규정 |
|---|---|
| 카드 | `Card > CardHeader(pb-2) > CardTitle(text-base)` + 설명은 CardDescription. 표 담는 카드는 `CardContent p-0` + `overflow-x auto` |
| 표 | 헤더 명사형, 수치 열 `text-right tabular-nums`, 강조 행 `bg-primary/5`, 위험 값 `text-destructive`. 400행 이상은 maxHeight+스크롤 |
| 칩/뱃지 | 사실 칩 = `Badge variant=secondary`(품목·건수), 경고 = destructive(마감), 상태 없는 장식 뱃지 금지(해석 라벨 금지 헌법) |
| 필터 버튼 | `Button size=sm` + 선택=default/미선택=outline. 그룹 사이 `<span className='mx-1'/>` |
| 차트(SVG 자작) | strip-chart 방식이 표준: `var(--primary)`/`var(--destructive)` 토큰 사용, 하한선=destructive 2px, 잘 나온 구간=primary 8~10% 음영, n 명시, 직접 라벨(최근 3회), 축 라벨 `--font-mono` 12px+ |
| 차트(lightweight-charts) | CSS 변수 불가 → `lib/chart-colors.ts` 상수만 사용(D-1). 낙찰률=primary hex, 2등가=앰버, 실효하한=회갈, 내 값=코발트 |
| 히어로 숫자 | 카드 좌상단 라벨(text-xs muted) + 아래 `text-3xl font-bold tabular-nums`. 원 단위는 `won()` 콤마 표기 |
| 산출기 | 우측 고정(`xl:sticky xl:top-4`), 모든 차트·표 요소 클릭=값 주입(비드큐 문법) |
| 구경 배너 | 앰버 조합 고정(위 A1) — 문구 "「지역」 구경 중 — 참가 자격은 사무소 소재지 기준입니다." |

## C. 화면당 히어로 숫자 (3초 안에 읽혀야 하는 단 하나)

| 화면 | 히어로 숫자 | 현재 상태 |
|---|---|---|
| 오늘 | (공고 카드) 하한 금액 `기초×하한` | ✅ text-2xl→**3xl로 승급 필요** |
| ② 공고 상세 | 기초금액 (결정 전) → 리허설 판정 (값 입력 후) | ✅ 3xl |
| 분석판 | 리허설 판정 낙찰 수 (값 입력 시) / 미입력 시 최근 낙찰률 | △ 카드 4분할이라 히어로 부재 — 낙찰 칸만 크게 |
| 낙찰(속보) | 최근 N일 개찰 건수 | △ 부제 줄에 묻힘 — 승급 필요 |
| 내 성적 | 낙찰률 % | △ KPI 5칸 동급 — 낙찰률만 3xl |
| 시장 지도 | (지역 상세) 기대낙찰 건/업체 | △ 4칸 동급 — 기대낙찰만 승급 |
| 업체 | 참여 횟수 | ✅ |
| 온보딩 | 참여 N회 (온보딩 폭탄) | ✅ |

## D. 기존 화면 불일치 목록 (수정 백로그)

1. **차트 hex 분산** — `analysis-board.tsx:38-41`(C 팔레트), `auction-detail.tsx:248,306`(#2962ff),
   `market-map.tsx:33-37,91`(bubbleColor·#111·#e5484d): 세 파일이 각자 hex 정의.
   → `apps/web/src/lib/chart-colors.ts` 로 단일화(다크모드 분기 포함 — 현재 #111 마커는 다크에서 안 보임).
2. **포맷터 중복** — `won()` 7개 파일, `eok()` 3개 파일, `CATS` 3개 파일(그나마 값 불일치: market-map엔 '기타' 없음)
   → `apps/web/src/lib/format.ts` 로 통합.
3. **'밀림' 색 임시 클래스** — `text-amber-600` 8곳(auction-detail:209,304 · firms:147 · record:105,120,166 ·
   today:100 · region-switcher:29): 토큰(`--chart-3`) 미사용. → tailwind 유틸 `text-pushed` 정의 or chart-colors 참조.
4. **히어로 숫자 미승급** — C표의 △ 4개 화면.
5. **제목 스케일 혼용** — welcome(text-3xl)은 의도적 예외, 나머지 화면은 2xl 통일 확인됨. 분석판만 xl(text-xl) —
   `analysis-board.tsx` 헤더를 2xl로.
6. **overview/layout.tsx** — 스타터 데모 잔재(제목 4개) 사용 여부 점검 대상(스코프 밖, 리더 판단).

## 레퍼런스 보드 (작업 전 대조)
토스증권 종목 상세(히어로 숫자·상태색), 트레이딩뷰(차트 문법), 네이버페이 증권(표 밀도),
카카오뱅크(여백·카드), 비드큐(정보 밀도·산출기 배선). 스크린샷 수집은 별도 태스크.
