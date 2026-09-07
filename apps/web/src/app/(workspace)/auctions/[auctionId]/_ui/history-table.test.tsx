import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { FORBIDDEN_VERDICT_WORDS } from '../_model/verdict-vocabulary';
import { BidRateProvider } from './bid-rate-context';
import { HistoryTable } from './history-table';

const presentation = presentHistory(attemptsFixture, null);

// initialRate는 사용자가 URL `rate`에 남긴 값을 흉내 낸다. 화면 자체의 시작값은 없다(EAT-84).
function renderTable(initialRate: string | null) {
  return render(
    <BidRateProvider initialRate={initialRate}>
      <HistoryTable rows={presentation.rows} />
    </BidRateProvider>
  );
}

describe('과거 회차 표', () => {
  test('손잡이 값이 없으면 마지막 열 머리는 값을 넣으라는 안내이고 어떤 회차도 판정하지 않는다', () => {
    const screen = renderTable(null);
    expect(screen.container.querySelector('thead th:last-child')?.textContent).toBe('값을 넣으면 계산');
    expect(screen.queryByText(/썼다면/)).toBeNull();
    const lastCells = [...screen.container.querySelectorAll('tbody tr')].map((row) => row.querySelector('td:last-child')?.textContent);
    expect(new Set(lastCells)).toEqual(new Set(['—']));
  });

  test('최근 12회만 그리고 마지막 열 머리에 지금 값을 적는다', () => {
    const screen = renderTable('90.000');
    expect(screen.container.querySelectorAll('tbody tr').length).toBe(12);
    expect(screen.getByText('90.000 썼다면')).toBeTruthy();
  });

  test('열 머리는 순서와 함께 비율 열의 축을 사정률·투찰률로 밝힌다', () => {
    const screen = renderTable('90.000');
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    // 같은 percentage-point지만 분모가 다르다. 축을 적지 않으면 네 열이 한 눈금으로 읽힌다(AGENTS 15).
    expect(headers).toEqual([
      '개찰', '품목', '낙찰률(사정률)', '2등가(사정률)', '그날 하한(투찰률)', '낙찰 업체', '명단', '90.000 썼다면'
    ]);
  });

  test('명단 셀은 참여 수와 그날 하한 아래 수를 함께 보인다', () => {
    // 원본에는 무효 판정이 없다. 우리가 센 것은 그날 하한 아래로 들어온 명단 행 수뿐이다(PDR-0002).
    const screen = renderTable('90.000');
    const first = screen.container.querySelectorAll('tbody tr')[0];
    expect(first.textContent).toContain('91 하한 아래 5');
  });

  test('그날 하한을 밑도는 값이면 낙찰값과 견주지 않고 하한 아래로 적는다', () => {
    // 2026-06-12 회차의 그날 하한은 90.133이라 90.000은 하한 아래이고, 낙찰률 90.303은 애초에 따지지 않는다.
    const screen = renderTable('90.000');
    const row = [...screen.container.querySelectorAll('tbody tr')].find((node) => node.textContent?.includes('26-06-12'));
    const cells = [...(row?.querySelectorAll('td') ?? [])];
    expect(cells[cells.length - 1].textContent).toBe('하한 아래');
    // 하한 위였던 회차는 낙찰값과 견준다. 2026-08-10은 하한 89.847이라 90.000이 낙찰값 이하다.
    const won = [...screen.container.querySelectorAll('tbody tr')].find((node) => node.textContent?.includes('26-08-10'));
    const wonCells = [...(won?.querySelectorAll('td') ?? [])];
    expect(wonCells[wonCells.length - 1].textContent).toBe('낙찰값 이하');
  });

  test('표 어디에도 원본 판정 코드에 없는 판정어가 나오지 않는다', () => {
    const screen = renderTable('90.000');
    const text = screen.container.textContent ?? '';
    for (const word of FORBIDDEN_VERDICT_WORDS) expect(text).not.toContain(word);
  });
});
