import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { MyAttemptBidObservation, MyBidObservationsV1Response, MyBusinessesV1Response } from '@eatbid/contracts/api/v1/me';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';
import type { AccountSessionView } from '@/capabilities/account/index';
import type { MyBidObservationsInput } from '@/api/account/index';

/**
 * 세션은 계약 union을 직접 주입한다. 한 프로세스가 모든 테스트 파일을 돌리므로 다른 파일이 같은 module을
 * 대역으로 바꿔 두어도 이 파일이 자기 대역을 다시 세워 순서에 매이지 않게 한다.
 */
let view: AccountSessionView = { session: undefined, isPending: true, error: null, principalId: null, refetch: () => undefined };
mock.module('@/capabilities/account/index', () => ({
  useAccountSession: () => view,
  signOutAndDiscardAccountCache: async () => undefined,
  AccountHub: () => null
}));

/** 개인 batch 조회만 대역이다. 응답 시점은 이 검사가 정하고 요청 본문은 그대로 관측한다. */
type Pending = { readonly input: MyBidObservationsInput; readonly resolve: (value: MyBidObservationsV1Response) => void; readonly reject: (error: unknown) => void };
const pending: Pending[] = [];
mock.module('@/api/account/find-my-bid-observations', () => ({
  bidObservationsIdentity: (attempts: readonly { attemptId: string; revisionId: string }[]) =>
    attempts.map((key) => `${key.attemptId}:${key.revisionId}`).toSorted().join(','),
  findMyBidObservationsWith: (_request: unknown, input: MyBidObservationsInput) =>
    new Promise<MyBidObservationsV1Response>((resolve, reject) => {
      pending.push({ input, resolve, reject });
    })
}));

const { accountQueries } = await import('@/api/account/index');
const { attemptsFixture } = await import('../../../__fixtures__/attempts');
const { presentHistory, observableAttemptKeys } = await import('../../history/model/attempt-history');
const { OwnBidProvider } = await import('./own-bid-provider');
const { useOptionalOwnBid } = await import('../model/own-bid-context');
type OwnBidValue = NonNullable<ReturnType<typeof useOptionalOwnBid>>;

const rows = presentHistory(attemptsFixture, null).rows;
const firstAccount: CurrentSessionV1Response = {
  state: 'active',
  account: { displayName: '첫째', maskedEmail: 'f***@example.com' },
  principalId: '9007199254740993',
  workspace: { workspaceId: '11', name: '첫째 워크스페이스', role: 'owner' }
};
const secondAccount: CurrentSessionV1Response = {
  state: 'active',
  account: { displayName: '둘째', maskedEmail: 's***@example.com' },
  principalId: '9007199254740995',
  workspace: { workspaceId: '12', name: '둘째 워크스페이스', role: 'owner' }
};
const sessionView = (session: CurrentSessionV1Response): AccountSessionView => ({
  session,
  isPending: false,
  error: null,
  principalId: session.state === 'active' ? session.principalId : null,
  refetch: () => undefined
});
const business = (businessId: string, businessNumber: string) => ({
  businessId,
  businessNumber,
  registeredAt: '2026-09-09T00:00:00Z',
  supplier: { kind: 'linked' as const, supplierPartyId: '7701' },
  location: null
});
const observedResponse = (businessId: string, attempts: readonly MyAttemptBidObservation[]): MyBidObservationsV1Response => ({
  businessId,
  organizationId: '3101',
  supplier: { kind: 'observed', supplierPartyId: '7701', attempts: [...attempts] },
  meta: { buildId: '501', sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null }
});
const submitted = (row: (typeof rows)[number]): MyAttemptBidObservation => ({
  attemptId: row.attemptId,
  revisionId: row.revisionId!,
  result: {
    kind: 'submitted',
    rows: [{
      submissionId: `${row.attemptId}0`,
      rosterOrdinal: 0,
      supplierPartyId: '7701',
      sourceSupplierAccountId: '7801',
      sourceCalculatedAmount: { amount: '10000000043768.00', currency: 'KRW' },
      submittedAmount: null,
      bidRate: { value: '89.001', unit: 'percentage-points' },
      rank: null,
      submittedAt: null,
      sourceStatus: { codeValueId: '7201', code: '005', scheme: 'eat:bid-status', label: null }
    }],
    rosterRowCount: 1,
    observedAt: '2026-09-05T03:04:05Z',
    provenance: { sourceSystem: 'eat', observationId: '6101', normalizedRecordId: '5101', contentSha256: 'a'.repeat(64) }
  }
});

