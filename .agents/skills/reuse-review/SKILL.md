---
name: reuse-review
description: 바뀐 코드에서 라이브러리(es-toolkit·es-hangul)나 우리 공용 모듈(docs/reuse-catalog.md)에 이미 있는 것을 손으로 다시 만든 곳을 찾아 "이걸 쓰면 어떨까요" 로 제안하는 리뷰. 리뷰 루프에서 리뷰어가 같은 리뷰로 쓰고, 릴리스 머지 전에 한 번 돌린다. "재사용 리뷰", "reuse review", "es-toolkit 에 있는지 봐줘" 에 쓴다.
---

# 재사용 리뷰

손으로 짠 도우미가 라이브러리·공용 모듈과 겹치는지 본다. **제안** 이지 판정이 아니다 — 한 줄짜리 관용구(`reduce` 합 하나, `Array.from({length})`)는 그대로 둔다. 다만 `[...new Set(x)]`·`x.filter(Boolean)` 은 `uniq(x)`·`compact(x)` 로 고치자고 NIT 로 올린다(주인 2026-10-21 — 고칠 도구가 없어 이 리뷰가 본다, `docs/reuse-catalog.md`). 되풀이되거나 이름 붙은 도우미, 틀리기 쉬운 계산만 올린다.

## 언제

- 리뷰 루프의 리뷰어가 같은 리뷰에서 이 점검표를 쓴다(따로 띄우지 않는다 — code-review-loop "가볍게" 2).
- `/release` 4-2단계: 릴리스 범위(지난 `v` 태그..릴리스 브랜치)로 한 번.
- 사용자가 부를 때.

## 1. 범위와 목록

- 범위: `git diff --name-only <base>..<head> -- src e2e scripts` 의 코드 파일. 바뀐 줄 주변만 본다(`git diff -U3`).
- 먼저 `docs/reuse-catalog.md` 를 읽는다 — 이미 들인 것과 그 주의(groupBy 의 정수 열쇠 차례, isEqual 의 undefined 키)가 있다.
- 쓸 수 있는 것은 **설치본과 도구에서** 확인한다(추측 금지). 셋을 나눠 맡긴다:
  - **es-toolkit** → 설치본 `node_modules/es-toolkit/dist/index.d.ts` 의 export 이름으로 먼저 짝을 찾는다(빠르고 판이 저장소와 같다). 공식 Claude Code 플러그인의 `es-toolkit:recommend` 스킬이 **이 세션의 스킬 목록에 보이면** 애매한 것만 물어 확인한다. 없으면 찾아 헤매지 말고 설치본으로 끝낸 뒤, 보고 끝에 한 줄로 `/plugin install es-toolkit@es-toolkit-plugin` 을 권한다(플러그인 설정은 `.claude/settings.json` 의 `extraKnownMarketplaces`·`enabledPlugins`). 평가(2026-09-29)에서 없는 플러그인을 찾느라 시간이 65% 늘었고 찾은 것은 같았다.
  - **es-hangul** → `npm run reuse:catalog` 의 `# es-hangul` 부분(설치본 `dist/index.d.ts` 의 export 와 설명 한 줄)
  - **우리 공용 모듈** → 같은 `npm run reuse:catalog` 의 `# 우리 공용 모듈` 부분(`src/shared` 의 `utils`·`hooks`(낱개 `shared/{utils,hooks}/` 와 개념 폴더 안 — 날짜·시간은 `shared/time/utils/`)·`src/runtime/<개념>`·`src/domains/<도메인>` 의 셈(이름이 lib — `.tsx`·흐름·React 를 쓰는 파일 빼고) 파일의 `@module 책임:` 한 줄과 export)
