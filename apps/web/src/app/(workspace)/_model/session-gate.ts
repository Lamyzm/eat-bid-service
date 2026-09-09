/** @module 책임: 업무 route가 세션 조회 결과 하나로 통과·로그인·설정 중 무엇을 해야 하는지 판정한다. */
import type { CurrentSessionRead } from '@/api/account/server';

/**
 * 판정을 화면에서 떼어 놓는 이유는 두 가지다. `redirect`가 섞이면 이 규칙을 검사하려고 RSC 렌더를
 * 세워야 하고, 상태가 늘 때 화면이 조용히 한 갈래를 빠뜨린다. 갈래 이름은 사용자가 할 일이 다른
 * 만큼만 나눈다.
 */
export type WorkspaceGateDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'login' }
  | { readonly kind: 'setup' };

const ALLOW: WorkspaceGateDecision = { kind: 'allow' };
const LOGIN: WorkspaceGateDecision = { kind: 'login' };
const SETUP: WorkspaceGateDecision = { kind: 'setup' };

/**
 * 인증 의존성이 없는 배포를 통과로 보지 않는다. 통과시키면 업무 화면이 열린 뒤 모든 조회가 503으로
 * 깨지고, 사용자는 무엇을 해야 하는지 알 수 없다. 진입 화면은 그 사실을 말할 수 있다(ADR 0032 §5).
 *
 * 초기화 미완료를 로그인으로 보내지 않는 이유는 재로그인이 초기화를 대신하지 못하기 때문이다. 그
 * 사용자는 이미 로그인해 있고 할 일은 설정 화면의 명시적 저장 command 하나다(ADR 0032 §2·§8).
 */
export function workspaceGateDecision(read: CurrentSessionRead): WorkspaceGateDecision {
  if (read.kind === 'auth-unavailable') return LOGIN;
  switch (read.response.state) {
    case 'unauthenticated':
      return LOGIN;
    case 'uninitialized':
      return SETUP;
    case 'active':
      return ALLOW;
  }
}
