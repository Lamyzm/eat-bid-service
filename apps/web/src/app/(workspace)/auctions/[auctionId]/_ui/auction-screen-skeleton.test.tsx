import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { AuctionScreenSkeleton } from './auction-screen-skeleton';

describe('공고 상세 로딩 화면', () => {
  test('실제 화면과 같은 frame의 두 section을 단일 한국어 loading region으로 제공한다', () => {
    const screen = render(<AuctionScreenSkeleton />);
    const status = screen.getByRole('status', { name: '공고 정보를 불러오는 중' });
    const frame = screen.container.querySelector('[data-slot="auction-screen"]');

    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('공고 정보를 불러오는 중');
    expect(frame).not.toBeNull();
    if (!frame) throw new Error('공고 loading frame이 필요합니다.');
    expect(frame.querySelectorAll(':scope > section')).toHaveLength(2);
    expect(frame.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(frame.querySelectorAll('[data-slot="skeleton"][aria-hidden="true"]')).toHaveLength(
      frame.querySelectorAll('[data-slot="skeleton"]').length
    );
  });
});
