import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';

import { attemptsFixture } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/attempts';
import { attemptKeys, presentHistory } from '../model/attempt-history';
import { FORBIDDEN_VERDICT_WORDS } from '@/app/(workspace)/auctions/[auctionId]/_features/rehearsal/model/verdict-vocabulary';
import { BidRateProvider } from '@/app/(workspace)/auctions/[auctionId]/_lib/bid-rate-context';
import { HistoryTable } from './history-table';
import { AttemptSelectionProvider } from '@/app/(workspace)/auctions/[auctionId]/_lib/attempt-selection';

const presentation = presentHistory(attemptsFixture, null);

// initialRate는 사용자가 URL `rate`에 남긴 값을 흉내 낸다. 화면 자체의 시작값은 없다(EAT-84).
function renderTable(initialRate: string | null, rows = presentation.rows) {
  return render(
    <BidRateProvider initialRate={initialRate}>
      <AttemptSelectionProvider attempts={attemptKeys(rows)}>
        <HistoryTable rows={rows} />
      </AttemptSelectionProvider>
    </BidRateProvider>
  );
}

describe('과거 회차 표', () => {
  test('사용자가 값을 넣기 전에는 가정 계산 열 없이 관측 기록만 보인다', () => {
    const screen = renderTable(null);
    expect(screen.container.querySelector('thead th:last-child')?.textContent).toBe('명단');
    expect(screen.queryByText(/^\d+\.\d{3} 기준$/)).toBeNull();
    expect(screen.queryByText('값을 넣으면 계산')).toBeNull();
    expect(screen.container.querySelectorAll('thead th').length).toBe(5);
  });

  test('받은 행을 그대로 그리고 몇 행인지는 정하지 않는다', () => {
    // 12행 상한은 일반 카드의 composition 책임이다. 표가 다시 자르면 확대에서 같은 표를 쓸 수 없다(EAT-115).
    const screen = renderTable('90.000');
    expect(screen.container.querySelectorAll('tbody tr').length).toBe(presentation.rows.length);
    expect(presentation.rows.length).toBeGreaterThan(12);
    expect(screen.getByText('90.000 기준')).toBeTruthy();

    const three = renderTable('90.000', presentation.rows.slice(0, 3));
    expect(three.container.querySelectorAll('tbody tr').length).toBe(3);
  });

  test('열 머리는 순서와 함께 비율 열의 축을 사정률·투찰률로 밝힌다', () => {
    const screen = renderTable('90.000');
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    // 같은 percentage-point지만 분모가 다르다. 축을 적지 않으면 두 열이 한 눈금으로 읽힌다(AGENTS 15).
    // 사용자가 뺀 그날 하한·낙찰 업체 열은 여기 없어야 한다(EAT-115).
    expect(headers).toEqual([
      '개찰',
      '품목',
      '낙찰률(사정률)',
      '2등가(사정률)',
      '명단',
      '90.000 기준'
    ]);
  });

  test('명단 셀은 참여 수와 기록 진입만 담고 하한 아래 수 같은 내부 세부는 명단 상세에 맡긴다', () => {
    const screen = renderTable('90.000');
    const listCell = screen.container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[4]!;
    expect(listCell.textContent).toBe('91기록 보기');
    expect(listCell.textContent).not.toContain('하한 아래');
  });

  test('열 머리는 세로로도 고정돼 확대 표가 안에서 스크롤해도 남는다', () => {
    const screen = renderTable('90.000');
    const headers = [...screen.container.querySelectorAll('thead th')];
    for (const header of headers) {
      expect(header.className).toContain('sticky');
      expect(header.className).toContain('top-0');
    }
    // 양 끝 고정 열은 두 축이 만나는 모서리라 나머지 머리(z-20)보다 위에 있어야 서로 덮지 않는다.
    expect(headers[0]!.className).toContain('z-30');
    expect(headers[headers.length - 1]!.className).toContain('z-30');
    expect(headers[1]!.className).toContain('z-20');
  });

  test('기록 진입은 이름이 보이는 버튼이고 누르면 그 회차만 선택된다', () => {
    const screen = renderTable('90.000');
    const buttons = screen.getAllByRole('button', { name: /회차 참여 기록 보기$/ });
    // 작은 숫자가 아니라 이름으로 진입하고, 기본 button이라 Tab과 Enter로도 같은 자리에 닿는다.
    expect(buttons[0]!.textContent).toBe('기록 보기');
    expect(buttons[0]!.tagName).toBe('BUTTON');
    expect(buttons[0]!.getAttribute('aria-label')).toContain(presentation.rows[0]!.openedText);

    fireEvent.click(buttons[1]!);

    const rows = [...screen.container.querySelectorAll('tbody tr')];
    const selected = rows.filter((row) => row.hasAttribute('data-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(rows[1]!);
    // 선택은 배경색과 data 속성만으로 말하지 않는다. 호가창의 내 값 줄과 같은 속성으로도 말한다.
    expect(rows.filter((row) => row.getAttribute('aria-current') === 'true')).toEqual([rows[1]!]);
  });

  test('그날 하한을 밑도는 값이면 낙찰값과 견주지 않고 하한 아래로 적는다', () => {
    // 2026-06-12 회차의 그날 하한은 90.133이라 90.000은 하한 아래이고, 낙찰률 90.303은 애초에 따지지 않는다.
    const screen = renderTable('90.000');
    const row = [...screen.container.querySelectorAll('tbody tr')].find((node) =>
      node.textContent?.includes('26-06-12')
    );
    const cells = [...(row?.querySelectorAll('td') ?? [])];
    expect(cells[cells.length - 1].textContent).toBe('하한 아래');
    // 하한 위였던 회차는 낙찰값과 견준다. 2026-08-10은 하한 89.847이라 90.000이 낙찰값 이하다.
    const won = [...screen.container.querySelectorAll('tbody tr')].find((node) =>
      node.textContent?.includes('26-08-10')
    );
    const wonCells = [...(won?.querySelectorAll('td') ?? [])];
    expect(wonCells[wonCells.length - 1].textContent).toBe('낙찰값 이하');
  });

  test('표 어디에도 원본 판정 코드에 없는 판정어가 나오지 않는다', () => {
    const screen = renderTable('90.000');
    const text = screen.container.textContent ?? '';
    for (const word of FORBIDDEN_VERDICT_WORDS) expect(text).not.toContain(word);
  });
});
