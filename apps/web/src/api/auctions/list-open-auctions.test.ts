import { describe, expect, test } from 'bun:test';
import {
  auctionV1Operations,
  openAuctionListQuerySchema,
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
    sido: null,
    sigungu: null,
    eligibilityArea: null,
    eligibilityMatchedCount: null,
    eligibilityUnobservedCount: null,
    items: null,
    itemUnknown: null,
    q: null,
    bidState: null,
    closesWithinHours: null,
    closesOn: null,
    announcedOn: null,
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
      listOpenAuctionsWith(request, { sido: '41', closesWithinHours: 72, signal: controller.signal })
    ).resolves.toEqual(emptyList);
    expect(inputs).toEqual([
      {
        operation: auctionV1Operations.listOpen,
        path: {},
        query: { state: 'open', sido: '41', closesWithinHours: 72, limit: 50 },
        signal: controller.signal
      }
    ]);
  });

  /**
   * 계약이 받는 필터를 어댑터가 하나라도 빠뜨리면 화면은 조용히 안 걸린 목록을 본다. 400도 아니고
   * 빈 결과도 아니라서 눈으로는 "필터가 안 먹는다"로만 보인다. `closesOn`이 실제로 그렇게 빠져 있었다.
   *
   * 그래서 표본을 계약의 필드 목록과 맞춰 본다. 계약에 필드가 늘면 이 표가 먼저 실패하고, 표를 채우면
   * 그 값이 전송되는지까지 이어서 검사한다.
   */
  test('계약이 받는 필터를 하나도 빠뜨리지 않고 transport로 넘긴다', async () => {
    // `state`는 어댑터가 아니라 계약이 고정하는 값이고 `limit`은 기본값이 있다. 나머지는 전부 호출자 것이다.
    const fixed = new Set(['state', 'limit']);
    const samples: Record<string, unknown> = {
      sido: '41',
      sigungu: ['43'],
      eligibilityArea: ['9101'],
      items: ['육류', '가금류'],
      itemUnknown: 'include',
      q: '남산',
      bidState: 'none',
      closesWithinHours: 72,
      closesOn: '2026-09-15',
      announcedOn: '2026-09-14',
      baseAmountMin: '3000000.00',
      baseAmountMax: '30000000.00',
      cursor: '5796468'
    };
    const accepted = Object.keys(openAuctionListQuerySchema.shape).filter((key) => !fixed.has(key));
    expect(accepted.filter((key) => !(key in samples))).toEqual([]);

    const inputs: { query: Record<string, unknown> }[] = [];
    const request = requestDouble(async (input) => {
      inputs.push(input as { query: Record<string, unknown> });
      return emptyList;
    });
    // 계약이 마감 시간 창과 마감 달력일을 함께 받지 않으므로 둘로 나눠 보낸다.
    const { closesOn: _closesOn, ...withHours } = samples;
    await listOpenAuctionsWith(request, withHours);
    const { closesWithinHours: _hours, ...withDay } = samples;
    await listOpenAuctionsWith(request, withDay);

    // 계약 parse는 안 준 필드를 값 undefined인 key로 남기므로 그대로 펼치면 앞 호출의 값을 덮는다.
    const sent: Record<string, unknown> = {};
    for (const input of inputs) {
      for (const [key, value] of Object.entries(input.query)) if (value !== undefined) sent[key] = value;
    }
    for (const key of accepted) expect(sent[key]).toEqual(samples[key]);
  });

  test('계약이 거부하는 query는 네트워크 호출 전에 실패한다', async () => {
    for (const input of [
      { closesWithinHours: 0 },
      { sido: '01' },
      { baseAmountMin: '2000000' },
      // 상한이 100에서 200으로 넓어졌으므로 거부되는 경계도 함께 옮긴다(EAT-206).
      { limit: 201 },
      { items: [''] },
      // 조각 열일곱은 관측된 라벨 가짓수보다 많다. 상한을 넘기면 네트워크에 닿기 전에 막는다.
      { items: Array.from({ length: 17 }, (_, index) => `조각${index}`) }
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
