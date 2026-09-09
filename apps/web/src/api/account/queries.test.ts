import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import {
  createAccountQueries,
  discardAccountCache,
  discardOtherPrincipals,
  discardOtherSubjects
} from './queries';

function requestDouble(inputs: unknown[]): ContractRequest {
  return Object.assign(
    async (input: unknown) => {
      inputs.push(input);
      return { businesses: [] };
    },
    {
      isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
    }
  ) as ContractRequest;
}

const first = { principalId: '9007199254740993', workspaceId: '11' };
const second = { principalId: '9007199254740995', workspaceId: '12' };
const unauthenticated = { state: 'unauthenticated' } as const;
const uninitialized = {
  state: 'uninitialized',
  account: { displayName: '김이름', maskedEmail: 'k***@example.com' }
} as const;

describe('계정 Query Options', () => {
  test('세션 key는 개인 하위 트리 밖에 두고 개인 key는 principal·workspace를 담는다', () => {
    const queries = createAccountQueries(requestDouble([]));

    expect(Array.from(queries.session('provider-user-a').queryKey)).toEqual([
      'account',
      'session',
      'provider-user-a'
    ]);
    expect(Array.from(queries.businesses(first).queryKey)).toEqual([
      'account',
      'private',
      '9007199254740993',
      '11',
      'businesses'
    ]);
  });

  test('다른 principal의 등록 목록은 같은 URL이어도 다른 캐시 항목이다', () => {
    const queries = createAccountQueries(requestDouble([]));

    expect(queries.businesses(first).queryKey).not.toEqual(queries.businesses(second).queryKey);
  });

  test('bigint principal 문자열을 손실 없이 보존한다', () => {
    const queries = createAccountQueries(requestDouble([]));
    const key = queries.businesses({ principalId: '9223372036854775807', workspaceId: '9223372036854775806' });

    expect(Array.from(key.queryKey)[2]).toBe('9223372036854775807');
    expect(Array.from(key.queryKey)[3]).toBe('9223372036854775806');
  });

  test('등록 목록 조회는 AbortSignal을 transport까지 전달한다', async () => {
    const inputs: unknown[] = [];
    const queries = createAccountQueries(requestDouble(inputs));
    const options = queries.businesses(first);
    const controller = new AbortController();
    if (!options.queryFn) throw new Error('queryFn이 필요합니다.');

    await options.queryFn({
      client: new QueryClient(),
      queryKey: options.queryKey,
      signal: controller.signal,
      meta: undefined
    });

    expect(inputs).toEqual([expect.objectContaining({ signal: controller.signal })]);
  });

  test('다른 provider 주체의 세션 답은 같은 화면에서도 다른 캐시 항목이다', () => {
    const queries = createAccountQueries(requestDouble([]));

    expect(queries.session('provider-user-a').queryKey).not.toEqual(
      queries.session('provider-user-b').queryKey
    );
    // 주체를 아직 관측하지 못한 동안에는 묻지 않는다. 그때 받은 답은 누구의 것인지 말할 수 없다.
    expect(queries.session(undefined).enabled).toBe(false);
    expect(queries.session(null).enabled).toBe(true);
  });

  test('로그아웃은 개인 자료와 이전 계정의 세션 답을 함께 버린다', async () => {
    const client = new QueryClient();
    const queries = createAccountQueries(requestDouble([]));
    client.setQueryData(queries.session('provider-user-a').queryKey, unauthenticated);
    client.setQueryData(queries.businesses(first).queryKey, { businesses: [] });

    await discardAccountCache(client);

    expect(client.getQueryData(queries.businesses(first).queryKey)).toBeUndefined();
    expect(client.getQueryData(queries.session('provider-user-a').queryKey)).toBeUndefined();
  });

  test('전환 뒤에는 이전 주체의 세션 답만 사라지고 현재 주체의 답은 남는다', async () => {
    const client = new QueryClient();
    const queries = createAccountQueries(requestDouble([]));
    client.setQueryData(queries.session('provider-user-a').queryKey, unauthenticated);
    client.setQueryData(queries.session('provider-user-b').queryKey, uninitialized);

    await discardOtherSubjects(client, 'provider-user-b');

    expect(client.getQueryData(queries.session('provider-user-a').queryKey)).toBeUndefined();
    expect(client.getQueryData(queries.session('provider-user-b').queryKey)?.state).toBe(
      'uninitialized'
    );
  });

  test('계정이 바뀌면 이전 principal의 개인 캐시만 사라진다', async () => {
    const client = new QueryClient();
    const queries = createAccountQueries(requestDouble([]));
    client.setQueryData(queries.businesses(first).queryKey, { businesses: [] });
    client.setQueryData(queries.businesses(second).queryKey, { businesses: [] });

    await discardOtherPrincipals(client, second.principalId);

    expect(client.getQueryData(queries.businesses(first).queryKey)).toBeUndefined();
    expect(client.getQueryData(queries.businesses(second).queryKey)?.businesses).toEqual([]);
  });

  test('로그아웃 뒤에는 어떤 principal의 개인 캐시도 남지 않는다', async () => {
    const client = new QueryClient();
    const queries = createAccountQueries(requestDouble([]));
    client.setQueryData(queries.businesses(first).queryKey, { businesses: [] });
    client.setQueryData(queries.businesses(second).queryKey, { businesses: [] });

    await discardOtherPrincipals(client, null);

    expect(client.getQueryData(queries.businesses(first).queryKey)).toBeUndefined();
    expect(client.getQueryData(queries.businesses(second).queryKey)).toBeUndefined();
  });
});
