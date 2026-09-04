import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import * as organizationClient from './index';
import { createOrganizationQueries } from './queries';

function requestDouble(inputs: unknown[]): ContractRequest {
  return Object.assign(
    async (input: unknown) => {
      inputs.push(input);
      return { ok: true };
    },
    {
      isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
    }
  ) as ContractRequest;
}

describe('기관 회차 이력 Query Options', () => {
  test('계층형 key가 bigint 기관 ID 문자열과 정규화된 query를 함께 보존한다', () => {
    const queries = createOrganizationQueries(requestDouble([]));

    expect(queries.all()).toEqual(['organizations']);
    expect(queries.attemptsLists()).toEqual(['organizations', 'attempts']);
    expect(
      Array.from(queries.attempts({ organizationId: '3101', item: '7', limit: 60 }).queryKey)
    ).toEqual(['organizations', 'attempts', '3101', { item: '7', limit: 60 }]);
    expect(
      Array.from(
        queries.attempts({ organizationId: '9223372036854775807' }).queryKey
      )
    ).toEqual(['organizations', 'attempts', '9223372036854775807', { limit: 12 }]);
  });

  test('동일한 input은 동일한 query key를 만든다', () => {
    const queries = createOrganizationQueries(requestDouble([]));
    const first = queries.attempts({ organizationId: '3101', cursor: '5', limit: 30 });
    const second = queries.attempts({ organizationId: '3101', cursor: '5', limit: 30 });

    expect(Array.from(first.queryKey)).toEqual(Array.from(second.queryKey));
  });

  test('잘못된 기관 ID는 query key를 만들기 전에 거부한다', () => {
    const queries = createOrganizationQueries(requestDouble([]));

    for (const organizationId of ['01', '0', '-1', '1.5', '9223372036854775808']) {
      expect(() => queries.attempts({ organizationId })).toThrow();
    }
  });

  test('limit 200 초과는 query key를 만들기 전에 거부한다', () => {
    const queries = createOrganizationQueries(requestDouble([]));

    expect(() => queries.attempts({ organizationId: '3101', limit: 201 })).toThrow();
  });

  test('Query function이 받은 AbortSignal을 resource request에 그대로 전달한다', async () => {
    const inputs: unknown[] = [];
    const options = createOrganizationQueries(requestDouble(inputs)).attempts({
      organizationId: '3101'
    });
    const queryFunction = options.queryFn;
    const controller = new AbortController();
    if (!queryFunction) throw new Error('queryFn이 필요합니다.');

    await queryFunction({
      client: new QueryClient(),
      queryKey: options.queryKey,
      signal: controller.signal,
      meta: undefined
    });
    expect(inputs).toEqual([expect.objectContaining({ signal: controller.signal })]);
  });

  test('browser 공개 진입점은 server 전용 함수를 재수출하지 않는다', () => {
    expect('listOrganizationAuctionAttempts' in organizationClient).toBe(true);
    expect('organizationQueries' in organizationClient).toBe(true);
    expect('listOrganizationAuctionAttemptsFromServer' in organizationClient).toBe(false);
  });
});
