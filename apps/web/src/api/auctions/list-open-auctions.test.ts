import { describe, expect, test } from 'bun:test';
import {
  auctionV1Operations,
  type OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';

import { HttpProblemError } from '../_transport/http-problem';
import { createContractRequest, type ContractRequest } from '../_transport/request-contract';
import { isOpenAuctionCursorInvalidError } from './auction-resource-error';
import { listOpenAuctionsWith } from './list-open-auctions';

const nullLineage = {
  buildId: null,
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null
};

const emptyList: OpenAuctionListV1Response = {
  auctions: [],
  nextCursor: null,
  meta: {
    sampleCount: 0,
    asOf: '2026-09-07T01:00:00Z',
    region: null,
    item: null,
    closesWithinHours: null,
    baseAmountMin: null,
    baseAmountMax: null,
    openAuctionSnapshotBuild: nullLineage,
    orgRoundSummaryBuild: nullLineage
  }
};

function requestDouble(implementation: (input: unknown) => Promise<unknown>): ContractRequest {
  return Object.assign(implementation, {
    isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
  }) as ContractRequest;
}

function problem(status: number, code: string): HttpProblemError {
  return new HttpProblemError({
    type: `https://eatbid.dev/problems/${code.toLowerCase()}`,
    title: code,
    status,
    code: code as never,
    requestId: 'fixture-request'
  });
}

describe('열린 공고 목록 resource 조회', () => {
  test('operation과 정규화된 query 및 동일한 AbortSignal을 transport에 전달한다', async () => {
    const inputs: unknown[] = [];
    const controller = new AbortController();
    const request = requestDouble(async (input) => {
      inputs.push(input);
      return emptyList;
    });
    await expect(
      listOpenAuctionsWith(request, { region: '41', closesWithinHours: 72, signal: controller.signal })
    ).resolves.toEqual(emptyList);
    expect(inputs).toEqual([
      {
        operation: auctionV1Operations.listOpen,
        path: {},
        query: { state: 'open', region: '41', closesWithinHours: 72, limit: 50 },
        signal: controller.signal
      }
    ]);
  });

  test('계약이 거부하는 query는 네트워크 호출 전에 실패한다', async () => {
    for (const input of [
      { closesWithinHours: 0 },
      { region: '01' },
      { baseAmountMin: '2000000' },
      { limit: 101 },
      { item: '' }
    ]) {
      let fetchCount = 0;
      const request = createContractRequest({
        fetch: async () => {
          fetchCount += 1;
          return Response.json(emptyList, { status: 200 });
        }
      });
      await expect(listOpenAuctionsWith(request, input)).rejects.toBeDefined();
      expect(fetchCount).toBe(0);
    }
  });

  test('400 Problem은 cursor가 실렸을 때만 cursor 무효 오류로 번역된다', async () => {
    const request = requestDouble(async () => {
      throw problem(400, 'VALIDATION_ERROR');
    });
    const withCursor = await listOpenAuctionsWith(request, { cursor: '5796468' }).catch((error: unknown) => error);
    expect(isOpenAuctionCursorInvalidError(withCursor)).toBe(true);
    const withoutCursor = await listOpenAuctionsWith(request, {}).catch((error: unknown) => error);
    expect(isOpenAuctionCursorInvalidError(withoutCursor)).toBe(false);
    expect(withoutCursor).toBeInstanceOf(HttpProblemError);
  });

  test('503 Problem은 그대로 올려 보낸다', async () => {
    const request = requestDouble(async () => {
      throw problem(503, 'DEPENDENCY_UNAVAILABLE');
    });
    const failure = await listOpenAuctionsWith(request, { cursor: '5796468' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpProblemError);
    expect(isOpenAuctionCursorInvalidError(failure)).toBe(false);
  });
});
