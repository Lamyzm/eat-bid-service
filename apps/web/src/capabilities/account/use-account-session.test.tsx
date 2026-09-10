import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, type RenderResult } from '@testing-library/react';
import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';

import { createQueryClient } from '@/shell/providers/query-client';

/** provider가 관측한 주체만 바꿔 가며 주입한다. 실제 Google 왕복은 여기서 증명하지 않는다. */
let providerSubject: string | null | undefined;
let signOutCount = 0;
// 이 모듈을 mock하는 테스트 파일은 전부 같은 export 이름 집합을 둔다. bun은 한 실행 안에서 이미 mock된 모듈의
// namespace를 제자리에서 갱신하므로, 뒤에 등록한 mock이 앞선 mock에 없던 이름을 더하지 못해 그 이름을 import하는
// 모듈이 link 단계에서 깨진다(login-screen.test.tsx의 signInWithEmail이 그렇게 깨졌다).
mock.module('@/shell/auth/auth-client', () => ({
  useProviderSubject: () => providerSubject,
  signOutFromProvider: async () => {
    signOutCount += 1;
  },
  signInWithGoogle: async () => undefined,
  signInWithEmail: async () => 'signed-in',
  isProviderAuthError: () => false
}));

/** 실제 query 경계와 실제 hook을 쓰고 transport만 대역으로 바꾼다. 응답 시점은 이 검사가 정한다. */
const pendingRequests: Array<(value: unknown) => void> = [];
mock.module('@/api/_transport/browser-request', () => ({
  browserRequest: Object.assign(
    () =>
      new Promise((resolve) => {
        pendingRequests.push(resolve);
      }),
    { isProblem: () => false }
  )
}));

const { accountQueries } = await import('@/api/account');
const { useAccountSession, signOutAndDiscardAccountCache } = await import('./use-account-session');
type AccountSessionView = ReturnType<typeof useAccountSession>;

const firstAccount: CurrentSessionV1Response = {
  state: 'active',
  account: { displayName: '첫째 사용자', maskedEmail: 'f***@example.com' },
  principalId: '9007199254740993',
  workspace: { workspaceId: '11', name: '첫째 워크스페이스', role: 'owner' }
};
const secondAccount: CurrentSessionV1Response = {
  state: 'active',
  account: { displayName: '둘째 사용자', maskedEmail: 's***@example.com' },
  principalId: '9007199254740995',
  workspace: { workspaceId: '12', name: '둘째 워크스페이스', role: 'owner' }
};
const firstScope = { principalId: '9007199254740993', workspaceId: '11' };
const firstBusinesses = {
  businesses: [
    {
      businessId: '7',
      businessNumber: '1248100998',
      registeredAt: '2026-09-09T00:00:00Z',
      supplier: { kind: 'linked' as const, supplierPartyId: '9007199254740995' },
      location: { addressText: '서울특별시 중구 세종대로 110', updatedAt: '2026-09-09T00:00:00Z' }
    }
  ]
};

function probe(serverSession?: CurrentSessionV1Response) {
  const rendered: AccountSessionView[] = [];
  function Probe() {
    rendered.push(useAccountSession(serverSession));
    return null;
  }
  // 전역 정책을 그대로 쓴다. staleTime이 0인 대역 client는 서버가 넘긴 답을 붙자마자 낡은 것으로 보아
  // "브라우저가 다시 묻지 않는다"를 증명하지 못한다.
  const client = createQueryClient({ notify: () => undefined, report: () => undefined });
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  // 같은 element 참조를 다시 넘기면 React가 재렌더를 건너뛴다. 전환을 관측하려면 매번 새로 만든다.
  const tree = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  return { rendered, client, tree };
}

/**
 * 서버가 넘긴 답은 값의 정체성으로 "이미 썼는지"를 가린다. 검사마다 새 응답을 만들어야 앞 검사가 쓴
 * 값이 다음 검사의 판정을 바꾸지 않는다.
 */
function serverRead(session: CurrentSessionV1Response): CurrentSessionV1Response {
  return { ...session };
}

function last(rendered: readonly AccountSessionView[]): AccountSessionView {
  const view = rendered.at(-1);
  if (view === undefined) throw new Error('렌더된 view가 필요합니다.');
  return view;
}

/**
 * 이 환경에서 query 구독 알림은 다음 macrotask에 React에 닿는다. 그 지점까지 진행시키지 않으면 화면이
 * 아직 그리지 않은 상태를 "그리지 않는다"로 잘못 읽는다.
 */
