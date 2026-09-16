import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { fixtureNow, noSnapshotFixture, openAuctionsFixture, openSummaryFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import type { TodayPageData } from '../_model/load-today-page';
import { presentOpenAuctionList } from '../_model/present-open-auctions';
 import { presentOpenSummary } from '../_model/present-open-summary';
import { TodayScreen } from './today-screen';
import { TodayScreenSkeleton } from './today-screen-skeleton';
import { TodayCalendar } from './today-tabs';

const confirmedAreas = [
  { codeValueId: '9101', code: '15000', label: '경남/전체' },
  { codeValueId: '9102', code: '15653', label: '경남/김해시' }
];

const ready: TodayPageData = {
  nowIso: fixtureNow,
  regionGate: { kind: 'applied', areas: confirmedAreas },
  search: EMPTY_TODAY_SEARCH,
  presentation: presentOpenAuctionList(openAuctionsFixture, fixtureNow),
  summary: presentOpenSummary(openSummaryFixture, fixtureNow, EMPTY_TODAY_SEARCH),
  combinations: null,
  cursorReset: false
};

describe('오늘 화면', () => {
  test('서버 markup에 프레임·제목·기준 시각·조건·표가 있다', () => {
    const markup = renderToStaticMarkup(<TodayScreen data={ready} />);
    expect(markup).toContain('data-slot="today-screen"');
    expect(markup).toContain('aria-labelledby="today-title"');
    // 건수는 머리 문장이 한 번만 말한다. 축 줄의 `하한 N · N건`은 사용자 결정으로 없앴고(EAT-241) 탭 줄도
    // 없다(U9) — 같은 수가 두 자리에 서면 page-level 숫자 hero가 둘이 된다(screen-system §9.1).
    expect(markup).toContain('진행중 </span><b');
    expect(markup).toContain('셀 수 없어요');
    expect(markup).not.toContain('열린 공고 4건');
    expect(markup).not.toContain('하한 90');
    expect(markup).toContain('09-07 10:30 기준');
    // 마감일 묶음 머리가 순서를 보여 주므로 `마감 임박 순`이라는 제목이 따로 없다.
    expect(markup).toContain('9월 7일');
    expect(markup).toContain('열린 공고 스냅샷 build 601');
    for (const banned of ['무효', '추천', '안전 구간', '예측']) expect(markup).not.toContain(banned);
  });

  test('달력 아래 검색 칸은 GET form이고 다른 조건을 hidden으로 함께 보내며 검색 중이면 범위와 건수를 말한다', () => {
    const search = { ...EMPTY_TODAY_SEARCH, sido: '41', q: '남산' };
    const screen = render(<TodayScreen data={{ ...ready, search }} />);
    const form = screen.getByRole('search');
    const input = screen.getByRole('searchbox', { name: '학교 이름이나 공고로 찾기' });
    expect(input.getAttribute('name')).toBe('q');
    expect(input.getAttribute('value')).toBe('남산');
    expect(form.querySelector('input[type="hidden"][name="sido"]')?.getAttribute('value')).toBe('41');
    // 검색은 다른 조건을 풀지 않는다. 그 사실과 건수를 문장이 말하고 지우기는 검색어만 뗀다.
    expect(form.textContent).toContain('지금 조건 안에서 “남산” · 4건');
    expect(screen.getByRole('link', { name: '검색 지우기' }).getAttribute('href')).toBe('/today?sido=41');
    // 공고번호는 eaT로 건너가는 손잡이라 행에 보이고 누르면 복사된다. 상세를 아직 안 딴 행에는 없다.
    expect(screen.getAllByRole('button', { name: '공고번호 복사 2026-0001' })).toHaveLength(2);
  });

  test('왼쪽 조건 기둥이 먼저 오고 그 뒤가 조건·열린 공고이며 오른쪽 rail은 없다', () => {
    const screen = render(<TodayScreen data={ready} />);
    const labels = [...screen.container.querySelectorAll('section, aside')].map((node) => node.getAttribute('aria-label'));
    // 좁힌 조건은 목록 옆에 계속 남는다. 본문 위에 가로로 두면 스크롤할 때 사라져 자기 조건을 잊는다.
    expect(labels).toEqual(['내 조건', '조건', '열린 공고']);
  });

  test('계보가 없으면 아직 만들어지지 않았다고 말하고 오류를 내지 않는다', () => {
    const screen = render(
      <TodayScreen data={{ ...ready, presentation: presentOpenAuctionList(noSnapshotFixture, fixtureNow) }} />
    );
    expect(screen.getByText('열린 공고 스냅샷이 아직 만들어지지 않았습니다.')).toBeTruthy();
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull();
    expect(screen.container.querySelector('table')).toBeNull();
  });

  test('결과가 0이면 적용된 조건을 문장으로 되풀이하고 조건을 자동으로 넓히지 않는다', () => {
    const empty = { ...openAuctionsFixture, auctions: [], meta: { ...openAuctionsFixture.meta, sampleCount: 0 } };
    const screen = render(
      <TodayScreen
        data={{
          ...ready,
          search: { ...EMPTY_TODAY_SEARCH, items: ['육류'], closesWithinHours: 72, baseAmountMin: '3000000.00', baseAmountMax: '10000000.00' },
          presentation: presentOpenAuctionList(empty, fixtureNow)
        }}
      />
    );
    expect(screen.getByText('품목 육류 · 기간 72시간 안 · 기초금액 3,000,000~10,000,000 조건에서 열린 공고가 없습니다.')).toBeTruthy();
    expect(screen.getByRole('link', { name: '조건 모두 해제' }).getAttribute('href')).toBe('/today');
    expect(screen.container.querySelector('table')).toBeNull();
  });

  test('달력에서 0건인 날을 골라도 무엇 때문에 0인지 말하고 마감이 가장 이른 날을 가리킨다', () => {
    const empty = { ...openAuctionsFixture, auctions: [], meta: { ...openAuctionsFixture.meta, sampleCount: 0 } };
    const screen = render(
      <TodayScreen
        data={{
          ...ready,
          search: { ...EMPTY_TODAY_SEARCH, closesOn: '2026-09-09' },
          presentation: presentOpenAuctionList(empty, fixtureNow)
        }}
      />
    );
    // 고른 날을 문장이 되풀이하지 않으면 화면이 `지금 열린 공고가 없습니다`라고만 말해 되돌릴 자리를 감춘다.
    expect(screen.getByText('마감 2026-09-09 조건에서 열린 공고가 없습니다.')).toBeTruthy();
    // 다음에 갈 곳은 요약이 세어 둔 값이다. 조건을 자동으로 넓히지 않고 링크로만 내놓는다.
    const next = screen.getByRole('link', { name: '마감이 가장 이른 날 오늘 · 1건' });
    expect(next.getAttribute('href')).toBe('/today?closesOn=2026-09-07');
  });

  test('조건 없이 결과가 0이면 조회 불가와 다른 문구로 말한다', () => {
    const empty = { ...openAuctionsFixture, auctions: [], meta: { ...openAuctionsFixture.meta, sampleCount: 0 } };
    const screen = render(<TodayScreen data={{ ...ready, presentation: presentOpenAuctionList(empty, fixtureNow) }} />);
    expect(screen.getByText('지금 열린 공고가 없습니다.')).toBeTruthy();
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull();
  });

  test('더보기를 두지 않고 못 보는 행이 생기면 그 수를 적는다', () => {
    // 상한만큼 받아도 넘치면 못 보는 행이 생긴다. 좁히는 길 셋(달력 칸·지역 칩·검색)은 이미 화면에 있고
    // 화면이 할 일은 몇 건을 못 보고 있는지 말하는 것뿐이다(사용자 결정).
    const truncated = { ...openAuctionsFixture, meta: { ...openAuctionsFixture.meta, sampleCount: 1932 } };
    const screen = render(<TodayScreen data={{ ...ready, presentation: presentOpenAuctionList(truncated, fixtureNow) }} />);
    expect(screen.getByText('1932건 중 4건')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '다음 공고 보기' })).toBeNull();
  });

  test('cursor가 되돌려졌으면 그 사실을 한 줄로 말한다', () => {
    const paged = { ...openAuctionsFixture, nextCursor: '5796472' };
    const screen = render(<TodayScreen data={{ ...ready, presentation: presentOpenAuctionList(paged, fixtureNow), cursorReset: true }} />);
    expect(screen.getByText('목록이 갱신되어 처음부터 다시 보입니다.')).toBeTruthy();
  });

  test('지역 조건은 축 줄 칩이 아니라 왼쪽 기둥의 지역 구역이 말하고 시군구 줄이 링크다', () => {
    const screen = render(<TodayScreen data={{ ...ready, search: { ...EMPTY_TODAY_SEARCH, sido: '41' } }} />);
    // 축 줄이 없어졌으므로 `지역 창원시 ×` 같은 해제 칩은 없다. 고른 시도는 기둥의 접힌 목록 머리가 말한다.
    expect(screen.queryByRole('link', { name: /지역 조건 해제/ })).toBeNull();
    expect(screen.getByRole('group', { name: '지역' }).textContent).toContain('경상남도');
    expect(screen.getByRole('link', { name: '창원시 2' }).getAttribute('href')).toBe('/today?sido=41&sigungu=43');
  });

  test('skeleton은 같은 프레임과 section 순서를 가진다', () => {
    const screen = render(<TodayScreenSkeleton />);
    expect(screen.getByRole('status', { name: '열린 공고를 불러오는 중' })).toBeTruthy();
    const labels = [...screen.container.querySelectorAll('section')].map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['조건', '열린 공고']);
  });

  test('지역 미설정이면 목록 대신 설정을 요청하고 전국 목록을 미리 보여 주지 않는다', () => {
    const markup = renderToStaticMarkup(
      <TodayScreen data={{ ...ready, regionGate: { kind: 'unset' }, presentation: null }} />
    );
    expect(markup).toContain('먼저 지역을 고르세요');
    expect(markup).toContain('/setup?return=%2Ftoday');
    expect(markup).not.toContain('<table');
  });

  test('좁힌 결과 위에 무엇으로 좁혔는지와 전체 보기 출구가 남는다', () => {
    const markup = renderToStaticMarkup(<TodayScreen data={ready} />);
    // 이것은 필터이지 자격 판정이 아니다. 문구가 그 구분을 드러내야 한다(ADR 0048 결정 5).
    expect(markup).toContain('내가 고른 지역의 공고');
    expect(markup).not.toContain('낼 수 있는 공고');
    expect(markup).toContain('경남/김해시');
    expect(markup).toContain('전체 보기');
    expect(markup).toContain('지역 바꾸기');
  });

  test('전체 보기 상태는 전국임을 말하고 내 지역으로 돌아갈 길을 둔다', () => {
    const markup = renderToStaticMarkup(
      <TodayScreen data={{ ...ready, regionGate: { kind: 'all-regions', areas: confirmedAreas } }} />
    );
    expect(markup).toContain('전국 공고');
    expect(markup).toContain('내 지역만 보기');
  });
});

