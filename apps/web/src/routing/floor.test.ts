import { describe, expect, test } from 'bun:test';

import { buildFloorRoute } from './floor';

describe('하한선 자리 주소', () => {
  test('기본값(최근 1년·공고별)은 주소에서 빼고 지역은 늘 싣는다', () => {
    expect(buildFloorRoute({ region: '459' })).toBe('/floor?region=459');
    expect(buildFloorRoute({ region: '459', period: '1y', view: 'points' })).toBe('/floor?region=459');
  });

  test('기간·보기·달을 순서대로 싣는다', () => {
    expect(buildFloorRoute({ region: '459', period: '3y', view: 'months', month: '2024-03' })).toBe('/floor?region=459&period=3y&view=months&month=2024-03');
  });
});
