import { describe, expect, test } from 'bun:test';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { ContractResponseError, HttpProblemError, HttpStatusError } from './http-problem';
import { readServerApiOrigin } from './api-origin';
import { createContractRequest } from './request-contract';

const validAuction = {
  identity: {
    auctionId: '9007199254740993',
    revisionId: '9007199254740995',
    externalBidId: 'external-id',
    displayBidNumber: null,
    title: '학교 급식 공고',
    status: 'OPEN'
  },
  organization: { organizationId: '412', name: '창원 남산초등학교', type: 'school' },
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

const auctionInput = {
  operation: auctionV1Operations.find,
  path: { auctionId: '9007199254740993' }
} as const;

describe('계약 검증 HTTP transport', () => {
  test('유효한 2xx JSON을 status별 Zod schema로 검증해 반환한다', async () => {
    const request = createContractRequest({
      fetch: async () => Response.json(validAuction, { status: 200 })
    });

    await expect(request(auctionInput)).resolves.toEqual(validAuction);
  });

  test('잘못된 2xx JSON과 등록되지 않은 성공 status를 계약 오류로 거부한다', async () => {
    const malformedRequest = createContractRequest({
      fetch: async () => Response.json({ ...validAuction, secret: true }, { status: 200 })
    });
    const unknownStatusRequest = createContractRequest({
      fetch: async () => Response.json(validAuction, { status: 201 })
    });

    await expect(malformedRequest(auctionInput)).rejects.toBeInstanceOf(ContractResponseError);
    await expect(unknownStatusRequest(auctionInput)).rejects.toBeInstanceOf(ContractResponseError);
  });

  test('유효한 RFC 9457 오류를 status·code·requestId가 있는 typed error로 바꾼다', async () => {
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
          { status: 404, headers: { 'content-type': 'application/problem+json' } }
        )
    });

    const error = await request(auctionInput).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpProblemError);
    expect(error).toMatchObject({
      status: 404,
      code: 'AUCTION_NOT_FOUND',
      requestId: 'request-404'
    });
    expect(request.isProblem(error)).toBe(true);
    expect(request.isProblem(new Error('일반 오류'))).toBe(false);
  });

  test('잘못되거나 JSON이 아닌 non-2xx는 원문을 노출하지 않는 status 오류가 된다', async () => {
    const secret = 'database-password-is-secret';
    const request = createContractRequest({
      fetch: async () =>
        new Response(secret, { status: 503, headers: { 'x-request-id': 'request-503' } })
    });

    const error = await request(auctionInput).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ status: 503, requestId: 'request-503' });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect((error as Error).message).not.toContain(secret);
  });

  test('동일한 AbortSignal과 operation이 만든 상대 경로를 fetch까지 전달한다', async () => {
    const controller = new AbortController();
    const observed: Array<{ input: string; signal: AbortSignal | null | undefined }> = [];
    const request = createContractRequest({
      fetch: async (input, init) => {
        observed.push({ input: String(input), signal: init?.signal });
        return Response.json(validAuction, { status: 200 });
      }
    });

    await request({ ...auctionInput, signal: controller.signal });
    expect(observed).toEqual([
      {
        input: '/api/v1/auctions/9007199254740993',
        signal: controller.signal
      }
    ]);
  });

  test('fetch가 발생시킨 abort 오류를 다른 오류로 감싸지 않는다', async () => {
    const abort = new DOMException('요청 취소', 'AbortError');
    const request = createContractRequest({
      fetch: async () => {
        throw abort;
      }
    });

    await expect(request(auctionInput)).rejects.toBe(abort);
  });

  test('검증한 Server origin만 상대 operation 경로 앞에 결합한다', async () => {
    const targets: string[] = [];
    const request = createContractRequest({
      fetch: async (input) => {
        targets.push(String(input));
        return Response.json(validAuction, { status: 200 });
      },
      resolveOrigin: () => 'http://localhost:4400'
    });

    await request(auctionInput);
    expect(targets).toEqual(['http://localhost:4400/api/v1/auctions/9007199254740993']);
  });

  test('Server API origin은 development 기본값만 허용하고 운영 누락을 거부한다', () => {
    expect(readServerApiOrigin({ NODE_ENV: 'development' })).toBe('http://localhost:4400');
    expect(
      readServerApiOrigin({ NODE_ENV: 'production', API_URL: 'https://api.example.com' })
    ).toBe('https://api.example.com');
    expect(() => readServerApiOrigin({ NODE_ENV: 'production' })).toThrow('API_URL');
    expect(() =>
      readServerApiOrigin({
        NODE_ENV: 'production',
        API_URL: 'https://api.example.com/base'
      })
    ).toThrow('origin');
  });
});
