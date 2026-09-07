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

function renderChart(value: ReturnType<typeof presentHistory>, myRate: string | null = null) {
  return render(
    <BidRateProvider initialRate='90.000'>
      <FlowChart presentation={value} myRate={myRate} />
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

  test('눈금 이름 사정률과 표본·build·계산 버전·모집단 캡션을 함께 보인다', () => {
    const screen = renderChart(presentation);
    expect(screen.container.querySelector('svg')?.textContent).toContain('사정률');
    expect(screen.getByText(
      '표본 92회 · 최근 20회 표시 · build 501 · 계산 mart-r1 · 산출 09-04 09:10 · 모집단 모름'
    )).toBeTruthy();
  });

  test('사정률로 놓은 내 값이 있으면 그 값의 수평선을 긋는다', () => {
    const screen = renderChart(presentation, '90.030');
    expect(screen.getByText('내 값 90.030')).toBeTruthy();
    expect(screen.container.querySelector('[data-slot="flow-my-rate-note"]')).toBeNull();
  });

  test('사정률 내 값이 없으면 레일의 투찰률을 사정률 눈금에 긋지 않고 그 이유를 각주로 남긴다', () => {
    const screen = renderChart(presentation);
    expect(screen.queryByText('내 값 90.000')).toBeNull();
    expect(screen.container.querySelectorAll('line[data-series="my-rate"]').length).toBe(0);
    expect(screen.getByText(/레일의 투찰률 90\.000은 분모가 기초금액이라 사정률 눈금에 놓지 않습니다/)).toBeTruthy();
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