function harness(session: CurrentSessionV1Response, businesses: MyBusinessesV1Response) {
  view = sessionView(session);
  // 미리 채운 답을 다시 묻지 않게 stale 없음으로 둔다. 요청이 나가는지는 batch 대역만 본다.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (session.state === 'active') {
    client.setQueryData(accountQueries.businesses({ principalId: session.principalId, workspaceId: session.workspace.workspaceId }).queryKey, businesses);
  }
  const seen: OwnBidValue[] = [];
  function Probe() {
    const value = useOptionalOwnBid();
    if (value) seen.push(value);
    return null;
  }
  const tree = (current: typeof rows = rows) => (
    <QueryClientProvider client={client}>
      <OwnBidProvider organizationId='3101' buildId='501' attempts={observableAttemptKeys(current)}>
        <Probe />
      </OwnBidProvider>
    </QueryClientProvider>
  );
  return { client, tree, latest: () => seen[seen.length - 1]! };
}

// TanStack은 알림을 macrotask로 묶어 보내므로 microtask 두 번으로는 갱신을 보지 못한다.
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  pending.length = 0;
});

describe('내 투찰 provider', () => {
  test('등록이 하나면 그 사업자로 바로 묻고 요청은 첫 페이지의 개찰일 있는 회차만 한 번에 담는다', async () => {
    const { tree, latest } = harness(firstAccount, { businesses: [business('7', '9000000016')] });
    render(tree());
    await flush();
    expect(latest().status.kind).toBe('loading');
    expect(latest().selectedBusinessId).toBe('7');
    expect(pending).toHaveLength(1);
    const { input } = pending[0]!;
    expect(input.businessId).toBe('7');
    expect(input.buildId).toBe('501');
    expect(input.organizationId).toBe('3101');
    expect(input.attempts).toHaveLength(rows.filter((row) => row.openedAt != null).length);
    expect(input.attempts.every((key) => key.revisionId === `${key.attemptId}1`)).toBe(true);
  });

  test('등록이 여럿이면 고르기 전까지 묻지 않고 고르면 그 사업자로 묻는다', async () => {
    const { tree, latest } = harness(firstAccount, { businesses: [business('7', '9000000016'), business('8', '9000000020')] });
    render(tree());
    await flush();
    expect(latest().status.kind).toBe('select-business');
    expect(latest().selectedBusinessId).toBeNull();
    expect(pending).toHaveLength(0);

    await act(async () => {
      latest().select('8');
    });
    await flush();
    expect(latest().selectedBusinessId).toBe('8');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.input.businessId).toBe('8');
  });

  test('관측 응답이 오면 그 회차 결과가 도착하고 계정이 바뀌면 이전 선택과 결과가 사라지며 늦은 응답은 새 화면에 닿지 않는다', async () => {
    const { client, tree, latest } = harness(firstAccount, { businesses: [business('7', '9000000016'), business('8', '9000000020')] });
    const screen = render(tree());
    await flush();
    await act(async () => {
      latest().select('7');
    });
    await flush();
    const target = rows.find((row) => row.openedAt != null)!;
    await act(async () => {
      pending[0]!.resolve(observedResponse('7', [submitted(target)]));
    });
    await flush();
    expect(latest().status.kind).toBe('observed');
    // 점 좌표는 행을 가진 차트가 만든다. provider는 그 회차 결과를 그대로 넘기고 요약만 센다(EAT-139).
    expect(latest().observations).toHaveLength(1);
    expect(latest().observations?.[0]?.attemptId).toBe(target.attemptId);

    // 둘째 계정으로 전환. 등록 목록은 미리 채워 두어 전환 즉시 판정된다.
    client.setQueryData(accountQueries.businesses({ principalId: secondAccount.principalId, workspaceId: '12' }).queryKey, { businesses: [business('9', '9000000035'), business('10', '9000000043')] });
    view = sessionView(secondAccount);
    await act(async () => {
      screen.rerender(tree());
    });
    await flush();
    expect(latest().selectedBusinessId).toBeNull();
    expect(latest().observations).toBeNull();
    expect(latest().status.kind).toBe('select-business');

    // 둘째 계정에서 같은 businessId를 골라도 첫째 계정의 답을 재사용하지 않는다. 다른 principal의 key라 새로 묻는다.
    await act(async () => {
      latest().select('9');
    });
    await flush();
    expect(pending).toHaveLength(2);
    expect(latest().status.kind).toBe('loading');
    expect(latest().observations).toBeNull();
  });

  test('revision이 없는 행이 하나라도 있으면 묻지 않고 준비 안 됨으로 둔다', async () => {
    const { tree, latest } = harness(firstAccount, { businesses: [business('7', '9000000016')] });
    render(tree(rows.map((row, index) => (index === 0 ? { ...row, revisionId: null } : row))));
    await flush();
    expect(latest().status.kind).toBe('history-not-ready');
    expect(pending).toHaveLength(0);
  });

  test('미로그인은 로그인 안내 상태이고 어떤 개인 요청도 보내지 않는다', async () => {
    const { tree, latest } = harness({ state: 'unauthenticated' }, { businesses: [] });
    render(tree());
    await flush();
    expect(latest().status.kind).toBe('signed-out');
    expect(pending).toHaveLength(0);
  });
});
