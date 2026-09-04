import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { FlowChart } from './flow-chart';

const presentation = presentHistory(attemptsFixture, '7');

// 창(89.900~90.700) 밖 값은 fixture에 없다. 화살표 표시를 검증하려면 위·아래로 한 회차씩 밀어야 한다.
const outsideFixture = {
  ...attemptsFixture,
  attempts: attemptsFixture.attempts.map((attempt, index) =>
    index === 0
      ? { ...attempt, winRate: { value: '90.812', unit: 'percentage-points' as const } }
      : index === 1
        ? { ...attempt, winRate: { value: '89.712', unit: 'percentage-points' as const } }
        : attempt
  )
};

function renderChart(value: ReturnType<typeof presentHistory>) {
  return render(
    <BidRateProvider initialRate='90.000'>
      <FlowChart presentation={value} />
    </BidRateProvider>
  );
}

describe('흐름 차트 SVG', () => {
  test('선택 품목 회차 수만큼 채운 점을, 다른 품목은 속 빈 점을 그린다', () => {
    const screen = renderChart(presentation);
    const selected = presentation.rows.filter((row) => row.isSelectedItem).length;
    const other = presentation.rows.length - selected;
    expect(screen.container.querySelectorAll('circle[data-item="selected"]').length).toBe(selected);
    expect(screen.container.querySelectorAll('circle[data-item="other"]').length).toBe(other);
    expect(other).toBeGreaterThan(0);
  });

  test('창 밖 낙찰률은 감추지 않고 경계에 화살표와 숫자로 붙인다', () => {
    const screen = renderChart(presentHistory(outsideFixture, '7'));
    expect(screen.getByText('▲ 90.812')).toBeTruthy();
    expect(screen.getByText('▼ 89.712')).toBeTruthy();
  });

  test('내 값 수평선과 표본·릴리스·계산 버전 캡션을 함께 보인다', () => {
    const screen = renderChart(presentation);
    expect(screen.getByText('내 값 90.000')).toBeTruthy();
    expect(screen.getByText('표본 92회 · 최근 20회 표시 · mart 2026-09-04T00 · 계산 v1 · 산출 09-04 09:10')).toBeTruthy();
  });

  test('낙찰률이 없어 그리지 못한 회차는 표시 회차 수에서 뺀다', () => {
    const withUndetermined = {
      ...attemptsFixture,
      attempts: attemptsFixture.attempts.map((attempt, index) => (index === 0 ? { ...attempt, winRate: null } : attempt))
    };
    const screen = renderChart(presentHistory(withUndetermined, '7'));
    expect(screen.container.querySelectorAll('circle').length).toBe(19);
    expect(screen.getByText(/최근 19회 표시/)).toBeTruthy();
  });
});
