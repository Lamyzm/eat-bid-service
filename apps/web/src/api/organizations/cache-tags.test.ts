import { describe, expect, test } from 'bun:test';

import { organizationAttemptsReadCacheTags } from './cache-tags';

describe('기관 회차 이력 캐시 태그', () => {
  test('기관 태그와 org_round_summary mart 태그를 함께 건다', () => {
    expect(organizationAttemptsReadCacheTags('3101')).toEqual([
      'org:3101',
      'mart:org_round_summary'
    ]);
  });

  test('mart 태그는 읽은 build id가 아니라 안정된 mart 이름이다', () => {
    const [, martTag] = organizationAttemptsReadCacheTags('3101');
    expect(martTag).not.toContain('build');
  });
});
