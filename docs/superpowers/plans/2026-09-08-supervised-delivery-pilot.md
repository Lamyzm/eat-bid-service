# Codex 총괄·Claude 구현 파일럿 실행 계획

> 실행자는 공통 `eatbid-supervised-delivery` 절차를 적용한다. 사용자가 위임 실행을 승인했다.

**목표:** 같은 결정 원문으로 작은 UI 변경을 Claude가 구현하고 Codex가 dev에서 인수하는 과정을 검증한다.
**구조:** 기존 Linear·worktree lease·저장소 hooks·공통 AI review를 재사용한다.
**도구:** Claude Code CLI 구독 세션, pnpm, 기존 shadcn/테이블, 브라우저.
**기준:** `docs/governance/ai-driven-documentation.md` 7절과 `docs/product/notice-design-fidelity.md`.
**시작:** UI `d92a012e4ed58b500f17e8b5977bcdaa5d8f2452`. EAT-107은 절차, EAT-115는 표 구현을 소유한다.

## 변경 소유권

- 총괄: AGENTS 진입 링크, 기존 governance 7·10절, canonical delivery Skill과 생성 projection, 이 계획.
- Claude: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/history-table.tsx`,
  `_ui/expand/history-expand-table.tsx`, 대응 `history-table.test.tsx`, `expand/decision-expand.test.tsx`.
- 새 DB·API·차트·전역 shell 변경은 이 파일럿에 포함하지 않는다.

## 순서와 판정

- [x] 기존 실패를 바탕으로 읽기 전용 상황 시험을 한다. baseline은 계약 drift와 실제 데이터 차이는
  식별했지만 동일 viewport의 live 비교만 제시하고 고정 fixture 비교를 빠뜨렸다.
- [x] 공통 절차와 진입 링크를 작성하고 projection check 및 같은 상황의 재검토를 한다.
  재검토에서 고정 fixture와 live 검증을 독립 요구했다. projection/agent-config 11개와 quality check를 통과했다.
- [x] EAT-115를 기존 M1에 연결하고 별도 worktree에서 Claude가 직접 claim한 뒤 구현을 시작한다.
  최초 lease 전 복합 명령이 실제 hook에 차단되었고, 순차 claim·doctor 후 수정으로 이어졌다.
- [ ] 두 표에서 제거 요청한 열이 없고 기록 진입이 같은 attempt를 선택하는 회귀를 확인한다.
  기존 낙찰·2등 정밀도, 참여 명단, 필터가 유지되어야 한다.
- [ ] 관련 단위 테스트·typecheck·lint·quality 뒤 공통 AI advisory와 총괄 diff 검토를 수행한다.
- [ ] dev 통합 후 실제 공고 89/5270의 기록을 확인한다. 고정 fixture UI 비교의 수행 여부를 별도로 보고한다.
- [ ] Linear 기존 실행 문서에 역할·다음 순서·Git 기준을 연결한다. 구현/통합/배포/사용자 인수를 분리한다.

## 범위를 넘는 조건

문서 hash는 의미 이해를 인증하지 않는다. 누락·대체·중간 변경·권한 오류의 양 클라이언트 자동 검증은
EAT-107의 별도 미완료 acceptance다. 이번 파일럿이 통과해도 모두 자동 강제한다고 보고하지 않는다.
다음 인프라 검증은 EAT-110의 기존 미커밋 복구 작업을 먼저 읽고 별도 소유권을 확보한 뒤 진행한다.

## 첫 실행에서 확인한 운영 결함

- 첫 Claude 실행은 541초 후 50턴 제한에 도달했다. 네 파일의 수정과 269개 테스트 통과는 남았으나
  커밋·인계를 마치지 못했다. 성공한 위임 완료로 세지 않는다.
- 설치 전 테스트와 허용하지 않은 복합 명령·추가 format 확인이 반복되었다. 같은 세션 재개에는
  누락 검사를 정확한 작업 경로의 개별 명령으로 지정하고, 이미 통과한 검사를 다시 넓히지 않았다.
- 도구 기록에 필수 아키텍처 원문 조회가 빠져 있었다. 원문을 실제 경로로 명시해 재개에서 보완하고
  의미 적용 예시를 요구했다. 현재 참조 gate는 총괄의 수동 확인이며 자동 강제 완료가 아니다.
- 사용량은 첫 실행의 cache creation 118,443 / cache read 4,529,565 / output 24,578 tokens가
  CLI에 보고되었다. 반복 context를 포함한 수치로 실제 청구액이나 Codex 대비 절감률이 아니다.
- 운영 문서의 canonical AI advisory는 Claude timeout으로 결과를 받지 못했다. projection/quality와
  읽기 전용 절차 검토 통과를 AI 코드 리뷰 성공으로 바꿔 쓰지 않는다.
