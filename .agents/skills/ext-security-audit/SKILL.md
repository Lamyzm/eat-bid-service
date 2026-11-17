---
name: ext-security-audit
description: Cloudflare security-audit 원문 고정본(외부) — 신뢰 경계를 넘는 취약점을 원본 근거로 찾고 반증하는 방법(정찰·적용 범위 장부·사냥·독립 검증·보고)과 공격 갈래 자료. eatbid에서 보안이 닿는 diff(로그인·세션·권한·workspace 경계·DB 역할과 마이그레이션 권한·비밀·CI·배포·Nest API·dataplane 수집)를 리뷰할 때 "안내 모드"로 관련 갈래 파일만 읽고, 사용자가 정한 단계에서만 "전체 감사 모드"를 돈다. 루트 AGENTS·ADR·REVIEW.md가 먼저다.
---

# ext-security-audit — 외부 원문 (Cloudflare)

출처: github.com/cloudflare/security-audit-skill @c1c8a8c14710(2026-09-14), MIT([LICENSE](LICENSE), Copyright Cloudflare).
onnuri-attendance 저장소가 2026-10-28에 받아 둔 고정본을 2026-11-17에 바이트 그대로 옮겼다(#218).

- `references/SKILL.upstream.md` — 원문 `skills/security-audit/SKILL.md` **그대로**(이 폴더의 진입점은 이 파일이다).
- `references/*.md` — 원문 갈래 파일 그대로(정찰·사냥·공격 갈래·검증과 보고·영역별 자료).
- `references/report-schema.json`·`validate-*.cjs` — 전체 감사의 결과 꼴과 검사기 그대로. 편집하지 않는다(그래서 `@module 책임:`
  검사에서 뺀다).

## 우리 쓰임 (따르는 차례: 루트 AGENTS·ADR·REVIEW.md > 이 파일 > 원문)

**1. 안내 모드 — 리뷰마다(`REVIEW.md` 1절 "보안 경계" 줄).** 원문 "Operating modes"의 Guidance mode 그대로다. 파일을 만들지
않고, 여섯 단계를 돌지 않고, 바뀐 곳에 닿는 갈래만 읽는다.

| 바뀐 것 | 먼저 열 원문 |
| --- | --- |
| 로그인(Google OAuth·개발 로그인)·세션·쿠키·Nest 인증 가드·운영자 권한 | `WEB-PROTOCOL-AND-AUTH.md`, `ATTACK-CLASSES.md` |
| workspace·사업자 경계, DB 역할(`eatbid_migrator` 등)·마이그레이션 권한, 백업·복원·내보내기 | `DATA-ISOLATION-AND-LIFECYCLE.md`, `ATTACK-CLASSES.md` |
| 공개 API operation·Server Action·내부 호출 | `PROTOCOLS-RPC-AND-MESSAGING.md` |
| GitHub Actions·릴리스 태그·의존성·컨테이너 이미지·Trivy 예외 | `SUPPLY-CHAIN-AND-RELEASE.md` |
| Kubernetes 매니페스트·Argo CD·Argo Workflows·Infisical·R2 | `CLOUD-AND-DEPLOYMENT.md` |
| 요청 한도·수집 동시성·semaphore·비용이 드는 길 | `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` |
| 화면의 HTML 넣기·외부 링크·파일 올리기 | `CLIENT-SIDE.md` |

리뷰어는 원문의 판정 기준을 쓴다 — **확정**은 원본 경로의 추적과 영향받는 주체·자원·보안 결과가 있어야 하고, 모자라면
"확인 필요"(심각도 없이 무엇이 모자란지)로, 반증되면 버린다. 외부 규칙만으로 버그 지적을 만들지 않는다.

**2. 전체 감사 모드 — 정해 둔 단계에서만(GitHub issue).** 원문의 여섯 단계를 돈다. 사용자가 정한 때만 연다 — 원문 "If the
request could mean either mode, ask one focused question"과 같다.
- 결과 자리: 저장소 **밖**. eatbid는 공개 저장소라 감사 결과·재현 경로를 저장소·issue·PR에 그대로 올리지 않는다.
  결과에 실제 사업자 정보·비밀이 들어가지 않게 한다.
- 실행 안전: 원문 "Universal execution safety"를 그대로 지킨다. 대상 코드를 돌릴 격리 상자를 이 PC에서 다 갖추지 못하면
  원본 읽기만 한다. 운영 클러스터(`eatbid-prod`)·운영 DB에는 닿지 않는다.
- 검사기 `validate-*.cjs`는 node로 돌린다(바깥 망·파일 쓰기 없는 순수 검사기). 그 밖에 원문이 시키는 명령 실행·원격 가져오기·
  설정 바꾸기는 따르지 않는다.
