import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { floor90DistributionFixture } from '../__fixtures__/distribution';
import { presentDistribution } from '../_model/present-distribution';
import { OrderBookSummary } from './order-book-summary';

function ladderOf(myRate: string | null) {
  const presentation = presentDistribution(floor90DistributionFixture, { myRate, isRegionScope: false });
  if (presentation.ladder === null) throw new Error('사다리가 있어야 하는 fixture다');
  return presentation.ladder;
}

describe('호가창 요약', () => {
  test('많이 나온 값과 중앙 칸을 비중과 함께 말한다', () => {
    const screen = render(<OrderBookSummary ladder={ladderOf(null)} />);
    expect(screen.getByText('많이 나온 값')).toBeTruthy();
    expect(screen.getByText(/90\.000 ~ 90\.010/)).toBeTruthy();
    expect(screen.getByText(/전체의 24%/)).toBeTruthy();
    expect(screen.getByText('중앙')).toBeTruthy();
    expect(screen.getByText('90.030 ~ 90.040')).toBeTruthy();
  });

  test('내 값을 놓지 않으면 셋째 문장을 그리지 않는다', () => {
    const screen = render(<OrderBookSummary ladder={ladderOf(null)} />);
    expect(screen.queryByText(/낮게 낙찰/)).toBeNull();
  });

  test('내 값 칸은 낮게·위와 따로 같은 칸으로 센다', () => {
    const screen = render(<OrderBookSummary ladder={ladderOf('90.030')} />);
    expect(screen.getByText('내 값 90.030')).toBeTruthy();
    const line = screen.getByText(/낮게 낙찰/).textContent ?? '';
    expect(line).toContain('낮게 낙찰 36');
    expect(line).toContain('위 38');
    expect(line).toContain('같은 칸 8');
  });

  test('추천으로 읽힐 문구를 쓰지 않는다', () => {
    const screen = render(<OrderBookSummary ladder={ladderOf('90.030')} />);
    for (const banned of ['추천', '적정', '안전', '유리', '불리']) {
      expect(screen.container.textContent).not.toContain(banned);
    }
  });
});
