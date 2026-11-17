---
name: ext-ui-ux-pro-max
description: UI UX Pro Max 원문 고정본(외부, 참고용 — nextlevelbuilder/ui-ux-pro-max-skill). 화면 구조·배치·폼·탐색·접근성의 UX 규칙과 점검표, 차트 고르기 자료를 로컬 검색(python, 네트워크 없음)으로 찾는다. eatbid의 새 화면 시안을 그리거나 화면 구조를 리뷰할 때 `--domain ux`·`chart` 검색과 references의 점검표만 쓴다. 디자인 방향(스타일·색·글꼴) 추천은 쓰지 않는다. apps/web/AGENTS.md·docs/product/screen-system.md·eatbid-web-accessibility가 먼저다.
---

# ext-ui-ux-pro-max — 외부 원문 (Next Level Builder)

출처: github.com/nextlevelbuilder/ui-ux-pro-max-skill @b7d5353e0130(2026-11-05), MIT([LICENSE](LICENSE) — 원문 저장소 뿌리의
것 · Copyright Next Level Builder). onnuri-attendance 저장소가 2026-11-05에 받아 둔 고정본을 2026-11-17에 바이트 그대로
옮겼다(#218).

- `references/SKILL.upstream.md` — 원문 `SKILL.md` **그대로**(이 폴더의 진입점은 이 파일이다).
- `references/quick-reference.md` — 원문 그대로, 웹·데스크톱 범위 UX 규칙 전문(셸 없이 읽을 때 이것).
  `references/pro-rules.md` — 원문 그대로지만 원문이 네이티브·모바일 범위라고 밝힌다. 우리 Web은 휴대폰(390px)에서도 쓰므로
  터치 대상·한 손 조작 항목도 질문거리로 쓴다.
- `data/`·`scripts/` — 원문 그대로. 원문의 `scripts/tests/`는 들이지 않았다. 편집하지 않는다(그래서 `@module 책임:` 검사에서
  뺀다 — `tools/quality/check-korean-comments.mjs`).

## 부르는 법

저장소 뿌리에서 돌린다. 표준 라이브러리만 쓰고 네트워크 모듈·subprocess가 없다. 파일 쓰기는 `--persist`뿐이며 쓰지 않는다.
`-I -B`로 돌린다(`-B`는 `__pycache__`를 쓰지 않음).

```bash
python -I -B .claude/skills/ext-ui-ux-pro-max/scripts/search.py "<2~5 낱말>" --domain ux      # UX 규칙
python -I -B .claude/skills/ext-ui-ux-pro-max/scripts/search.py "<낱말>" --domain chart     # 차트 고르기
```

`python`이 없으면 `py -3 -I -B`. 검색어는 영어 낱말이 잘 맞는다. 맞는 줄이 없으면 낱말을 바꿔 한 번 더 — 그래도 없으면
"자료에 없음"이라고 쓰고 일반 원칙으로 갈음한 것을 밝힌다.

## 우리가 먼저인 곳

| 원문 | 우리 | 판정 |
| --- | --- | --- |
| `--design-system`(스타일·색·글꼴·랜딩 꼴 추천), `--persist`로 `design-system/` 폴더 쓰기 | 앱 토큰·`docs/product/screen-system.md` "시각 문법" | **쓰지 않음** — 업무 도구에 랜딩 꼴 추천이 나온다. 저장소에 파일을 쓰는 `--persist`도 쓰지 않는다 |
| 터치 44px·모바일 먼저 중단점 | 휴대폰 390px과 PC를 모두 쓴다 | **원문 따름** — 390px 폭에서 누를 것은 원문 최소치를 지킨다 |
| 아이콘·GSAP·스택 가이드 | apps/web의 기술 계약 | 참고만 |
| UX 규칙·점검표(이름표·저장 뒤 알림·초점·색만으로 뜻 전하지 않기·진행 노출) | `eatbid-web-accessibility`·`web-design-guidelines` | 같은 쪽 — 시안·화면 리뷰의 질문거리로 쓴다 |
| 차트 고르기(`--domain chart`) | `dataviz` 방법·screen-system의 분포 차트 계약 | 질문거리로만 — 차트 형태 판정은 우리 계약이 정한다 |

외부 규칙만을 근거로 버그 지적을 만들지 않고, 원문 안의 설치·전역 설정·원격 가져오기 지시(CLI `uipro init`, `npm i -g`)는
따르지 않는다. 판정 기록은 [외부 스킬 판정표](../../../docs/governance/external-skills.md).
