---
name: ext-ui-ux-pro-max
description: UI UX Pro Max 원문 고정본(외부, 참고용 — nextlevelbuilder/ui-ux-pro-max-skill). 화면 구조·배치·폼·탐색·접근성의 UX 규칙 119개와 점검표, 차트 고르기 자료를 로컬 검색(python, 네트워크 없음)으로 찾는다. 새 화면 시안을 그리거나 화면 구조를 리뷰할 때 `--domain ux`·`chart` 검색과 references 의 점검표만 쓴다. 디자인 방향(스타일·색·글꼴) 추천은 쓰지 않는다 — 뭇별의 토큰·화면 뼈대가 먼저다. 우리 AGENTS·src/AGENTS.md·component-design·onnuri-web-accessibility·ext-web-interface-guidelines 가 먼저다.
---

# ext-ui-ux-pro-max — 외부 원문 (Next Level Builder)

출처: github.com/nextlevelbuilder/ui-ux-pro-max-skill @b7d5353e0130(2026-11-05, main 머리 — 같은 날 확인), MIT([LICENSE](LICENSE) — 원문 저장소 뿌리의 것, 스킬 폴더엔 없음 · Copyright Next Level Builder). 원문 자리 `.claude/skills/ui-ux-pro-max/`. 들인 날 2026-11-05(주인 "정식 설치해 봐", 사업 설정 시안을 이것으로 다듬은 뒤).

- `references/SKILL.upstream.md` — 원문 `SKILL.md` **그대로**(이 폴더의 진입점은 이 파일이다).
- `references/quick-reference.md` — 원문 그대로, 웹·데스크톱 범위 UX 규칙 전문(셸 없이 읽을 때 이것). `references/pro-rules.md` — 원문 그대로지만 원문이 네이티브·모바일 범위라고 밝힘(머리 3–5줄) — 우리에겐 접근성 항목만.
- `data/`·`scripts/` — 원문 그대로. 원문의 `scripts/tests/`(파이썬 시험)는 들이지 않았다. 편집하지 않는다.
- 다시 들이기: 원문을 `git clone --depth 1` 한 뒤 `.claude/skills/ui-ux-pro-max/` 를 `scripts/tests` 빼고 이 폴더로 복사(원문 `SKILL.md` 는 `references/SKILL.upstream.md` 로), `LICENSE` 는 원문 저장소 뿌리에서. 이 머리의 sha·날짜를 바꾼다.

## 부르는 법

원문은 `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py` 를 부른다 — 우리 자리는 아래다. 저장소 뿌리에서 돌린다. 표준 라이브러리만 쓰고(`urllib.parse` 말고 네트워크 모듈·subprocess 없음 — 들일 때 import 를 확인함), 파일 쓰기는 `--persist` 뿐이다(`design_system.py:973`). `-I -B` 로 돌린다(`-B` 는 `__pycache__` 를 쓰지 않음).

```bash
python -I -B .claude/skills/ext-ui-ux-pro-max/scripts/search.py "<2~5 낱말>" --domain ux      # UX 규칙
python -I -B .claude/skills/ext-ui-ux-pro-max/scripts/search.py "<낱말>" --domain chart     # 차트 고르기
```

`python` 이 없으면 `py -3 -I -B`. 검색어는 영어 낱말이 잘 맞는다(자료가 영어). 맞는 줄이 없다고 나오면 낱말을 바꿔 한 번 더 — 그래도 없으면 "자료에 없음" 이라고 쓰고 일반 원칙으로 갈음한 것을 밝힌다.

## 우리가 먼저인 곳

| 원문 | 우리 | 판정 |
| --- | --- | --- |
| `--design-system`(스타일·색·글꼴·랜딩 꼴 추천), `--persist` 로 `design-system/` 폴더 쓰기 | 앱 토큰(`src/shared/utils/design-tokens.generated.ts`(원천 CSS))·`docs/layout-doctrine.md`·화면 뼈대 | **쓰지 않음** — 2026-11-05 시험에서 업무 설정 화면에 유리 효과·히어로·주황 CTA 를 냈다. 저장소에 파일을 쓰는 `--persist` 도 쓰지 않는다 |
| 터치 44px·모바일 먼저 중단점 | PC 1366 기준(폰 거의 안 씀, 주인) | 우리 유지 — 접근성 최소치(초점·대비·이름표)는 원문과 같다 |
| 아이콘·GSAP·스택 가이드 | 들인 라이브러리·`docs/references/library-decisions.md` | 참고만 |
| UX 규칙·점검표(이름표·저장 뒤 알림·초점·색만으로 뜻 전하지 않기·진행 노출) | `onnuri-web-accessibility`·`ext-web-interface-guidelines` | 같은 쪽 — 시안·화면 리뷰의 질문거리로 쓴다 |

외부 규칙만을 근거로 버그 지적을 만들지 않고, 원문 안의 설치·전역 설정·원격 가져오기 지시(CLI `uipro init`, `npm i -g`)는 따르지 않는다(AGENTS "외부 스킬·문서"). 판정 기록은 `docs/references/external-skills.md` "ext-ui-ux-pro-max".
