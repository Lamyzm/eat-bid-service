import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';

import { BusinessRevokeButton } from './business-revoke-button';

const scope = { principalId: '1', workspaceId: '1' };
const business = {
  businessId: '7',
  businessNumber: '1248100998',
  registeredAt: '2026-09-09T00:00:00Z',
  supplier: { kind: 'linked' as const, supplierPartyId: '9' },
  location: null,
  supplierLabel: '(주)오뚜기축산'
};

function renderButton(canWrite: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BusinessRevokeButton business={business} scope={scope} canWrite={canWrite} />
    </QueryClientProvider>
  );
}

describe('등록 사업자 빼기', () => {
  test('한 번 누르면 바로 빼지 않고 업체명으로 무엇이 빠지는지 묻는다', () => {
    const view = renderButton(true);
    fireEvent.click(view.getByRole('button', { name: '목록에서 빼기' }));
    expect(view.getByText(/\(주\)오뚜기축산을\(를\) 내 사업자에서 뺄까요\?/)).toBeTruthy();
    expect(view.getByRole('button', { name: '빼기' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '취소' }));
    expect(view.getByRole('button', { name: '목록에서 빼기' })).toBeTruthy();
    view.unmount();
  });

  test('업체명이 관측되지 않은 등록은 사업자번호로 무엇이 빠지는지 말한다', () => {
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <BusinessRevokeButton business={{ ...business, supplierLabel: null }} scope={scope} canWrite />
      </QueryClientProvider>
    );
    fireEvent.click(view.getByRole('button', { name: '목록에서 빼기' }));
    expect(view.getByText(/124-81-00998을\(를\) 내 사업자에서 뺄까요\?/)).toBeTruthy();
    view.unmount();
  });

  test('워크스페이스를 바꿀 권한이 없으면 빼기 버튼이 없다', () => {
    const view = renderButton(false);
    expect(view.queryByRole('button', { name: '목록에서 빼기' })).toBeNull();
    view.unmount();
  });
});
