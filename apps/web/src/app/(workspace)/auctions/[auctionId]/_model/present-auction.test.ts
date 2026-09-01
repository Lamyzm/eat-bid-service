import { describe, expect, test } from 'bun:test';

import { auctionFixture } from '../__fixtures__/auction';
import { presentAuction } from './present-auction';

describe('공고 화면 표현 모델', () => {
  test('정확한 금액 문자열을 Number 변환 없이 통화와 함께 표시한다', () => {
    const presentation = presentAuction(auctionFixture);

    expect(presentation.baseAmount).toEqual({
      raw: '9007199254740993.50',
      text: '9,007,199,254,740,993.50 KRW'
    });
    expect(presentation.plannedAmount).toEqual({ raw: null, text: '미확인' });
  });

  test('nullable 일정은 발명한 날짜 대신 미확인으로 표현한다', () => {
    const presentation = presentAuction(auctionFixture);

    expect(presentation.schedule).toEqual({
      announcedAt: '2026-08-30T00:00:00Z',
      deadlineAt: '미확인',
      openedAt: '미확인'
    });
  });

  test('식별자와 revision 및 provenance 원문을 별도 필드로 보존한다', () => {
    const presentation = presentAuction(auctionFixture);

    expect(presentation.identity).toEqual(auctionFixture.identity);
    expect(presentation.provenance).toEqual(auctionFixture.provenance);
    expect(JSON.stringify(presentation)).not.toMatch(/recommend|predict|사정률|투찰가/i);
  });
});
