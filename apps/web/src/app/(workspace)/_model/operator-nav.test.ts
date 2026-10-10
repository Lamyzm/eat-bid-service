import { describe, expect, test } from 'bun:test';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';

import { operatorNavGroup } from './operator-nav';

const active = (operator: boolean): CurrentSessionV1Response => ({
  state: 'active',
  account: { displayName: null, maskedEmail: null },
  principalId: '4',
  workspace: { workspaceId: '4', name: '내 워크스페이스', role: 'owner' },
  operator
});

describe('운영자 탐색 묶음', () => {
  test('운영자 세션이면 내 투찰 묶음에 오늘 투찰 하나를 낸다', () => {
    expect(operatorNavGroup({ kind: 'session', response: active(true) })).toEqual({
      label: '내 투찰',
      items: [{ title: '오늘 투찰', url: '/work', icon: 'post', isActive: false, items: [] }]
    });
  });

  test('운영자가 아니거나 세션이 활성이 아니면 묶음이 없다', () => {
    expect(operatorNavGroup({ kind: 'session', response: active(false) })).toBeNull();
    expect(operatorNavGroup({ kind: 'session', response: { state: 'unauthenticated' } })).toBeNull();
    expect(operatorNavGroup({ kind: 'auth-unavailable' })).toBeNull();
  });
});
