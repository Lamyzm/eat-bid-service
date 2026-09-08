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
