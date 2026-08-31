import { describe, expect, test } from 'bun:test';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';

import {
  ContractResponseError,
  HttpProblemError,
  HttpStatusError
} from '../_transport/http-problem';
import { createContractRequest, type ContractRequest } from '../_transport/request-contract';
import { isAuctionNotFoundError } from './auction-resource-error';
import { getAuctionWith } from './get-auction';

const validAuction = {
  identity: {
    auctionId: '9007199254740993',
    revisionId: '9007199254740995',
    externalBidId: 'external-id',
    displayBidNumber: null,
    title: '학교 급식 공고',
    status: 'OPEN'
  },
  schedule: {
    announcedAt: '2026-08-30T00:00:00Z',
    deadlineAt: null,
    openedAt: null
  },
  pricing: {
    baseAmount: { amount: '123456789.00', currency: 'KRW' },
    plannedAmount: null
  },
  provenance: {
    sourceSystem: 'eat',
    observationId: '9007199254740997',
    normalizedRecordId: '9007199254740999',
    contentSha256: 'a'.repeat(64)
  }
} as const;

function requestDouble(
  implementation: (input: unknown) => Promise<unknown>,
  isProblem: ContractRequest['isProblem'] = (error): error is HttpProblemError =>
    error instanceof HttpProblemError
): ContractRequest {
  return Object.assign(implementation, { isProblem }) as ContractRequest;
}

describe('공고 resource 조회', () => {
  test('operation과 canonical path input 및 동일한 AbortSignal을 transport에 전달한다', async () => {
    const inputs: unknown[] = [];
    const controller = new AbortController();
    const request = requestDouble(async (input) => {
      inputs.push(input);
      return validAuction;
    });

    await expect(
      getAuctionWith(request, {
        auctionId: '9007199254740993',
        signal: controller.signal
      })
    ).resolves.toEqual(validAuction);
    expect(inputs).toEqual([
      {
        operation: auctionV1Operations.find,
        path: { auctionId: '9007199254740993' },
        signal: controller.signal
      }
    ]);
  });

  test('안전 정수보다 큰 ID와 PostgreSQL bigint 최댓값을 문자열 URL로 보존한다', async () => {
    for (const auctionId of ['9007199254740993', '9223372036854775807']) {
      const targets: string[] = [];
      const request = createContractRequest({
        fetch: async (input) => {
          targets.push(String(input));
          return Response.json(validAuction, { status: 200 });
        }
      });

      await getAuctionWith(request, { auctionId });
      expect(targets).toEqual([`/api/v1/auctions/${auctionId}`]);
    }
  });

  test('canonical 양의 bigint가 아닌 ID는 fetch 전에 거부한다', async () => {
    for (const auctionId of ['01', '0', '-1', '1.5', '9223372036854775808']) {
      let fetchCount = 0;
      const request = createContractRequest({
        fetch: async () => {
          fetchCount += 1;
          return Response.json(validAuction, { status: 200 });
        }
      });

      await expect(getAuctionWith(request, { auctionId })).rejects.toBeDefined();
      expect(fetchCount).toBe(0);
    }
  });

  test('잘못된 2xx 응답을 resource data로 통과시키지 않는다', async () => {
    const request = createContractRequest({
      fetch: async () => Response.json({ ...validAuction, secret: true }, { status: 200 })
    });

    await expect(getAuctionWith(request, { auctionId: '9007199254740993' })).rejects.toBeInstanceOf(
      ContractResponseError
    );
  });

  test('정확한 404 AUCTION_NOT_FOUND만 공고 없음 오류로 변환한다', async () => {
    const request = createContractRequest({
      fetch: async () =>
        Response.json(
          {
            type: 'https://eatbid.dev/problems/auction-not-found',
            title: '공고를 찾을 수 없음',
            status: 404,
            code: 'AUCTION_NOT_FOUND',
            requestId: 'request-404'
          },
          { status: 404 }
        )
    });

    const error = await getAuctionWith(request, { auctionId: '9007199254740993' }).catch(
      (reason: unknown) => reason
    );
    expect(isAuctionNotFoundError(error)).toBe(true);
    expect(error).toMatchObject({
      name: 'AuctionNotFoundError',
      auctionId: '9007199254740993'
    });
  });

  test('다른 Problem과 malformed status 및 abort 오류는 원래 typed failure를 유지한다', async () => {
    const failures = [
      new HttpProblemError({
        type: 'https://eatbid.dev/problems/dependency-unavailable',
        title: '의존성을 사용할 수 없음',
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        requestId: 'request-503'
      }),
      new HttpStatusError(500, 'request-500'),
      new DOMException('요청 취소', 'AbortError')
    ];

    for (const failure of failures) {
      const request = requestDouble(async () => {
        throw failure;
      });
      await expect(getAuctionWith(request, { auctionId: '9007199254740993' })).rejects.toBe(
        failure
      );
    }
  });
});
