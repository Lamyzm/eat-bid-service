# 0017 — 탐색용 server composition의 그린필드 리셋

- Status: Accepted
- Date: 2026-08-30
- Supersedes: ADR 0016의 `LegacyApiModule` 전환 선택지와 `legacy-disposition.md` Gate 5의 server source 제거 시점만 대체

## Context

ADR 0016은 기존 endpoint를 `LegacyApiModule`에 격리한 뒤 canonical route로 점진 교체할 수 있다고
기록했다. 그러나 현재 `apps/server`는 실제 운영 backend 기준선이 아니라 MVP 조사 단계의 코드이며,
root module 한 파일이 controller, 직접 SQL, process-local state, legacy shared schema, 응답 조립을 함께
소유한다. 이를 새 composition root에 연결하면 unrestricted CORS, 개발 secret fallback, 문자열 관계,
guest-on-provider-error 동작까지 새 lifecycle 안에서 계속 실행된다.

현재 사용자가 보는 로컬 서비스는 별도 main worktree/runtime에서 실행 중이고 이 feature worktree의
server를 재시작하거나 배포하지 않는다. Git 이력으로 구현은 완전히 복구할 수 있으며, frontend도
Task 17의 사용자 공동 기획 전에는 변경하지 않는다. 따라서 코드 호환성을 위해 목표 경계를 오염시키는
비용이 보존 가치보다 크다.

## Decision

- Task 16은 기존 `apps/server` controller/auth/db 구현을 새 `AppModule`에 import하지 않는다.
- 삭제 전에 method/path/auth 추정 상태를 포함한 machine-readable route inventory를 생성하고 검토한다.
  이 inventory는 호환 계약이 아니라 Task 17에서 canonical contract와 대조할 조사 자료다.
- 새 server는 health와 한 canonical read vertical slice부터 시작한다. old route alias, translation layer,
  dual-read, dual-write를 만들지 않는다.
- 기존 implementation은 Git 이력으로 보존한다. 현재 로컬 runtime, legacy DB data/table, frontend와 배포
  manifest의 활성 상태는 이 결정만으로 삭제·재시작·이관하지 않는다.
- 사용자 상태 이관은 계속 `legacy-disposition.md` Gate 4의 dry-run/report/approval을 요구한다. data table,
  scheduler, raw evidence의 제거는 Gate 5를 그대로 따른다.
- feature branch server image를 live 환경에 배포하는 것은 Task 16 완료를 넘어선 별도 사용자 승인 사항이다.

## Consequences

- 새 composition root의 모든 실행 경로가 ADR 0016의 Nest/Effect/Drizzle 경계를 처음부터 지킨다.
- 기존 frontend는 새 server와 당장 호환되지 않는다. 이는 숨기지 않고 route inventory와 Task 17의
  사용자 공동 API/UI cutover 계획에서 해결한다.
- legacy route의 회귀 테스트를 새 server에 유지하지 않는다. 대신 canonical contract, OpenAPI artifact,
  architecture test가 새 기준선이다.
- 코드 삭제는 Git으로 복구 가능하지만, legacy 데이터나 실행 환경에 대한 파괴적 조치는 여전히 금지된다.

## Rejected alternatives

- giant root module을 그대로 `LegacyApiModule`로 이름만 변경: import 시점 DB/Auth singleton과 직접 SQL이
  계속 살아 있어 격리가 아니다.
- handler를 파일별로 기계 분할한 뒤 순차 정리: dependency direction과 공개 계약을 고치지 못한 채
  변경량만 늘어난다.
- old/new route를 dual-write: 권위 저장소와 실패 의미가 둘로 갈라진다.
- 현재 로컬 서비스를 새 branch server로 즉시 교체: frontend/API cutover와 사용자 승인 없이 실행 상태를
  변경한다.
