import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { floor90DistributionFixture } from '../../../__fixtures__/distribution';
import { presentDistribution } from '../model/present-distribution';
import { OrderBook } from './order-book';

function ladderOf(myRate: string | null) {
  const presentation = presentDistribution(floor90DistributionFixture, { myRate, isRegionScope: false });
  if (presentation.ladder === null) throw new Error('사다리가 있어야 하는 fixture다');
  return presentation.ladder;
}

function renderLadder(myRate: string | null = null) {
  return render(<OrderBook ladder={ladderOf(myRate)} caption='전국 · 값마다 낙찰된 횟수' />);
}

describe('호가창 사다리', () => {
  test('남산초 실관측 92회차의 칸별 횟수를 줄마다 그대로 그린다', () => {
    const screen = renderLadder();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(25);
    const cellsOf = (from: string) => {
      const header = screen.getByRole('rowheader', { name: from });
      return [...(header.parentElement?.querySelectorAll('td') ?? [])].map((node) => node.textContent);
    };
    // 서버 단위 test·통합 test와 같은 숫자다. 세 층이 같은 계산을 하는지는 이 대조가 닫는다.
    expect(cellsOf('90.000')[0]).toBe('20');
    expect(cellsOf('90.030')[0]).toBe('8');
    // 관측이 없는 칸도 사다리에서는 0으로 자리를 지킨다.
    expect(cellsOf('90.090')[0]).toBe('0');
  });

  test('막대는 장식이라 접근 가능한 이름을 갖지 않고 숫자가 값을 나른다', () => {
    const screen = renderLadder();
    const bars = screen.container.querySelectorAll('[aria-hidden="true"]');
    expect(bars.length).toBe(25);
    expect(screen.getByRole('table').getAttribute('aria-hidden')).toBeNull();
  });

  test('많이 나온 값 구간은 색이 아니라 텍스트 표식으로도 읽힌다', () => {
    const screen = renderLadder();
    expect(screen.getAllByText('많이 나온 값')).toHaveLength(1);
    const header = screen.getByRole('rowheader', { name: '90.000' });
    expect(header.parentElement?.textContent).toContain('많이 나온 값');
  });

  test('내 값 줄은 aria-current와 텍스트 표식을 함께 갖는다', () => {
    const screen = renderLadder('90.030');
    const marked = [...screen.getAllByRole('row')].filter((row) => row.getAttribute('aria-current') === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain('90.030');
    expect(marked[0]?.textContent).toContain('내 값');
  });

  test('창 밖 표본을 숨기지 않고 위·아래 끝에 건수로 적는다', () => {
    const screen = renderLadder();
    expect(screen.getByText('창 위 낙찰 15건')).toBeTruthy();
    // 하한율 아래로 벗어난 낙찰은 없다. 없는 문장은 그리지 않는다.
    expect(screen.queryByText(/창 아래 낙찰/)).toBeNull();
  });

  test('사다리는 위가 높은 값이다', () => {
    const screen = renderLadder();
    const headers = screen.getAllByRole('rowheader').map((node) => node.textContent);
    expect(headers[0]).toBe('90.120');
    expect(headers.at(-1)).toBe('89.880');
  });

  test('넓은 화면 밖으로 밀리지 않도록 가로 스크롤 컨테이너 안에 든다', () => {
    const screen = renderLadder();
    expect(screen.container.querySelector('.overflow-x-auto')).toBeTruthy();
  });
});
