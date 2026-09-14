import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { presentOpenAuction, summarizeFloorRates } from '../_model/present-open-auctions';
import { OpenAuctionTable } from './open-auction-table';

const rows = openAuctionsFixture.auctions.map((auction) => presentOpenAuction(auction, fixtureNow));

function renderTable() {
  return render(<OpenAuctionTable rows={rows} search={{ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72 }} floorRates={summarizeFloorRates(rows)} />);
}

describe('열린 공고 표', () => {
  test('마감 임박 순서를 응답 순서 그대로 렌더하고 여섯 칸 중 순번만 머리글을 감춘다', () => {
    const screen = renderTable();
    const rows = [...screen.container.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-closes'))).toEqual(['today', 'tomorrow', 'later', 'unknown']);
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    // 순번 열은 화면에 머리글을 두지 않지만 이름 없는 열은 그 열이 무엇인지 말하지 않는다.
    // 감추는 것은 `th`가 아니라 안쪽 문구다. `th`가 표 흐름을 벗어나면 `scope` 연결과 열 폭이 깨진다.
    expect(headers).toEqual(['순번', '마감', '기관', '품목', '기초금액', '참여']);
    const rank = screen.container.querySelector('thead th')!;
    expect(rank.getAttribute('scope')).toBe('col');
    expect(rank.firstElementChild?.className).toContain('sr-only');
  });

  test('순번은 마감 임박 순의 자리라 응답 순서대로 1부터 센다', () => {
    const screen = renderTable();
    const ranks = [...screen.container.querySelectorAll('tbody tr td:first-child')].map((cell) => cell.textContent);
    expect(ranks).toEqual(['1', '2', '3', '4']);
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

  test('참여 수와 그 판의 보통이 한 칸에 있고 표본 수를 함께 적는다', () => {
    const screen = renderTable();
    const cells = [...screen.container.querySelectorAll('tbody tr td:last-child')].map((cell) => cell.textContent);
    // `5`만 보면 한산한 판인지 아직 안 찬 판인지 알 수 없다. 보통과 표본이 그 옆에 있어야 뜻이 생긴다.
    expect(cells[0]).toBe('5보통 5 · 12회');
    // 중앙값을 낼 회차가 없으면 `—`다. 0으로 채우면 화면이 없는 사실을 말한다.
    expect(cells[1]).toBe('—보통 — · 0회');
    // 요약 자체가 없는 행은 둘째 줄이 아예 없다. 참여 수 `0`은 관측된 값이라 그대로 남는다.
    expect(cells[2]).toBe('0');
  });

  test('하한이 한 종류가 아니면 열을 새로 만들지 않고 드문 쪽만 기초금액 아래에 적는다', () => {
    const screen = renderTable();
    const amounts = [...screen.container.querySelectorAll('tbody tr td:nth-child(5)')].map((cell) => cell.textContent);
    // fixture는 `90` 둘과 `미확인` 둘이다. 흔한 쪽(`90`)은 행에 적지 않고 조건 줄이 말한다.
    expect(amounts[0]).toBe('2,761,700');
    expect(amounts[1]).toBe('43,879,200');
    expect(amounts[2]).toBe('미확인하한 미확인');
    // 하한 열은 없다. 값이 한 종류뿐인 목록에서 한 번도 안 차는 열은 열로 읽히지 않는다.
    expect([...screen.container.querySelectorAll('thead th')].map((node) => node.textContent)).not.toContain('하한(사정률)');
  });

  test('행을 여는 자리는 기관 이름이고 결정 화면을 가리킨다', () => {
    const screen = renderTable();
    expect(screen.queryAllByText('열기').length).toBe(0);
    const links = [...screen.container.querySelectorAll('tbody tr td:nth-child(3) > div > a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/auctions/5796468', '/auctions/5796470', '/auctions/5796471', '/auctions/5796472']);
    expect(links[0]!.textContent).toBe('창원 남산초등학교');
  });

  test('지역·품목 링크는 다른 조건을 지우지 않고 id·라벨로 조건을 더한다', () => {
    const screen = renderTable();
    expect(screen.getAllByRole('link', { name: '창원시' })[0]!.getAttribute('href')).toBe('/today?sido=43&closesWithinHours=72');
    // 링크 문자열은 parser가 직렬화한 그대로다. 한글을 미리 퍼센트 인코딩하지 않아도 브라우저가 요청 전에
    // URL 규격대로 인코딩한다(주소창과 `location.href`는 인코딩된 형태다).
    expect(screen.getAllByRole('link', { name: '축산' })[0]!.getAttribute('href')).toBe('/today?item=축산&closesWithinHours=72');
  });
});
