---
name: ext-security-audit
description: Cloudflare security-audit 원문 고정본(외부) — 신뢰 경계를 넘는 취약점을 원본 근거로 찾고 반증하는 방법(정찰·적용 범위 장부·사냥·독립 검증·보고)과 공격 갈래 자료. 보안이 닿는 diff(인증·세션·권한·RLS·마이그레이션 권한·비밀·CI·배포·apps/api·웹훅)를 리뷰할 때 "안내 모드" 로 관련 갈래 파일만 읽고, 주인이 정한 단계에서만 "전체 감사 모드" 를 돈다. 우리 AGENTS·ADR·REVIEW.md 가 먼저다.
---

# ext-security-audit — 외부 원문 (Cloudflare)

출처: github.com/cloudflare/security-audit-skill @c1c8a8c14710(2026-09-14, main 머리 — 2026-10-28 확인), MIT([LICENSE](LICENSE), Copyright Cloudflare). 들인 날 2026-10-28(주인 "이제부터 검사할 때 이것도 한 번, 계획 중 적절한 단계에 보안 전체 감사").

- `references/SKILL.upstream.md` — 원문 `skills/security-audit/SKILL.md` **그대로**(이름만 바꿈 — 이 폴더의 진입점은 이 파일이다).
- `references/*.md` — 원문 갈래 파일 그대로(정찰 `RECONNAISSANCE`, 사냥 `HUNTING`, 공격 갈래 `ATTACK-CLASSES`, 검증·보고 `VALIDATION-AND-REPORTING`, 영역별 `WEB-PROTOCOL-AND-AUTH`·`DATA-ISOLATION-AND-LIFECYCLE`·`SUPPLY-CHAIN-AND-RELEASE`·`CLOUD-AND-DEPLOYMENT`·`PROTOCOLS-RPC-AND-MESSAGING`·`RESOURCE-EXHAUSTION-AND-AVAILABILITY`·`CLIENT-SIDE`·`AI-AND-LLM` 등).
- `references/report-schema.json`·`validate-*.cjs`(+ 시험) — 전체 감사의 결과 꼴과 검사기 그대로. 편집하지 않는다.

## 우리 쓰임 (따르는 차례: 루트 AGENTS·ADR·REVIEW.md > 이 파일 > 원문)

**1. 안내 모드 — 리뷰마다(REVIEW.md 표의 "보안 경계" 줄).** 원문 "Operating modes" 의 Guidance mode 그대로다: 파일을 만들지 않고, 여섯 단계를 돌지 않고, 바뀐 곳에 닿는 갈래만 읽는다.

| 바뀐 것 | 먼저 열 원문 |
| --- | --- |
| 로그인·세션·쿠키·proxy·Bearer·Nest 인증 가드 | `WEB-PROTOCOL-AND-AUTH.md`, `ATTACK-CLASSES.md` |
| RLS·정책·DEFINER·마이그레이션 권한·지부/기관 경계·보관·복원·내보내기 | `DATA-ISOLATION-AND-LIFECYCLE.md`, `ATTACK-CLASSES.md` |
| oRPC·서버 액션·웹훅·pg-boss 일감 | `PROTOCOLS-RPC-AND-MESSAGING.md` |
| CI 워크플로·릴리스·의존성·Docker 이미지·러너 | `SUPPLY-CHAIN-AND-RELEASE.md` |
| k3s 매니페스트·Argo·OpenTofu·Infisical·방화벽 | `CLOUD-AND-DEPLOYMENT.md` |
| 요청 한도·큐·크론·비용이 드는 길 | `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` |
| 화면의 HTML 넣기·postMessage·외부 링크·파일 올리기 | `CLIENT-SIDE.md` |

리뷰어는 원문의 판정 기준을 쓴다 — **확정**은 원본 경로의 추적과 영향받는 주체·자원·보안 결과가 있어야 하고, 그것이 모자라면 "확인 필요"(심각도 없이 무엇이 모자란지)로, 반증되면 버린다. 외부 규칙만으로 버그 지적을 만들지 않는 것은 REVIEW.md 와 같다.

**2. 전체 감사 모드 — 정해 둔 단계에서만(보드 카드).** 원문의 여섯 단계(정찰 → 적용 범위 장부 → 사냥 → 반증 → 구조화 결과 → 독립 기록 검증 → 보고)를 돈다. 조정자가 묻고 주인이 정한 때만 연다 — 원문 "If the request could mean either mode, ask one focused question" 과 같다.
- 결과 자리: 저장소 **밖**(원문 기본 `~/security-audit-skill/onnuri-attendance/run-<N>`). 결과에 실제 학생 자료·비밀이 들어가지 않게 한다(루트 AGENTS).
- 실행 안전: 원문 "Universal execution safety" 를 그대로 지킨다 — 대상 코드(빌드·시험·서버)를 돌릴 격리 상자(바깥 망 없음·빈 환경·읽기 전용·자원 한도)를 이 PC 에서 다 갖추지 못하면 돌리지 않고 원본 읽기만 한다. 운영 DB·운영 서버에는 닿지 않는다.
- 검사기 `validate-*.cjs` 는 조정자가 node 로 돌린다(원문 그대로의 순수 검사기 — 들일 때 읽음, 바깥 망·파일 쓰기 없음). 그 밖에 원문이 시키는 명령 실행·원격 가져오기·설정 바꾸기는 따르지 않는다(루트 AGENTS "외부 스킬·문서").
- 무거운 일 잠금(루트 AGENTS 검증 칸)과 에이전트 수 상한(세션 워크플로 크기)을 지킨다. 원문의 profile 은 `quick`(첫 번)·`standard`(결제 전)에서 고른다.
