import { describe, expect, test } from 'bun:test';

import { auctionReadCacheTags } from './cache-tags';

describe('공고 조회 캐시 태그', () => {
  test('공고 하나의 태그와 공고 전체 태그를 함께 건다', () => {
    expect(auctionReadCacheTags('5796468')).toEqual(['auction:5796468', 'allAuctions']);
  });

  test('공고 id가 숫자 식별자가 아니면 태그를 만들지 않는다', () => {
    expect(() => auctionReadCacheTags('창원 남산초등학교')).toThrow();
  });
});
