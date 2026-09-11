import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { presentOpenAuction } from '../_model/present-open-auctions';
import { OpenAuctionTable } from './open-auction-table';

const rows = openAuctionsFixture.auctions.map((auction) => presentOpenAuction(auction, fixtureNow));

function renderTable() {
  return render(<OpenAuctionTable rows={rows} search={{ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72 }} />);
}

describe('열린 공고 표', () => {
  test('마감 임박 순서를 응답 순서 그대로 렌더하고 열 머리에 비율 축을 밝힌다', () => {
    const screen = renderTable();
    const rows = [...screen.container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-closes'))).toEqual(['today', 'tomorrow', 'later', 'unknown']);
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    // 마지막 행동 열은 화면에 머리글을 두지 않지만 이름 없는 열은 그 열이 무엇인지 말하지 않는다.
    // 감추는 것은 `th`가 아니라 안쪽 문구다. `th`가 표 흐름을 벗어나면 `scope` 연결과 열 폭이 깨진다.
    expect(headers).toEqual(['기관', '품목', '기초금액', '하한(사정률)', '마감', '참여 수', '보통 참여', '최근 낙찰(투찰률)', '열기']);
    const open = [...screen.container.querySelectorAll('thead th')].at(-1)!;
    expect(open.getAttribute('scope')).toBe('col');
    expect(open.firstElementChild?.className).toContain('sr-only');
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
    // 색은 마감 셀 안에만 있다. 헤더·기관·금액 셀에는 없다. 한동안 제한지역 미관측 배지가 amber를
    // 빌려 쓰고 있었고, 그때 이 검사의 fixture에 미관측 행이 없어서 규칙이 깨진 것을 못 봤다.
    for (const node of [...destructive, ...amber]) {
      expect(node.closest('[data-slot="closes"]')).not.toBeNull();
    }
    expect(screen.container.querySelectorAll('thead .text-destructive, thead .text-pushed').length).toBe(0);
    expect(screen.container.textContent).toContain('제한지역 미관측');
  });

  test('기관 요약이 없는 행은 요약 열을 미확인으로 두고 행을 숨기지 않는다', () => {
    const screen = renderTable();
    const later = [...screen.container.querySelectorAll('tbody tr')][2]!;
    expect(later.textContent).toContain('기관 미확인');
    expect(later.textContent).toContain('미확인');
    expect([...later.querySelectorAll('td')].filter((cell) => cell.textContent === '—').length).toBe(2);
    expect(screen.container.querySelectorAll('tbody tr').length).toBe(4);
  });

  test('아직 값이 없는 내 기록은 열 자체를 두지 않고 열기 링크는 결정 화면을 가리킨다', () => {
    const screen = renderTable();
    expect(screen.queryAllByText('없음').length).toBe(0);
    const links = screen.getAllByRole('link', { name: '열기' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/auctions/5796468', '/auctions/5796470', '/auctions/5796471', '/auctions/5796472']);
  });

  test('지역·품목 링크는 다른 조건을 지우지 않고 id·라벨로 조건을 더한다', () => {
    const screen = renderTable();
    expect(screen.getAllByRole('link', { name: '창원시' })[0]!.getAttribute('href')).toBe('/today?region=43&closesWithinHours=72');
    // 링크 문자열은 parser가 직렬화한 그대로다. 한글을 미리 퍼센트 인코딩하지 않아도 브라우저가 요청 전에
    // URL 규격대로 인코딩한다(주소창과 `location.href`는 인코딩된 형태다).
    expect(screen.getAllByRole('link', { name: '축산' })[0]!.getAttribute('href')).toBe('/today?item=축산&closesWithinHours=72');
  });
});