- 검사기가 이미 막는 패턴은 다시 말하지 않는다 — 지금 막는 것:
  - 경계 검사: 받침 계산(`batchim-arithmetic`), 날짜 형식 직접 호출(`date-format-owner`), 숫자 형식(`number-format-owner`), 달력 셈(`calendar-math`), 요일 배열(`weekday-literal`), 한글 이름(`hangul-identifier`), 시계 밖의 "지금" — 인자 없는 `new Date()`·`Date.now()`(`ambient-now`), `JSON.stringify` 같음(`json-equality`), 손 묶기(`hand-grouping`), 손 clamp(`hand-clamp`), HH:MM → 분(`local-to-minutes`)
  - oxlint: lodash·underscore·ramda·moment·dayjs·date-fns import, es-toolkit 의 `isDate`(Date 인스턴스 검사 — 날짜 키는 `isDateKey`)(`no-restricted-imports`)
  - 목록은 `scripts/boundaries/rules.mjs`(구문 트리 규칙은 `identifiers.mjs`·`ambient-now.mjs`)·`.oxlintrc.json` 에서 확인한다. 나머지는 이 리뷰가 본다.

## 2. 찾을 것

바뀐 코드에서 다음과 같은 **뜻** 을 가진 코드를 찾고, 목록의 무엇과 같은지 짝짓는다.

- 모으기·가르기: groupBy·keyBy·countBy·partition·chunk·uniq/uniqBy·compact·intersection·difference·zip
- 셈: sum/sumBy·mean·min/maxBy·clamp·range·round
- 객체: pick·omit·mapValues·mapKeys·isEqual·merge·cloneDeep
- 함수: debounce·throttle·once·memoize·delay·retry
- 문자열·검사: kebab/camel/snake 바꾸기, escapeRegExp, isNil·isPlainObject
- 한국어: 조사(josa)·받침(hasBatchim)·수 세기(susa)·초성·숫자 읽기(numberToHangul)
- 우리 것: `docs/reuse-catalog.md` 의 "우리 모듈" 표(서울 날짜·요일·숫자 글·HH:MM 분·날짜 입력·서버 액션 틀·초안·실패 받기…)와 `npm run reuse:catalog` 의 나머지
- 아직 공용이 없는 화면 부품: 가지가 모달·표·빈 상태·저장 바닥 줄·필터·날짜 칸 같은 부품을 새로 조립했으면 저장소의 같은 꼴을 grep 으로 세어 식과 수를 적고, 셋 이상이면 "공용으로 올리면 어떨까요"(SHOULD-FIX) — 목록에 없어 위의 짝짓기로는 못 잡는다(주인 2026-11-05).

## 3. 보고

한국어 해요체로, 파일:줄과 제안 한 줄씩. 심각도는 둘뿐이다.

```
재사용 리뷰 — <base>..<head>, 바뀐 코드 파일 N개
SHOULD-FIX  src/…/x.ts:42  손으로 묶기(map.get ?? [] + push) — es-toolkit `groupBy(items, i => i.programId)` 를 쓰면 어떨까요
NIT         src/…/y.tsx:10  0~1 사이로 자르기 — es-toolkit `clamp(v, 0, 1)`
없음이면: "라이브러리·공용 모듈과 겹치는 새 코드 없음"
```

- SHOULD-FIX: 되풀이(같은 로직 2곳 이상), 이름 붙은 도우미, 틀리기 쉬운 것(깊은 비교·시간대·받침·경계값).
- NIT: 한 번 쓰였고 읽기에 도움이 되는 정도.
- 새 의존성을 더하자는 제안은 하지 않는다 — 목록에 없는 라이브러리는 "후보" 로만 적고 사용자 결정으로 넘긴다.
- 고치지 않는다. 제안만 한다. 고치는 것은 만드는 쪽이 다음 커밋에서.

## 출처

- es-toolkit AI 연동(Claude Code 플러그인, `recommend`·`guide`·`migrate` 스킬): https://es-toolkit.dev/ai-integration.html
- es-toolkit 문서 목록(LLM 용): https://es-toolkit.dev/llms.txt
- 플러그인 마켓 정의: https://github.com/toss/es-toolkit/blob/main/.claude-plugin/marketplace.json (마켓 `es-toolkit-plugin`, 플러그인 `es-toolkit`)
