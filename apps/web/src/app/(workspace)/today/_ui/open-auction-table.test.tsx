import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionsFixture, openSummaryFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { groupClosingDays } from '../_model/group-closing-days';
import { presentOpenAuction } from '../_model/present-open-auctions';
import { presentOpenSummary } from '../_model/present-open-summary';
import { OpenAuctionTable } from './open-auction-table';

const rows = openAuctionsFixture.auctions.map((auction) => presentOpenAuction(auction, fixtureNow));
const summary = presentOpenSummary(openSummaryFixture, fixtureNow, EMPTY_TODAY_SEARCH);

function renderTable() {
  return render(
    <OpenAuctionTable
      groups={groupClosingDays(rows, fixtureNow, summary)}
      search={{ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72 }}
      floorRates={summary.floorSpread}
      organizationCount={summary.organizationCount}
      observedText={summary.latestObservedText}
    />
  );
}

describe('열린 공고 표', () => {
  test('마감 임박 순서를 응답 순서 그대로 렌더하고 여덟 칸 중 순번만 머리글을 감춘다', () => {
    const screen = renderTable();
    const rendered = [...screen.container.querySelectorAll('tbody tr[data-closes]')];
    expect(rendered.map((row) => row.getAttribute('data-closes'))).toEqual(['today', 'tomorrow', 'later', 'unknown']);
    const headers = [...screen.container.querySelectorAll('thead th')].map((node) => node.textContent);
    // 순번 열은 화면에 머리글을 두지 않지만 이름 없는 열은 그 열이 무엇인지 말하지 않는다.
    // 감추는 것은 `th`가 아니라 안쪽 문구다. `th`가 표 흐름을 벗어나면 `scope` 연결과 열 폭이 깨진다.
    // 오른쪽 두 칸이 우리만 가진 값이다. 지난번은 개별 회차의 관측이고 보통은 코호트의 중앙값이라 갈라 둔다.
    expect(headers).toEqual([
      '순번', '마감개찰 한 시간 뒤', '기관2곳', '품목저장된 라벨', '기초금액저장된 값', '참여09-07 10:00 기준',
      '지난번같은 하한 직전', '보통중앙값 · 표본'
    ]);
    const rank = screen.container.querySelector('thead th')!;
    expect(rank.getAttribute('scope')).toBe('col');
    expect(rank.firstElementChild?.className).toContain('sr-only');
  });

  test('머리글 아래 한 줄이 그 열의 값이 어디서 온 값인지 말한다', () => {
    const screen = renderTable();
    // 기관 수는 행 수와 다르다. 한 기관이 품목별로 여러 건을 내므로 네 행이 두 곳이다.
    expect(screen.getByText('2곳')).toBeTruthy();
    // 참여 수는 지금이 아니라 마지막 훑기의 값이다. 열 이름만으로는 그 사실이 안 보인다(AGENTS 7).
    expect(screen.getByText('09-07 10:00 기준')).toBeTruthy();
    expect(screen.getByText('저장된 라벨')).toBeTruthy();
    // 개찰은 마감 한 시간 뒤다. 89,576회차 중 84,265건(94.1%)이 정확히 한 시간이고 p05·p95가 같다
    // (2026-09-14 실측). 마감 시각만으로는 언제 결과가 나오는지 말하지 않는다.
    expect(screen.getByText('개찰 한 시간 뒤')).toBeTruthy();
  });

  test('마감일이 바뀌는 자리에서 끊고 그 머리가 날짜·요일·남은 날과 두 건수를 말한다', () => {
    const screen = renderTable();
    // 조건을 푼 수는 접힌 열의 자리를 만들지 않으려고 같은 행의 다른 칸에 서므로 행 전체를 읽는다.
    const heads = [...screen.container.querySelectorAll('tbody th[scope="colgroup"]')].map((node) => node.closest('tr')!.textContent);
    expect(heads).toEqual([
      '9월 7일월요일 · 오늘1건3건 중',
      '9월 8일화요일 · 내일1건2건 중',
      '9월 10일목요일 · 사흘 뒤2건5건 중',
      '마감 미확인'
    ]);
    // 머리가 날짜를 말하므로 행의 마감 칸에는 시각만 남는다.
    const clocks = [...screen.container.querySelectorAll('tbody tr[data-closes] td:nth-child(2)')].map((cell) => cell.textContent);
    expect(clocks).toEqual(['20:00', '00:30', '11:00', '']);
  });

  test('순번은 묶음마다 1로 돌아가지 않고 목록 전체에서 이어진다', () => {
    const screen = renderTable();
    const ranks = [...screen.container.querySelectorAll('tbody tr[data-closes] td:first-child')].map((cell) => cell.textContent);
    expect(ranks).toEqual(['1', '2', '3', '4']);
  });

  test('오늘 마감 묶음에만 빨강을 붙이고 내일 마감은 amber이며 행과 다른 열에는 상태색이 없다', () => {
    const screen = renderTable();
    const destructive = [...screen.container.querySelectorAll('.text-destructive')];
    expect(destructive.length).toBe(1);
    expect(destructive[0]!.textContent).toContain('오늘');
    const amber = [...screen.container.querySelectorAll('.text-pushed')];
    expect(amber.length).toBe(1);
    expect(amber[0]!.textContent).toContain('내일');
    // 색이 붙는 자리는 묶음 머리 하나다. 행마다 칠하면 같은 날 스무 행이 통째로 빨개져 임박이 상태가
    // 아니라 배경이 된다. 한동안 제한지역 미관측 배지가 amber를 빌려 쓰고 있었고 그때 이 검사의
    // fixture에 미관측 행이 없어서 규칙이 깨진 것을 못 봤다.
    for (const node of [...destructive, ...amber]) {
      expect(node.closest('[data-slot="closes"]')).not.toBeNull();
      expect(node.closest('tr')!.querySelector('th[scope="colgroup"]')).not.toBeNull();
    }
    expect(screen.container.querySelectorAll('thead .text-destructive, thead .text-pushed').length).toBe(0);
    expect(screen.container.textContent).toContain('제한지역 미관측');
  });

  test('참여·지난번·보통이 각자 열에 서고 참여 0은 비우며 보통에는 표본 수를 함께 적는다', () => {
    const screen = renderTable();
    const column = (nth: number) =>
      [...screen.container.querySelectorAll(`tbody tr[data-closes] td:nth-child(${nth})`)].slice(0, 3).map((cell) => cell.textContent);
    // 참여 0은 빈 칸이다. 값을 버리는 것이 아니라 전면에 세우지 않는 것이며(사용자 결정 2026-09-16), 못 센
    // 판의 `—`와 섞이지 않는다.
    expect(column(6)).toEqual(['5', '—', '']);
    // 지난번은 명단 수·개찰일·하한 아래 수까지이고 낙찰 투찰률은 없다. 개찰된 회차가 없으면 그 사실을 말한다.
    expect(column(7)).toEqual(['17곳 · 09-02 · 하한 아래 2', '개찰 회차 없음', '—']);
    // `5곳`만 보면 다섯 회를 본 것인지 열다섯 회를 본 것인지 알 수 없다. 중앙값을 낼 회차가 없으면 `—`다.
    expect(column(8)).toEqual(['5곳 · 12회', '— · 0회', '—']);
  });

  test('하한이 갈려도 최빈값이 과반이 아니면 어느 행에도 적지 않는다', () => {
    const screen = renderTable();
    const amounts = [...screen.container.querySelectorAll('tbody tr[data-closes] td:nth-child(5)')].map((cell) => cell.textContent);
    // fixture는 `90` 둘과 `미확인` 둘이다. 절반에 배지를 붙이면 `찾을 것이 둘`이라는 뜻이 사라지고
    // 동률을 끊은 쪽이 어디냐에 따라 표가 달라 보인다. 축 줄이 이미 둘을 다 세고 있다.
    expect(amounts).toEqual(['2,761,700', '43,879,200', '미확인', '미확인']);
    // 하한 열은 없다. 한 번도 안 차는 열은 열로 읽히지 않고 기초금액과 참여 사이의 빈 간격으로 읽힌다.
    expect([...screen.container.querySelectorAll('thead th')].map((node) => node.textContent)).not.toContain('하한(사정률)');
  });

  test('최빈 하한이 과반이면 드문 쪽만 기초금액 칸 아래에 붙는다', () => {
    const screen = render(
      <OpenAuctionTable
        groups={groupClosingDays(rows, fixtureNow, summary)}
        search={EMPTY_TODAY_SEARCH}
        // 서른한 판이 `90`이고 여섯 판만 `미확인`인 결과다. 열을 만들지 않고 여섯에만 적는다.
        floorRates={{ axisText: '하한 90 · 31 / 미확인 · 6', rareRates: new Set(['미확인']) }}
        organizationCount={summary.organizationCount}
        observedText={summary.latestObservedText}
      />
    );
    const amounts = [...screen.container.querySelectorAll('tbody tr[data-closes] td:nth-child(5)')].map((cell) => cell.textContent);
    expect(amounts).toEqual(['2,761,700', '43,879,200', '미확인하한 미확인', '미확인하한 미확인']);
  });

  test('행을 여는 자리는 기관 이름이고 결정 화면을 가리킨다', () => {
    const screen = renderTable();
    expect(screen.queryAllByText('열기').length).toBe(0);
    const links = [...screen.container.querySelectorAll('tbody tr[data-closes] td:nth-child(3) > div > a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/auctions/5796468', '/auctions/5796470', '/auctions/5796471', '/auctions/5796472']);
    expect(links[0]!.textContent).toBe('창원 남산초등학교');
  });

  test('라벨을 관측하지 못한 지역은 코드로 적지 않고 아예 비운다', () => {
    const screen = renderTable();
    // 지역 어휘 계약이 없는 동안 `코드 657`은 사용자가 읽을 수 없는 글자이고 기관 이름 아래 줄만 차지한다.
    expect(screen.container.textContent).not.toContain('코드 ');
    expect(screen.getAllByRole('link', { name: '창원시' }).length).toBeGreaterThan(0);
  });

  test('지역·품목 링크는 다른 조건을 지우지 않고 id·라벨로 조건을 더한다', () => {
    const screen = renderTable();
    expect(screen.getAllByRole('link', { name: '창원시' })[0]!.getAttribute('href')).toBe('/today?sido=43&closesWithinHours=72');
    // 링크 문자열은 parser가 직렬화한 그대로다. 한글을 미리 퍼센트 인코딩하지 않아도 브라우저가 요청 전에
    // URL 규격대로 인코딩한다(주소창과 `location.href`는 인코딩된 형태다).
    // 품목 링크가 거는 것은 라벨 전체가 아니라 조각 하나다. 합성 라벨을 통째로 걸면 그 조합을 가진
    // 행만 걸려 `육류`만 있는 행이 빠진다.
    expect(screen.getAllByRole('link', { name: '축산' })[0]!.getAttribute('href')).toBe('/today?items=축산&closesWithinHours=72');
  });
});