async function settle(work: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(tree: React.ReactElement): Promise<RenderResult> {
  let screen: RenderResult | undefined;
  await settle(() => {
    screen = render(tree);
  });
  if (screen === undefined) throw new Error('render 결과가 필요합니다.');
  return screen;
}

async function answer(response: unknown): Promise<void> {
  const resolve = pendingRequests.shift();
  if (resolve === undefined) throw new Error('대기 중인 요청이 필요합니다.');
  await settle(() => resolve(response));
}

beforeEach(() => {
  pendingRequests.length = 0;
  signOutCount = 0;
  providerSubject = undefined;
});

describe('계정 세션 hook', () => {
  test('provider 주체를 관측하기 전에는 세션을 묻지 않고 확인 중으로 둔다', async () => {
    const { rendered, tree } = probe();

    await mount(tree());

    expect(pendingRequests).toHaveLength(0);
    expect(last(rendered).isPending).toBe(true);
    expect(last(rendered).session).toBeUndefined();
  });

  test('서버가 읽은 답을 받으면 같은 조회를 브라우저가 다시 보내지 않는다', async () => {
    const { rendered, tree } = probe(serverRead(firstAccount));
    providerSubject = 'provider-first';

    await mount(tree());

    expect(pendingRequests).toHaveLength(0);
    expect(last(rendered).session).toEqual(firstAccount);
    expect(last(rendered).principalId).toBe(firstAccount.principalId);
  });

  test('주체를 모르는 동안에는 서버가 읽은 답을 놓지 않는다', async () => {
    const { rendered, client, tree } = probe(serverRead(firstAccount));

    await mount(tree());

    // 미관측 자리(`null`)를 채우면 주체가 밝혀진 뒤 그 값이 영영 읽히지 않는다.
    expect(client.getQueryData(accountQueries.session(null).queryKey)).toBeUndefined();
    expect(last(rendered).session).toBeUndefined();
    expect(pendingRequests).toHaveLength(0);
  });

  test('서버가 읽은 답은 첫 주체에만 쓰고 계정이 바뀌면 다시 묻는다', async () => {
    const { rendered, tree } = probe(serverRead(firstAccount));
    providerSubject = 'provider-first';

    const screen = await mount(tree());
    expect(last(rendered).session).toEqual(firstAccount);

    providerSubject = 'provider-second';
    await settle(() => screen.rerender(tree()));

    // 서버가 읽은 답은 그 요청의 쿠키 주체에 대한 답이다. 새 주체에 그대로 놓으면 남의 계정이 보인다.
    expect(last(rendered).session).toBeUndefined();
    expect(pendingRequests).toHaveLength(1);
    await answer(secondAccount);
    expect(last(rendered).session).toEqual(secondAccount);
  });

  test('다른 탭에서 계정이 바뀌면 중간에 미로그인 화면 없이 새 계정만 보여 준다', async () => {
    const { rendered, tree } = probe();
    providerSubject = 'provider-first';

    const screen = await mount(tree());
    await answer(firstAccount);
    expect(last(rendered).session).toEqual(firstAccount);

    rendered.length = 0;
    providerSubject = 'provider-second';
    await settle(() => screen.rerender(tree()));

    // 전환된 화면은 이전 계정의 답을 다시 그리지 않고 미로그인으로도 잠깐 넘어가지 않는다.
    for (const view of rendered) {
      expect(view.session).not.toEqual(firstAccount);
      expect(view.session?.state).not.toBe('unauthenticated');
    }
    expect(last(rendered).session).toBeUndefined();
    expect(last(rendered).isPending).toBe(true);

    await answer(secondAccount);
    expect(last(rendered).session).toEqual(secondAccount);
    expect(last(rendered).principalId).toBe(secondAccount.principalId);
  });

  test('늦게 도착한 이전 계정의 개인 응답은 새 계정 화면에 남지 않는다', async () => {
    const { rendered, client, tree } = probe();
    providerSubject = 'provider-first';

    const screen = await mount(tree());
    await answer(firstAccount);
    const businessesKey = accountQueries.businesses(firstScope).queryKey;
    // 전환 직전에 떠난 이전 계정의 개인 요청이다. 응답은 전환 뒤에 도착한다.
    const inFlight = client.fetchQuery(accountQueries.businesses(firstScope)).catch(() => undefined);

    providerSubject = 'provider-second';
    await settle(() => screen.rerender(tree()));

    await answer(firstBusinesses);
    await inFlight;
    await answer(secondAccount);

    expect(client.getQueryData(businessesKey)).toBeUndefined();
    expect(last(rendered).session).toEqual(secondAccount);
  });

  test('provider 로그아웃 뒤 canonical 응답이 늦어도 이전 계정 상태를 렌더하지 않는다', async () => {
    const { rendered, client, tree } = probe();
    providerSubject = 'provider-first';

    const screen = await mount(tree());
    await answer(firstAccount);
    client.setQueryData(accountQueries.businesses(firstScope).queryKey, firstBusinesses);

    providerSubject = null;
    await settle(() => screen.rerender(tree()));

    expect(last(rendered).session).toBeUndefined();
    expect(last(rendered).principalId).toBeNull();
    expect(client.getQueryData(accountQueries.businesses(firstScope).queryKey)).toBeUndefined();
    expect(client.getQueryData(accountQueries.session('provider-first').queryKey)).toBeUndefined();

    await answer({ state: 'unauthenticated' });
    expect(last(rendered).session).toEqual({ state: 'unauthenticated' });
  });

  test('로그아웃 command는 provider 무효화 뒤에 개인 자료와 이전 계정의 세션 답을 함께 버린다', async () => {
    const { rendered, client, tree } = probe();
    providerSubject = 'provider-first';

    const screen = await mount(tree());
    await answer(firstAccount);
    client.setQueryData(accountQueries.businesses(firstScope).queryKey, firstBusinesses);

    await settle(() => signOutAndDiscardAccountCache(client));

    expect(signOutCount).toBe(1);
    expect(client.getQueryData(accountQueries.session('provider-first').queryKey)).toBeUndefined();
    expect(client.getQueryData(accountQueries.businesses(firstScope).queryKey)).toBeUndefined();

    // provider 상태가 아직 화면에 닿기 전이어도 이전 계정의 이름을 계속 보여 주지 않는다.
    await settle(() => screen.rerender(tree()));
    expect(last(rendered).session).toBeUndefined();
  });
});
