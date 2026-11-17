---
name: reuse-review
description: 바뀐 코드에서 저장소의 공용 모듈(packages/domain·contracts, apps/web shared, 서버 공용 helper)이나 이미 선언한 라이브러리에 있는 것을 손으로 다시 만든 곳을 찾아 "이걸 쓰면 어떨까요"로 제안하는 리뷰. REVIEW.md 리뷰어가 같은 리뷰에서 쓴다. "재사용 리뷰", "reuse review", "이미 있는 함수인지 봐줘"에 쓴다.
---

# 재사용 리뷰

손으로 짠 도우미가 공용 모듈·라이브러리와 겹치는지 본다. **제안**이지 판정이 아니다 — 한 줄짜리 관용구(`reduce` 합 하나,
`Array.from({length})`)는 그대로 둔다. 되풀이되거나 이름 붙은 도우미, 틀리기 쉬운 계산만 올린다. onnuri-attendance 저장소의
같은 이름 절차를 eatbid 경로로 옮겼다(2026-11-17, #218).

## 언제

- [`REVIEW.md`](../../../REVIEW.md) 리뷰어가 같은 리뷰에서 이 점검표를 쓴다(따로 띄우지 않는다).
- 사용자가 부를 때.

## 1. 범위와 목록

- 범위: `git diff --name-only <base>..<head> -- apps packages tools`의 코드 파일. 바뀐 줄 주변만 본다(`git diff -U3`).
- 목록은 **저장소의 결정적 도구에서** 확인한다(추측 금지). `pnpm review:context`가 만드는 review prompt의 재사용 후보 절
  (`tools/review/reuse-catalog.mjs`의 `buildReuseCatalog` — 변경 모듈과 기존 후보, 선언된 라이브러리의 근거)을 먼저 읽는다.
- 라이브러리는 **그 패키지의 `package.json`에 선언된 것만** 제안한다. 다른 의존성을 거쳐 `node_modules`에 깔려 있을 뿐인
  패키지(예: 지금의 `es-toolkit`)를 import하자고 하지 않는다 — 들이는 일은 사용자 결정이다.
- 검사기가 이미 막는 패턴은 다시 말하지 않는다 — 시간(`Temporal.Now`·`Date`), 금액·비율의 원시값, 지역 코드 비교, endpoint
  literal, Web 경계 규칙은 `pnpm architecture:check`·`pnpm lint:web-boundaries`가 본다(루트 AGENTS 15·17·19, ADR 0042).

## 2. 찾을 것

바뀐 코드에서 다음과 같은 **뜻**을 가진 코드를 찾고, 목록의 무엇과 같은지 짝짓는다.

- 값과 단위: 금액 decimal 셈·반올림, 투찰률·하한율·사정률 변환, percentage-point와 ratio, 서울 날짜·시각(Clock 주입) —
  `packages/domain`의 값 타입과 셈이 먼저다.
- 계약: 같은 Zod atom·value를 다시 정의함 — `packages/contracts`의 family에서 `pick`/`omit`/`safeExtend`로(루트 AGENTS 16).
- 모으기·가르기·객체: groupBy·keyBy·partition·chunk·uniq·compact·pick·omit·isEqual — 선언된 라이브러리나 공용 helper.
- 화면: 금액·날짜·건수 표시 형식, 빈 상태·오류 자리, 표·필터 조립 — `apps/web`의 shared 모듈.
- 아직 공용이 없는 화면 부품: 가지가 모달·표·빈 상태·필터 같은 부품을 새로 조립했으면 저장소의 같은 꼴을 grep으로 세어 식과
  수를 적고, 셋 이상이면 "공용으로 올리면 어떨까요"(SHOULD-FIX).

## 3. 보고

한국어 해요체로, 파일:줄과 제안 한 줄씩. 심각도는 둘뿐이다.

```
재사용 리뷰 — <base>..<head>, 바뀐 코드 파일 N개
SHOULD-FIX  apps/web/…/x.ts:42  손으로 금액 반올림 — packages/domain의 금액 셈을 쓰면 어떨까요
NIT         apps/server/…/y.ts:10  0~1 사이로 자르기 — 공용 clamp
없음이면: "공용 모듈·라이브러리와 겹치는 새 코드 없음"
```

- SHOULD-FIX: 되풀이(같은 로직 2곳 이상), 이름 붙은 도우미, 틀리기 쉬운 것(금액·시간대·비율 단위·경계값).
- NIT: 한 번 쓰였고 읽기에 도움이 되는 정도.
- 새 의존성을 더하자는 제안은 하지 않는다 — 선언되지 않은 라이브러리는 "후보"로만 적고 사용자 결정으로 넘긴다.
- 고치지 않는다. 제안만 한다. 고치는 것은 만드는 쪽이 다음 커밋에서.
