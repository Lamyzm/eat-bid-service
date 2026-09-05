# eatbid 지식 지도

이 파일은 `docs/`의 목차이자 문서 권위 지도다. 문서를 찾을 때 파일명 검색부터 하지 말고
먼저 이 지도를 따라간다. 같은 질문에 답하는 권위 문서를 둘 이상 만들지 않는다.

## 1. 가장 먼저 읽을 것

| 질문 | 권위 문서 |
|---|---|
| 저장소에서 반드시 지킬 규칙은 무엇인가? | [`../AGENTS.md`](../AGENTS.md) |
| 목표 시스템은 어떻게 구성되는가? | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| 제품이 어디로 가고 무엇을 먼저 만드는가? | [`product/roadmap.md`](product/roadmap.md) |
| 분석이 어떤 질문·cohort·품질·replay 계약을 지키는가? | [`product/decision-support.md`](product/decision-support.md) |
| 각 화면에서 무엇을 보고 어떤 행동을 하는가? | [`product/screen-system.md`](product/screen-system.md) |
| 문서를 AI 작업의 입력과 결과로 어떻게 운영하는가? | [`governance/ai-driven-documentation.md`](governance/ai-driven-documentation.md) |
| 확정된 아키텍처 결정과 변경 방법은 무엇인가? | [`adr/README.md`](adr/README.md) |
| 데이터·런타임·품질 경계는 무엇인가? | [`architecture/README.md`](architecture/README.md) |
| 운영자가 실제로 무엇을 실행하는가? | [`operations/`](operations/) |
| Codex와 Claude가 Linear 작업 상태를 어떻게 공유하는가? | [`operations/linear-agent-workflow.md`](operations/linear-agent-workflow.md) |
| Codex와 Claude가 구현을 번갈아 맡을 때 어떻게 안전하게 인계하는가? | [`operations/linear-agent-workflow.md#7-codex와-claude-사이-작업-인계`](operations/linear-agent-workflow.md#7-codex와-claude-사이-작업-인계) |
| 비밀은 Infisical의 어느 환경·경로에 있고 어떻게 주입하는가? | [`operations/infisical.md`](operations/infisical.md) |
| push한 코드가 어떻게 이미지가 되고 클러스터까지 가는가? | [`operations/main-authority-cutover.md`](operations/main-authority-cutover.md) |
| 분석 우선 제품기획은 어떤 증거와 반증을 거쳤는가? | [`evidence/product-direction/2026-08-31-analysis-first-planning-audit.md`](evidence/product-direction/2026-08-31-analysis-first-planning-audit.md) |

`AGENTS.md`는 헌법과 지도이고 백과사전이 아니다. 제품·아키텍처·실행계획의 상세 내용을
`AGENTS.md`에 복사하지 않는다.

## 2. 문서 종류와 수명

| 종류 | 위치 | 변경 규칙 |
|---|---|---|
| 제품 방향·로드맵 | `docs/product/` | 살아 있는 문서. 같은 주제의 새 파일을 만들지 말고 기존 권위 문서를 갱신한다. |
| 작업 scope·상태 | Linear issue + project | 담당·상태·blocker·acceptance의 유일한 동적 원천이다. Markdown과 GitHub Issue에 복사하지 않는다. |
| 중대형 행동 변경 | 향후 OpenSpec change | 현재 변경의 delta만 기록한다. 작은 변경과 기존 시스템 전체에 강제하지 않는다. |
| 목표 아키텍처 | `docs/architecture/` | 구현과 다르다고 코드에 맞춰 조용히 바꾸지 않는다. 결정 변경은 ADR이 먼저다. |
| 결정 기록 | `docs/adr/` | Accepted ADR은 수정해 결론을 뒤집지 않는다. 새 ADR이 이전 ADR을 대체한다. |
| 운영 절차 | `docs/operations/` | 실제 실행 절차와 동기화한다. 실행할 수 없는 설명은 제거하거나 상태를 표시한다. |
| 조사·감사 증거 | 현재 `AUDIT-*`, `GATE-*`, `audit-source/`, `evidence/` | 관측 당시의 증거다. 제품·아키텍처 권위 문서가 아니다. 사실이 채택되면 권위 문서나 ADR로 승격한다. |
| 생성 문서 | 향후 `docs/generated/` | 코드·스키마에서 다시 만든다. 사람이 직접 편집하지 않는다. |
| 구현 계획 | `docs/superpowers/plans/` 등 | 실행 당시 기록으로 보존한다. 완료 후 현재 상태나 작업 status의 원천으로 사용하지 않는다. |

## 3. 현재 문서 더미의 판정

2026-08-30 기준 `docs/`에는 84개 파일, 루트 Markdown 30개, `SPEC-*` 11개가 있다.
다수는 레거시 조사, 초안, 실행 중 기록이 같은 깊이에 섞여 있어 파일명만으로 권위를 판단할
수 없다.

당장은 기존 파일을 대량 이동하거나 삭제하지 않는다. 사용자 변경, 외부 링크, 과거 세션의
참조를 보호하기 위해 다음처럼 취급한다.

- `docs/architecture/`, `docs/adr/`, 이 지도가 연결한 제품 문서는 현재 권위 문서다.
- 기존 `docs/SPEC-*`, `docs/ARCH-*`, `docs/PLAN-*`, `docs/CONTEXT-PACK.md`는 현행 조사·초안이다.
- 기존 초안에서 유효한 사실은 새 권위 문서에 출처와 함께 승격한다.
- 승격이 끝난 문서는 후속 정리 작업에서 `docs/archive/`로 옮기고 상단에 대체 문서를 적는다.
- 새 기능을 기존 루트 `SPEC-*` 파일이나 별도의 Markdown task board로 추가하지 않는다.

## 4. AI 세션 읽기 순서

모든 기능 작업은 필요한 만큼만 점진적으로 읽는다.

1. `AGENTS.md`
2. `AGENTS.md`가 지정한 필수 순서대로 `ARCHITECTURE.md`, product/quality, domain/data,
   C4, runtime/deployment, arc42, ADR index를 읽는다.
3. 이 파일 `docs/README.md`
4. Linear issue의 문제·scope·acceptance와 writing owner를 확인한다.
5. `docs/product/roadmap.md`의 해당 capability와 outcome gate를 확인한다.
6. 존재할 때만 해당 OpenSpec delta를 읽는다.
7. 영향받는 세부 아키텍처 문서와 Accepted ADR을 다시 좁혀 읽는다.
8. 구현에 필요한 active plan을 읽는다.

관련 없는 감사 문서와 과거 계획을 한꺼번에 컨텍스트에 넣지 않는다.

## 5. 다음 문서 정리 작업

1. 기존 30개 루트 Markdown에 `authoritative | evidence | superseded | archive-candidate`를 부여한다.
2. 살아 있는 delivery work는 Linear issue에 연결하고 중대형 행동 변경만 OpenSpec 파일럿 후보로
   분류한다.
3. 완료된 실행계획이 현재 상태처럼 읽히지 않도록 history임을 표시한다.
4. 링크·마지막 검토일·중복 권위를 검사하는 `docs-lint`를 CI에 추가한다.
5. 정기 doc-gardening 작업이 오래된 문서와 코드 불일치를 보고하게 한다.
