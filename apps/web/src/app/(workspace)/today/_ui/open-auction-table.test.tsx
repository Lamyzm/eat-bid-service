import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { presentOpenAuctionList } from '../_model/present-open-auctions';
import { OpenAuctionTable } from './open-auction-table';

const presentation = presentOpenAuctionList(openAuctionsFixture, fixtureNow);

function renderTable() {
  return render(<OpenAuctionTable rows={presentation.rows} search={{ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72 }} />);
}

describe('열린 공고 표', () => {
  test('마감 임박 순서를 응답 순서 그대로 렌더하고 열 머리에 비율 축을 밝힌다', () => {
    const screen = renderTable();
    const rows = [...screen.container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-closes'))).toEqual(['today', 'tomorrow', 'later', 'unknown']);
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    expect(headers).toEqual(['기관', '품목', '기초금액', '하한(사정률)', '마감', '참여 수', '보통 참여', '최근 낙찰(투찰률)', '내 기록', '']);
  });

  test('오늘 마감 행에만 빨강을 붙이고 내일 마감은 amber이며 다른 열에는 상태색이 없다', () => {
    const screen = renderTable();
    const destructive = [...screen.container.querySelectorAll('.text-destructive')];
    expect(destructive.length).toBe(1);
    expect(destructive[0]!.textContent).toContain('D-0');
    expect(destructive[0]!.closest('td')!.textContent).toContain('20:00');
    const amber = [...screen.container.querySelectorAll('.text-pushed')];
    expect(amber.length).toBe(1);
    expect(amber[0]!.textContent).toContain('D-1');
    // 색은 마감 셀 안에만 있다. 헤더·기관·금액 셀에는 없다.
    expect(screen.container.querySelectorAll('thead .text-destructive, thead .text-pushed').length).toBe(0);
  });

  test('기관 요약이 없는 행은 요약 열을 미확인으로 두고 행을 숨기지 않는다', () => {
    const screen = renderTable();
    const later = [...screen.container.querySelectorAll('tbody tr')][2]!;
    expect(later.textContent).toContain('기관 미확인');
    expect(later.textContent).toContain('미확인');
    expect([...later.querySelectorAll('td')].filter((cell) => cell.textContent === '—').length).toBe(2);
    expect(screen.container.querySelectorAll('tbody tr').length).toBe(4);
  });

  test('내 기록 열은 옅은 없음을 렌더하고 열기 링크는 결정 화면을 가리킨다', () => {
    const screen = renderTable();
    expect(screen.getAllByText('없음').length).toBe(4);
    const links = screen.getAllByRole('link', { name: '열기' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/auctions/5796468', '/auctions/5796470', '/auctions/5796471', '/auctions/5796472']);
  });

  test('지역·품목 링크는 다른 조건을 지우지 않고 id·라벨로 조건을 더한다', () => {
    const screen = renderTable();
    expect(screen.getAllByRole('link', { name: '창원시' })[0]!.getAttribute('href')).toBe('/today?region=43&closesWithinHours=72');
    expect(screen.getAllByRole('link', { name: '축산' })[0]!.getAttribute('href')).toBe('/today?item=%EC%B6%95%EC%82%B0&closesWithinHours=72');
  });
});
