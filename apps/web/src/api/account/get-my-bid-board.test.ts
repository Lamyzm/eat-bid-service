import { describe, expect, test } from 'bun:test';
import { myBidBoardV1Operations, type MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import { getMyBidBoardWith } from './get-my-bid-board';

const unconfirmed: MyBidBoardV1Response = { regionPreference: 'unconfirmed', asOf: '2026-10-12T00:47:00Z', rows: [] };

function requestDouble(
  inputs: unknown[],
  outcome: { readonly problem?: { readonly status: number; readonly code: string } } = {}
): ContractRequest {
  return Object.assign(
    async (input: unknown) => {
      inputs.push(input);
      if (outcome.problem) {
        throw new HttpProblemError({
          type: 'about:blank',
          title: 'test',
          status: outcome.problem.status,
          code: outcome.problem.code,
          requestId: 'test-request'
        } as never);
      }
      return unconfirmed;
    },
    { isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError }
  ) as ContractRequest;
}

describe('오늘 투찰 조회 adapter', () => {
  test('고른 품목을 계약 query로 실어 오늘 투찰 operation을 부른다', async () => {
    const inputs: unknown[] = [];
    const read = await getMyBidBoardWith(requestDouble(inputs), { items: ['육류', '가금류'] });
    expect(read).toEqual({ kind: 'board', response: unconfirmed });
    expect(inputs[0]).toMatchObject({
      operation: myBidBoardV1Operations.getMyBidBoard,
      query: { items: ['육류', '가금류'] }
    });
  });

  test('품목을 고르지 않으면 빈 query로 부른다', async () => {
    const inputs: unknown[] = [];
    await getMyBidBoardWith(requestDouble(inputs), {});
    expect(inputs[0]).toMatchObject({ query: {} });
  });

  test('운영자 권한이 없다는 403은 실패가 아니라 forbidden 결과다', async () => {
    const read = await getMyBidBoardWith(requestDouble([], { problem: { status: 403, code: 'FORBIDDEN' } }), {});
    expect(read).toEqual({ kind: 'forbidden' });
  });

  test('그 밖의 실패는 그대로 던진다', async () => {
    await expect(getMyBidBoardWith(requestDouble([], { problem: { status: 503, code: 'DEPENDENCY_UNAVAILABLE' } }), {}))
      .rejects.toBeInstanceOf(HttpProblemError);
  });
});
