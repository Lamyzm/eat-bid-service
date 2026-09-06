import { describe, expect, test } from 'bun:test';

import { winRateDistributionReadCacheTags } from './cache-tags';

describe('낙찰률 분포 캐시 태그', () => {
  test('코호트와 무관하게 mart 이름 태그 하나만 건다', () => {
    expect(winRateDistributionReadCacheTags()).toEqual(['mart:win_rate_distribution_monthly']);
  });
});