describe('마감 달력', () => {
  test('선택 링은 채움과 다른 색이고 채운 칸의 날짜는 본문 색이며 요일 줄이 칸과 같은 격자에 선다', () => {
    const search = { ...EMPTY_TODAY_SEARCH, closesOn: '2026-09-07' };
    const summary = presentOpenSummary(openSummaryFixture, fixtureNow, search);
    const screen = render(<TodayCalendar summary={summary} search={search} />);

    // 오늘 칸은 primary로 차 있으므로 primary 링은 보이지 않는다(1:1). 링은 primary-foreground여야 한다(EAT-229).
    const today = screen.getByRole('link', { current: 'date' });
    expect(today.className).toContain('bg-primary');
    expect(today.className).toContain('ring-primary-foreground');
    expect(today.className).not.toMatch(/ring-primary(\s|$)/);

    // 건수가 있어 농도가 실린 칸(09-10, 2건)의 날짜는 muted가 아니라 본문 색이고, 빈 칸(09-09)은 muted다.
    const busy = screen.getByRole('link', { name: '2026-09-10 2건' });
    expect(busy.firstElementChild?.className).toContain('text-foreground');
    const idle = screen.getByRole('link', { name: '2026-09-09 0건' });
    expect(idle.firstElementChild?.className).toContain('text-muted-foreground');

    // 요일 줄과 칸 격자는 같은 gap을 갖고 안쪽 여백은 칸 단위다. 그래야 요일이 칸 위에 선다.
    const grids = [...screen.container.querySelectorAll('div.grid.grid-cols-7')];
    expect(grids).toHaveLength(2);
    expect(grids.every((grid) => grid.className.includes('gap-0.5'))).toBe(true);
    expect([...grids[0]!.children].every((day) => day.className.includes('px-2'))).toBe(true);
  });
});
