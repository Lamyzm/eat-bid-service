import { describe, expect, test } from 'bun:test';

import { dispatchRevalidate, type CacheRevalidators } from './_dispatch';

const TOKEN = 'contract-fixture-token';

function recorder() {
  const calls: string[] = [];
  const scopes: unknown[] = [];
  const revalidators: CacheRevalidators = {
    auctions: (scope) => {
      calls.push('auctions');
      scopes.push(scope);
    },
    orgRoundSummary: () => calls.push('orgRoundSummary'),
    winRateDistributionMonthly: () => calls.push('winRateDistributionMonthly')
  };
  return { calls, scopes, revalidators };
}

function request(body: unknown, authorization?: string): Request {
  return new Request('http://web/internal/cache/revalidate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization })
    },
    body: JSON.stringify(body)
  });
}

async function dispatch(
  body: unknown,
  options: { authorization?: string; expectedToken?: string } = {}
) {
  const { calls, scopes, revalidators } = recorder();
  const response = await dispatchRevalidate({
    request: request(body, options.authorization),
    expectedToken: 'expectedToken' in options ? options.expectedToken : TOKEN,
    revalidators,
    requestId: 'fixture-request-id'
  });
  return { response, calls, scopes };
}

describe('캐시 무효화 요청 판정', () => {
  test('토큰이 없으면 401 Problem이고 아무것도 지우지 않는다', async () => {
    const { response, calls } = await dispatch({ allAuctions: true });
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(calls).toEqual([]);
  });

  test('토큰이 틀리면 401이다', async () => {
    const { response, calls } = await dispatch(
      { allAuctions: true },
      { authorization: `Bearer ${TOKEN}-wrong` }
    );
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  test('Bearer가 아닌 인증 방식은 401이다', async () => {
    const { response } = await dispatch(
      { allAuctions: true },
      { authorization: `Basic ${TOKEN}` }
    );
    expect(response.status).toBe(401);
  });

  test('서버에 토큰이 설정되지 않으면 인증 없이 열지 않고 500이다', async () => {
    const { response, calls } = await dispatch(
      { allAuctions: true },
      { authorization: `Bearer ${TOKEN}`, expectedToken: undefined }
    );
    expect(response.status).toBe(500);
    expect(calls).toEqual([]);
  });

  test('응답 Problem 본문은 공개 계약 모양이다', async () => {
    const { response } = await dispatch({ allAuctions: true });
    expect(await response.json()).toEqual({
      type: 'https://eatbid.dev/problems/unauthenticated',
      title: 'Authentication required',
      status: 401,
      code: 'UNAUTHENTICATED',
      requestId: 'fixture-request-id'
    });
  });
});

describe('캐시 무효화 범위 라우팅', () => {
  const authorized = { authorization: `Bearer ${TOKEN}` };

  test('mart 이름은 해당 resource 무효화 함수 하나로만 간다', async () => {
    const { response, calls } = await dispatch(
      { marts: ['org_round_summary', 'win_rate_distribution_monthly'] },
      authorized
    );
    expect(response.status).toBe(204);
    expect(calls).toEqual(['orgRoundSummary', 'winRateDistributionMonthly']);
  });

  test('공고 전체 무효화는 공고 resource로만 간다', async () => {
    const { response, calls, scopes } = await dispatch({ allAuctions: true }, authorized);
    expect(response.status).toBe(204);
    expect(calls).toEqual(['auctions']);
    expect(scopes).toEqual([{ auctionIds: undefined, allAuctions: true }]);
  });

  test('읽는 화면이 아직 없는 mart 이름도 받아들이되 아무것도 지우지 않는다', async () => {
    const { response, calls } = await dispatch({ marts: ['open_auction_snapshot'] }, authorized);
    expect(response.status).toBe(204);
    expect(calls).toEqual([]);
  });

  test('계약에 없는 본문은 400이고 아무것도 지우지 않는다', async () => {
    for (const body of [{}, { marts: ['org_supplier_summary'] }, { allAuctions: 'yes' }]) {
      const { response, calls } = await dispatch(body, authorized);
      expect(response.status).toBe(400);
      expect(calls).toEqual([]);
    }
  });

  test('JSON이 아닌 본문도 400으로 닫는다', async () => {
    const { calls, revalidators } = recorder();
    const response = await dispatchRevalidate({
      request: new Request('http://web/internal/cache/revalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: 'not json'
      }),
      expectedToken: TOKEN,
      revalidators,
      requestId: 'fixture-request-id'
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
