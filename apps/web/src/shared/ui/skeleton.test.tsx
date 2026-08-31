import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { Skeleton } from './skeleton';

describe('공통 Skeleton atom', () => {
  test('장식 요소로 숨기고 움직임 축소와 class 주입을 지원한다', () => {
    const screen = render(<Skeleton className='h-8 w-24' data-testid='뼈대' />);
    const skeleton = screen.getByTestId('뼈대');

    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.getAttribute('data-slot')).toBe('skeleton');
    expect(skeleton.className).toContain('animate-pulse');
    expect(skeleton.className).toContain('motion-reduce:animate-none');
    expect(skeleton.className).toContain('h-8 w-24');
  });
});
