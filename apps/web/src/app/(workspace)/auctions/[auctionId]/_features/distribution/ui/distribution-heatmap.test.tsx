import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { floor90DistributionFixture } from '../../../__fixtures__/distribution';
import { presentDistribution } from '../model/present-distribution';
import { DistributionHeatmap } from './distribution-heatmap';

const ladder = (() => {
  const presentation = presentDistribution(floor90DistributionFixture, { myRate: null, isRegionScope: false });
  if (presentation.ladder === null) throw new Error('사다리가 있어야 하는 fixture다');
  return presentation.ladder;
})();

// `granularity=month` 응답의 모양이다. 달마다 칸이 실린다.
const months: typeof floor90DistributionFixture.months = [
  {
    month: '2026-08',
    sampleCount: 41,
    coverage: 'complete',
    bins: [
      { from: { value: '90.000', unit: 'percentage-points' }, to: { value: '90.010', unit: 'percentage-points' }, count: 10 },
      { from: { value: '90.030', unit: 'percentage-points' }, to: { value: '90.040', unit: 'percentage-points' }, count: 4 }
    ]
  },
  { month: '2026-09', sampleCount: 8, coverage: 'unknown', bins: [] }
];

describe('분포 히트맵', () => {
  test('행은 달이고 열은 사다리와 같은 창을 쓴다', () => {
    const screen = render(<DistributionHeatmap months={months} ladder={ladder} />);
    expect(screen.getByRole('rowheader', { name: '2026-08' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '2026-09' })).toBeTruthy();
    const columns = screen.getAllByRole('columnheader').map((node) => node.textContent);
    expect(columns[0]).toBe('달');
    expect(columns.at(-1)).toBe('표본');
    // 사다리 25칸이 그대로 열이 된다(달 열 + 25칸 + 표본 열).
    expect(columns).toHaveLength(27);
  });

  test('보유율이 나쁜 달과 표본이 적은 달에 사유를 적는다', () => {
    const screen = render(<DistributionHeatmap months={months} ladder={ladder} />);
    const august = screen.getByRole('rowheader', { name: '2026-08' }).parentElement?.textContent ?? '';
    const september = screen.getByRole('rowheader', { name: '2026-09' }).parentElement?.textContent ?? '';
    expect(august).not.toContain('수집 안 됨');
    expect(september).toContain('분모 미확인');
    expect(september).toContain('표본 부족');
  });

  test('768px에서 넘치지 않도록 가로 스크롤 컨테이너 안에 든다', () => {
    const screen = render(<DistributionHeatmap months={months} ladder={ladder} />);
    expect(screen.container.querySelector('.overflow-x-auto')).toBeTruthy();
  });
});
