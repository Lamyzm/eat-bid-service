import { afterEach, describe, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { FlowChart } from './flow-chart';
import { resetFlowSeries, toggleFlowSeries } from './flow-legend';

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

afterEach(() => {
  act(() => resetFlowSeries());
});

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

  test('2등 사정률은 꺼진 채 시작하고, 켜면 선택 품목 회차를 점선으로 잇고 회차마다 작은 점을 둔다', () => {
    const screen = renderChart(presentation);
    expect(screen.container.querySelector('g[data-series="runner-up"]')).toBeNull();
    act(() => toggleFlowSeries('runnerUp'));
    const runnerUp = screen.container.querySelector('g[data-series="runner-up"]');
    expect(runnerUp).not.toBeNull();
    expect(runnerUp?.querySelector('polyline')?.getAttribute('stroke-dasharray')).toBe('3 3');
    const withSecond = presentation.rows.filter((row) => row.winRateText !== null && row.secondRateText !== null).length;
    expect(runnerUp?.querySelectorAll('circle').length).toBe(withSecond);
  });

  test('명단 수는 아래 띠의 막대로, 상한을 넘긴 회차는 숫자를 얹어 그린다', () => {
    const screen = renderChart(presentation);
    const bars = screen.container.querySelector('g[data-series="list-count"]');
    expect(bars?.querySelectorAll('rect').length).toBe(presentation.rows.filter((row) => row.listCount !== null).length);
    // fixture의 91·75 같은 회차는 상한 30을 넘어 막대만으로는 크기를 못 읽으므로 숫자가 붙는다.
    expect(bars?.textContent).toContain('91');
    expect(screen.container.querySelector('svg')?.textContent).toContain('30+');
    expect(screen.container.querySelector('svg')?.textContent).toContain('명단');
  });

  test('x축에는 달이 바뀌는 회차마다 KST YY-MM 라벨이 놓인다', () => {
    const screen = renderChart(presentation);
    const labels = [...screen.container.querySelectorAll('g[data-axis="month"] text')].map((node) => node.textContent);
    expect(labels[0]).toBe('24-09');
    // 20회차가 728px에 놓이면 이웃 달 라벨이 겹치므로 일부는 건너뛴다. 그래도 남은 라벨은 fixture의 달이며
    // 시간순을 지키고 중복이 없다.
    const months = new Set(presentation.rows.map((row) => row.openedMonthText));
    expect(labels.every((label) => months.has(label ?? ''))).toBe(true);
    expect(labels.length).toBeGreaterThan(4);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.toSorted()).toEqual(labels);
  });

  test('사정률로 놓은 내 값이 있으면 그 값의 수평선을 긋는다', () => {
    const screen = renderChart(presentation, '90.030');
    expect(screen.getByText('내 값 90.030')).toBeTruthy();
    expect(screen.container.querySelectorAll('line[data-series="my-rate"]').length).toBe(1);
    expect(screen.container.querySelector('[data-slot="flow-my-rate-note"]')).toBeNull();
  });

  test('내 값이 창 밖이면 경계에 선을 붙이지 않고 방향과 범위 밖 표시만 둔다', () => {
    const screen = renderChart(presentation, '90.812');
    expect(screen.container.querySelectorAll('line[data-series="my-rate"]').length).toBe(0);
    expect(screen.container.querySelector('[data-slot="flow-my-rate-outside"]')?.textContent).toBe('내 값 90.812 ▲ 범위 밖');
    expect(renderChart(presentation, '89.000').container.querySelector('[data-slot="flow-my-rate-outside"]')?.textContent).toBe('내 값 89.000 ▼ 범위 밖');
  });

  test('사정률 내 값이 없으면 레일의 투찰률을 사정률 눈금에 긋지 않고 그 이유를 각주로 남긴다', () => {
    const screen = renderChart(presentation);
    expect(screen.queryByText('내 값 90.000')).toBeNull();
    expect(screen.container.querySelectorAll('line[data-series="my-rate"]').length).toBe(0);
    expect(screen.getByText(/레일의 투찰률 90\.000은 분모가 기초금액이라 사정률 눈금에 놓지 않습니다/)).toBeTruthy();
  });

  test('그날 하한은 사정률 창에 긋지 않고 축이 다르다는 각주를 둔다', () => {
    const screen = renderChart(presentation);
    expect(screen.container.querySelector('[data-slot="flow-day-floor-note"]')?.textContent).toContain('기초금액(투찰률)');
    // 이전 슬라이스의 붉은 짧은 눈금이 남아 있으면 사정률 창 위에 투찰률 값이 섞인다(PDR-0004).
    expect(screen.container.querySelectorAll('.text-destructive').length).toBe(0);
  });

  test('범례에서 끈 계열은 차트에서 사라지고 다시 켜면 돌아온다', () => {
    const screen = renderChart(presentation, '90.030');
    act(() => toggleFlowSeries('runnerUp'));
    expect(screen.container.querySelector('g[data-series="runner-up"]')).not.toBeNull();
    act(() => toggleFlowSeries('runnerUp'));
    expect(screen.container.querySelector('g[data-series="runner-up"]')).toBeNull();
    act(() => toggleFlowSeries('listCount'));
    expect(screen.container.querySelector('g[data-series="list-count"]')).toBeNull();
    act(() => toggleFlowSeries('otherItems'));
    expect(screen.container.querySelectorAll('circle[data-item="other"]').length).toBe(0);
    act(() => toggleFlowSeries('win'));
    expect(screen.container.querySelectorAll('circle[data-item="selected"]').length).toBe(0);
    act(() => toggleFlowSeries('myRate'));
    expect(screen.container.querySelectorAll('line[data-series="my-rate"]').length).toBe(0);
    act(() => toggleFlowSeries('win'));
    expect(screen.container.querySelectorAll('circle[data-item="selected"]').length).toBeGreaterThan(0);
  });

  test('낙찰률이 없어 그리지 못한 회차는 표시 회차 수에서 뺀다', () => {
    const withUndetermined = {
      ...attemptsFixture,
      attempts: attemptsFixture.attempts.map((attempt, index) => (index === 0 ? { ...attempt, winRate: null } : attempt))
    };
    const screen = renderChart(presentHistory(withUndetermined, '7'));
    expect(screen.container.querySelectorAll('circle[data-item]').length).toBe(19);
    expect(screen.getByText(/최근 19회 표시/)).toBeTruthy();
  });
});
