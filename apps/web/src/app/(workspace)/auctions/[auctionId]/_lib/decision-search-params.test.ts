import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs';

import { decisionSearchParsers } from './decision-search-params';

describe('결정 화면 URL 조건', () => {
  test('기본값은 12개월·전국이고 직렬화에서 생략된다', () => {
    const serialize = createSerializer(decisionSearchParsers);
    expect(serialize({ period: '12개월', scope: '전국' })).toBe('');
    expect(serialize({ period: '지난 달', scope: '이 기관' })).toContain('period=');
  });
  test('허용되지 않은 값은 기본값으로 돌아간다', () => {
    expect(decisionSearchParsers.period.parse('아무거나')).toBeNull();
  });
});
