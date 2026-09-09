import { describe, expect, mock, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

import { accountQueries } from '@/api/account';
import type { AccountSessionView } from '@/capabilities/account';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';

let view: AccountSessionView = {
  session: undefined,
  isPending: true,
  error: null,
  principalId: null,
  refetch: () => undefined
};

// 세션 상태에 따른 분기만 검증하므로 provider 왕복 대신 계약 union을 직접 주입한다.
mock.module('@/capabilities/account', () => ({
  useAccountSession: () => view,
  signOutAndDiscardAccountCache: async () => undefined
}));

const { SetupScreen } = await import('./setup-screen');

const registered = [
  {
    businessId: '7',
    businessNumber: '1248100998',
    registeredAt: '2026-09-09T00:00:00Z',
    supplier: { kind: 'linked' as const, supplierPartyId: '9007199254740995' },
    location: { addressText: '서울특별시 중구 세종대로 110', updatedAt: '2026-09-09T00:00:00Z' }
  },
  {
    businessId: '8',
    businessNumber: '2208162517',
    registeredAt: '2026-09-09T00:00:00Z',
    supplier: { kind: 'unobserved' as const },
    location: null
  }
];

function show(next: Partial<AccountSessionView>, returnPath?: string) {
  view = { session: undefined, isPending: false, error: null, principalId: null, refetch: () => undefined, ...next };
  // 네트워크 없이 목록 상태를 그리기 위해 계약 응답을 캐시에 직접 심는다.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (next.session?.state === 'active') {
    client.setQueryData(
      accountQueries.businesses({
        principalId: next.session.principalId,
        workspaceId: next.session.workspace.workspaceId
      }).queryKey,
      { businesses: registered }
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <SetupScreen returnPath={returnPath} />
    </QueryClientProvider>
  );
}

const account = { displayName: '김이름', maskedEmail: 'k***@example.com' };

const active: CurrentSessionV1Response = {
  state: 'active',
  account,
  principalId: '9007199254740993',
  workspace: { workspaceId: '11', name: '내 워크스페이스', role: 'owner' }
};

describe('설정 화면 상태', () => {
  test('미로그인이면 등록 화면 대신 로그인 안내와 복귀 경로를 담은 링크를 보여 준다', () => {
    const screen = show({ session: { state: 'unauthenticated' } });

    expect(screen.container.textContent).toContain('로그인이 필요합니다');
    expect(screen.container.querySelector('a')?.getAttribute('href')).toBe('/login?next=%2Fsetup');
  });

  test('초기화 미완료는 미로그인과 다른 화면이며 명시적 시작 버튼을 보여 준다', () => {
    const screen = show({ session: { state: 'uninitialized', account } });

    expect(screen.container.textContent).toContain('시작하기');
    expect(screen.container.textContent).not.toContain('로그인이 필요합니다');
    // 내부 사정을 화면에 설명하지 않는다.
    for (const banned of ['초기화', '워크스페이스가 만들어집니다', '의존성']) {
      expect(screen.container.textContent).not.toContain(banned);
    }
  });

  test('보던 화면이 있으면 설정에서 그 화면으로 돌아가는 링크를 보여 준다', () => {
    const screen = show({ session: active, principalId: active.principalId }, '/auctions/5796468');

    const links = [...screen.container.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toContain('/auctions/5796468');
    expect(screen.container.textContent).toContain('공고로 돌아가기');
  });

  test('돌아갈 화면이 없으면 복귀 링크를 만들지 않는다', () => {
    const screen = show({ session: active, principalId: active.principalId });

    expect(screen.container.textContent).not.toContain('돌아가기');
  });

  test('활성 세션은 등록 입력과 서버가 돌려준 등록 목록을 보여 준다', () => {
    const screen = show({ session: active, principalId: active.principalId });

    expect(screen.container.textContent).toContain('사업자 등록');
    expect(screen.container.querySelector('input')?.getAttribute('placeholder')).toContain('숫자 열 자리');
    expect(screen.container.textContent).toContain('124-81-00998');
    expect(screen.container.textContent).toContain('220-81-62517');
  });

  test('미관측 등록을 참여 기록 없음으로 바꿔 말하지 않는다', () => {
    const screen = show({ session: active, principalId: active.principalId });

    expect(screen.container.textContent).toContain('수집 원본에 아직 이 번호가 없습니다');
    expect(screen.container.textContent).toContain('수집 원본에서 이 번호를 확인했습니다');
    for (const banned of ['참여 기록 없음', '확인된 사업자', '미참여']) {
      expect(screen.container.textContent).not.toContain(banned);
    }
  });

  test('저장된 주소는 입력에 복원되고 미설정 등록은 빈 입력으로 남는다', () => {
    const screen = show({ session: active, principalId: active.principalId });
    const addresses = [...screen.container.querySelectorAll('input')].slice(1);

    expect(addresses.map((input) => (input as HTMLInputElement).value)).toEqual([
      '서울특별시 중구 세종대로 110',
      ''
    ]);
    expect(screen.container.textContent).toContain('주소 지우기');
  });

  test('member는 등록 입력이 비활성이고 이유를 문장으로 말한다', () => {
    const screen = show({
      session: { ...active, workspace: { ...active.workspace, role: 'member' } },
      principalId: active.principalId
    });

    expect(screen.container.textContent).toContain('등록과 주소 변경은 관리자만 할 수 있습니다');
    expect(screen.container.querySelector('input')?.hasAttribute('disabled')).toBe(true);
  });
});
