import { describe, expect, test } from 'bun:test';

import { cn } from './cn';

describe('클래스 충돌 해소(cn)', () => {
  test('글자 단 이름과 글자 색은 서로 지우지 않는다', () => {
    expect(cn('text-primary-foreground', 'text-body')).toBe('text-primary-foreground text-body');
  });

  test('같은 축의 글자 단은 뒤의 것이 이긴다', () => {
    expect(cn('text-body', 'text-label')).toBe('text-label');
    expect(cn('text-sm', 'text-title')).toBe('text-title');
  });

  test('반경·폭 이름도 같은 축으로 읽는다', () => {
    expect(cn('rounded-lg', 'rounded-panel')).toBe('rounded-panel');
    expect(cn('max-w-xl', 'max-w-page')).toBe('max-w-page');
  });
});
