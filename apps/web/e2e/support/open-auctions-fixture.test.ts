import { describe, expect, spyOn, test } from 'bun:test';
import { auctionV1Operations, openAuctionListV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';

import { presentOpenAuctionList } from '../../src/app/(workspace)/today/_model/present-open-auctions';

import { openAuctionsResponse } from './open-auctions-fixture';

const operation = auctionV1Operations.listOpen;

function 목록요청(query: string): Request {
  return new Request(`http://fixture.invalid${operation.openApiPath}?${query}`);
}

async function 본문(query: string) {
  const response = openAuctionsResponse(목록요청(query));
  expect(response).not.toBeNull();
  expect(response!.status).toBe(200);
  return openAuctionListV1ResponseSchema.parse(await response!.json());
}

// 2026-09-11에 계약이 `eligibilityAreas`를 필수로 늘렸는데 이 fixture가 따라가지 않아 자기 응답을 계약으로
// 검증하다 500을 냈다. 그 사실을 브라우저를 띄워야만 알 수 있었고 main이 11시간 빨갰다. 이 검사는 같은
// 어긋남을 브라우저 없이 잡는다(ADR 0050 결정 5).
describe('열린 공고 목록 fixture와 공개 계약', () => {
  test('낮·밤·연말·자정에도 오늘과 내일 마감 행을 같은 KST 날짜 기준으로 재현한다', async () => {
    for (const nowIso of [
      '2026-09-14T00:00:00Z',
      '2026-09-14T13:00:00Z',
      '2026-12-31T14:59:59Z',
      '2026-09-14T15:00:00Z'
    ]) {
      const clock = spyOn(Date, 'now').mockReturnValue(Date.parse(nowIso));
      try {
        const body = await 본문('limit=50&state=open');
        const presentation = presentOpenAuctionList(body, nowIso);
        if (presentation.view.kind !== 'list') throw new Error('목록 fixture가 목록을 반환해야 합니다.');
        expect(presentation.view.rows.map((row) => row.closes.tone)).toEqual([
          'today', 'tomorrow', 'later', 'unknown'
        ]);
      } finally {
        clock.mockRestore();
      }
    }
  });

  test('화면이 실제로 보내는 질의에 계약을 만족하는 목록을 낸다', async () => {
    const body = await 본문('limit=50&state=open');

    expect(body.auctions.length).toBeGreaterThan(0);
    expect(body.meta.sampleCount).toBe(body.auctions.length);
  });

  test('모든 행이 참가제한지역 필드를 싣고 관측·미관측 두 상태를 모두 재현한다', async () => {
    const body = await 본문('limit=50&state=open');

    for (const auction of body.auctions) {
      expect(auction).toHaveProperty('eligibilityAreas');
    }
    expect(body.auctions.some((auction) => auction.eligibilityAreas !== null)).toBe(true);
    expect(body.auctions.some((auction) => auction.eligibilityAreas === null)).toBe(true);
  });

  test('거르는 질의에서도 남은 행이 계약을 만족한다', async () => {
    const 지역만 = await 본문('limit=50&state=open&region=41');
    const 품목만 = await 본문('limit=50&state=open&item=김치');

    expect(지역만.auctions.length).toBeGreaterThan(0);
    expect(품목만.auctions.length).toBe(1);
  });
  test('제한지역을 고르면 매칭과 미관측이 나뉘고 둘의 합이 표본 수다', async () => {
    const body = await 본문('limit=50&state=open&eligibilityArea=9101');

    expect(body.meta.eligibilityArea).toEqual(['9101']);
    expect(body.meta.eligibilityMatchedCount).toBeGreaterThan(0);
    expect(body.meta.eligibilityUnobservedCount).toBeGreaterThan(0);
    expect(body.meta.eligibilityMatchedCount! + body.meta.eligibilityUnobservedCount!)
      .toBe(body.meta.sampleCount);
  });

  test('제한지역을 안 고르면 나눈 수가 둘 다 null이다', async () => {
    const body = await 본문('limit=50&state=open');

    expect(body.meta.eligibilityArea).toBeNull();
    expect(body.meta.eligibilityMatchedCount).toBeNull();
    expect(body.meta.eligibilityUnobservedCount).toBeNull();
  });
});
