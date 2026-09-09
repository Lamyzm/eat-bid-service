import { describe, expect, it } from 'bun:test';

import { workspaceGateDecision } from './session-gate';

const account = { displayName: '김이름', maskedEmail: 'k***@example.com' } as const;
const workspace = { workspaceId: '1', name: '내 워크스페이스', role: 'owner' } as const;

describe('업무 route 세션 게이트 판정', () => {
  it('미로그인은 로그인 화면으로 보낸다', () => {
    expect(
      workspaceGateDecision({ kind: 'session', response: { state: 'unauthenticated' } })
    ).toEqual({ kind: 'login' });
  });

  it('초기화 미완료는 로그인이 아니라 설정 화면으로 보낸다', () => {
    // 재로그인은 초기화를 대신하지 못한다. 로그인으로 보내면 고칠 수 없는 로그인을 반복한다.
    expect(
      workspaceGateDecision({ kind: 'session', response: { state: 'uninitialized', account } })
    ).toEqual({ kind: 'setup' });
  });

  it('활성 세션만 업무 화면을 통과시킨다', () => {
    expect(
      workspaceGateDecision({
        kind: 'session',
        response: { state: 'active', account, principalId: '7', workspace }
      })
    ).toEqual({ kind: 'allow' });
  });

  it('인증 의존성이 없는 배포는 업무 화면을 열지 않고 진입 화면으로 보낸다', () => {
    expect(workspaceGateDecision({ kind: 'auth-unavailable' })).toEqual({ kind: 'login' });
  });
});
