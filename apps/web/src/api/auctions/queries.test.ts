import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import * as auctionClient from './index';
import { createAuctionQueries } from './queries';

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

describe('공고 Query Options', () => {
  test('회차 명단은 revision별 캐시를 분리하고 선택 전에는 조회하지 않는다', async () => {
    const inputs: unknown[] = [];
    const queries = createAuctionQueries(requestDouble(inputs));
    const latest = queries.roster('9007199254740993');
    const pinned = queries.roster('9007199254740993', '99');
    expect(latest.queryKey).not.toEqual(pinned.queryKey);
    expect(inputs).toHaveLength(0);
    expect(() => queries.roster('01')).toThrow();
    expect(() => queries.roster('1', '0')).toThrow();
    const controller = new AbortController();
    if (!pinned.queryFn) throw new Error('queryFn이 필요합니다.');
    await pinned.queryFn({
      client: new QueryClient(), queryKey: pinned.queryKey, signal: controller.signal, meta: undefined
    });
    expect(inputs).toEqual([expect.objectContaining({
      path: { auctionId: '9007199254740993' }, query: { revisionId: '99' }, signal: controller.signal
    })]);
  });
  test('계층형 key가 bigint ID 문자열을 손실 없이 보존한다', () => {
    const queries = createAuctionQueries(requestDouble([]));

    expect(queries.all()).toEqual(['auctions']);
    expect(queries.details()).toEqual(['auctions', 'detail']);
    expect(Array.from(queries.detail('9007199254740993').queryKey)).toEqual([
      'auctions',
      'detail',
      '9007199254740993'
    ]);
    expect(Array.from(queries.detail('9223372036854775807').queryKey)).toEqual([
      'auctions',
      'detail',
      '9223372036854775807'
    ]);
  });

  test('잘못된 ID는 query key를 만들기 전에 거부한다', () => {
    const queries = createAuctionQueries(requestDouble([]));

    for (const auctionId of ['01', '0', '-1', '1.5', '9223372036854775808']) {
      expect(() => queries.detail(auctionId)).toThrow();
    }
  });

  test('Query function이 받은 AbortSignal을 resource request에 그대로 전달한다', async () => {
    const inputs: unknown[] = [];
    const options = createAuctionQueries(requestDouble(inputs)).detail('9007199254740993');
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

  test('열린 공고 목록 query key는 기본값까지 정규화된 필터를 담는다', () => {
    const queries = createAuctionQueries(requestDouble([]));
    expect(queries.openLists()).toEqual(['auctions', 'open']);
    expect(Array.from(queries.open({ sido: '41', closesWithinHours: 72 }).queryKey)).toEqual([
      'auctions',
      'open',
      { state: 'open', sido: '41', closesWithinHours: 72, limit: 50 }
    ]);
    expect(queries.open({}).queryKey).toEqual(queries.open({ limit: 50 }).queryKey);
    expect(() => queries.open({ closesWithinHours: 721 })).toThrow();
  });

  test('browser 공개 진입점은 server 전용 함수를 재수출하지 않는다', () => {
    expect('getAuction' in auctionClient).toBe(true);
    expect('listOpenAuctions' in auctionClient).toBe(true);
    expect('auctionQueries' in auctionClient).toBe(true);
    expect('getAuctionFromServer' in auctionClient).toBe(false);
    expect('listOpenAuctionsFromServer' in auctionClient).toBe(false);
  });
});
