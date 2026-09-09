import { describe, expect, test } from 'bun:test';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { meV1Operations } from '@eatbid/contracts/api/v1/me';
import { milliseconds, seconds } from '@eatbid/domain';
import { HttpProblemError, HttpStatusError } from './http-problem';
import { createContractRequest } from './request-contract';
import { transportResilience, type TransportResilience } from './request-resilience';

const auctionInput = {
  operation: auctionV1Operations.find,
  path: { auctionId: '9007199254740993' }
} as const;

const writeInput = {
  operation: meV1Operations.initializeCurrentAccount,
  path: undefined
} as const;

/** 재시도 예산은 그대로 두고 대기 시간만 줄여 백오프가 테스트를 붙잡지 않게 한다. */
const shortRead: TransportResilience = { timeout: seconds(2), retryLimit: 2 };

function unavailable(): Response {
  return Response.json(
    {
      type: 'https://eatbid.dev/problems/dependency-unavailable',
      title: '데이터베이스를 사용할 수 없음',
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      requestId: 'request-503'
    },
    { status: 503, headers: { 'content-type': 'application/problem+json' } }
  );
}

describe('전송 계층 시간 제한과 재시도', () => {
  test('예산을 넘긴 조회는 시간 제한으로 끊기고 상류 요청도 취소된다', async () => {
    let aborted = false;
    const request = createContractRequest({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('상류 요청 취소'));
          });
        }),
      resilience: { timeout: milliseconds(150), retryLimit: 0 }
    });

    const failure = await request(auctionInput).catch((reason: unknown) => reason);
    expect((failure as Error).name).toBe('TimeoutError');
    expect(aborted).toBe(true);
  });

  test('재시도 대상 status를 만난 조회만 정해진 횟수까지 다시 보낸다', async () => {
    let calls = 0;
    const request = createContractRequest({
      fetch: async () => {
        calls += 1;
        return new Response('', { status: 503 });
      },
      resilience: shortRead
    });

    await expect(request(auctionInput)).rejects.toBeInstanceOf(HttpStatusError);
    expect(calls).toBe(3);
  });

  test('재시도 대상이 아닌 status는 다시 보내지 않는다', async () => {
    let calls = 0;
    const request = createContractRequest({
      fetch: async () => {
        calls += 1;
        return Response.json(
          {
            type: 'https://eatbid.dev/problems/auction-not-found',
            title: '공고를 찾을 수 없음',
            status: 404,
            code: 'AUCTION_NOT_FOUND',
            requestId: 'request-404'
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } }
        );
      },
      resilience: shortRead
    });

    await expect(request(auctionInput)).rejects.toBeInstanceOf(HttpProblemError);
    expect(calls).toBe(1);
  });

  test('쓰기 요청은 같은 status를 받아도 다시 보내지 않는다', async () => {
    let calls = 0;
    const request = createContractRequest({
      fetch: async () => {
        calls += 1;
        return new Response('', { status: 503 });
      },
      resilience: shortRead
    });

    await expect(request(writeInput)).rejects.toBeInstanceOf(HttpStatusError);
    expect(calls).toBe(1);
  });

  test('Retry-After가 있으면 기본 백오프 대신 서버가 말한 시간을 기다린다', async () => {
    let calls = 0;
    const startedAt = performance.now();
    const request = createContractRequest({
      fetch: async () => {
        calls += 1;
        return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      },
      resilience: { timeout: seconds(3), retryLimit: 1 }
    });

    await expect(request(auctionInput)).rejects.toBeInstanceOf(HttpStatusError);
    expect(calls).toBe(2);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(900);
  });

  test('재시도를 모두 쓰면 마지막 응답 본문을 계약이 그대로 읽는다', async () => {
    let calls = 0;
    const request = createContractRequest({
      fetch: async () => {
        calls += 1;
        return unavailable();
      },
      resilience: { timeout: seconds(2), retryLimit: 1 }
    });

    const failure = await request(auctionInput).catch((reason: unknown) => reason);
    expect(calls).toBe(2);
    expect(failure).toBeInstanceOf(HttpProblemError);
    expect(failure).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
  });

  test('재시도가 성공하면 그 응답을 정상 결과로 돌려준다', async () => {
    let calls = 0;
    const request = createContractRequest({
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response('', { status: 502 })
          : Response.json({ kind: 'unmapped' }, { status: 200 });
      },
      resilience: shortRead
    });

    // 성공 응답의 형태 검증은 계약이 계속 담당하므로 재시도가 계약 판정을 건너뛰지 않는지까지 확인한다.
    await expect(request(auctionInput)).rejects.toMatchObject({ name: 'ContractResponseError' });
    expect(calls).toBe(2);
  });

  test('전역 fetch는 module load가 아니라 호출 시점에 읽는다', async () => {
    const targets: string[] = [];
    const request = createContractRequest({
      fetch: (input, init) => fetch(input, init),
      resilience: { timeout: seconds(2), retryLimit: 0 }
    });
    const installed = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      targets.push(String(input));
      return unavailable();
    }) as typeof fetch;

    try {
      await expect(request(auctionInput)).rejects.toBeInstanceOf(HttpProblemError);
    } finally {
      globalThis.fetch = installed;
    }

    expect(targets).toEqual(['/api/v1/auctions/9007199254740993']);
  });

  test('조립 지점별 예산은 서버 렌더가 브라우저보다 짧다', () => {
    expect(transportResilience.publicServerRead.timeout).toBeLessThan(
      transportResilience.browserRead.timeout
    );
    expect(transportResilience.privateServerRead.retryLimit).toBeLessThan(
      transportResilience.publicServerRead.retryLimit
    );
  });
});
