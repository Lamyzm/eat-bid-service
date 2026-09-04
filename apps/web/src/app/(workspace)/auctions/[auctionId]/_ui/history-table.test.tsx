import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { HistoryTable } from './history-table';

const presentation = presentHistory(attemptsFixture, null);

function renderTable(initialRate: string) {
  return render(
    <BidRateProvider initialRate={initialRate}>
      <HistoryTable rows={presentation.rows} />
    </BidRateProvider>
  );
}

describe('과거 회차 표', () => {
  test('최근 12회만 그리고 마지막 열 머리에 지금 값을 적는다', () => {
    const screen = renderTable('90.000');
    expect(screen.container.querySelectorAll('tbody tr').length).toBe(12);
    expect(screen.getByText('90.000 썼다면')).toBeTruthy();
  });

  test('열 순서가 개찰·품목·낙찰률·2등가·그날 하한·낙찰 업체·명단·가정이다', () => {
    const screen = renderTable('90.000');
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    expect(headers).toEqual(['개찰', '품목', '낙찰률', '2등가', '그날 하한', '낙찰 업체', '명단', '90.000 썼다면']);
  });

  test('명단 셀은 참여 수와 무효 수를 함께 보인다', () => {
    const screen = renderTable('90.000');
    const first = screen.container.querySelectorAll('tbody tr')[0];
    expect(first.textContent).toContain('91 무효 5');
  });

  test('그날 하한을 밑도는 값이면 낙찰·놓침이 아니라 무효로 적는다', () => {
    // 2026-06-12 회차의 그날 하한은 90.133이라 90.000은 무효, 낙찰률 90.303은 애초에 따지지 않는다.
    const screen = renderTable('90.000');
    const row = [...screen.container.querySelectorAll('tbody tr')].find((node) => node.textContent?.includes('26-06-12'));
    const cells = [...(row?.querySelectorAll('td') ?? [])];
    expect(cells[cells.length - 1].textContent).toBe('무효');
    // 하한이 없던 회차는 무효 판정을 만들지 않는다. 2026-08-10은 하한 89.847이라 90.000이 낙찰이다.
    const won = [...screen.container.querySelectorAll('tbody tr')].find((node) => node.textContent?.includes('26-08-10'));
    const wonCells = [...(won?.querySelectorAll('td') ?? [])];
    expect(wonCells[wonCells.length - 1].textContent).toBe('낙찰');
  });
});
