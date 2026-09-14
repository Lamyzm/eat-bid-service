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
  cursorReset: false
};

describe('오늘 화면', () => {
  test('서버 markup에 프레임·제목·기준 시각·조건·표가 있다', () => {
    const markup = renderToStaticMarkup(<TodayScreen data={ready} />);
    expect(markup).toContain('data-slot="today-screen"');
    expect(markup).toContain('aria-labelledby="today-title"');
    // 건수는 축 줄이 한 번만 말한다. 머리에도 적으면 page-level 숫자 hero가 둘이 된다(screen-system §9.1).
    expect(markup).toContain('>4건<');
    expect(markup).not.toContain('열린 공고 4건');
    expect(markup).toContain('09-07 10:30 기준');
    // 마감일 묶음 머리가 순서를 보여 주므로 `마감 임박 순`이라는 제목이 따로 없다.
    expect(markup).toContain('9월 7일');
    expect(markup).toContain('열린 공고 스냅샷 build 601');
    for (const banned of ['무효', '추천', '안전 구간', '예측']) expect(markup).not.toContain(banned);
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
          search: { ...EMPTY_TODAY_SEARCH, items: ['축산'], closesWithinHours: 72, baseAmountMin: '3000000.00', baseAmountMax: '10000000.00' },
          presentation: presentOpenAuctionList(empty, fixtureNow)
        }}
      />
    );
    expect(screen.getByText('품목 축산 · 기간 72시간 안 · 기초금액 3,000,000~10,000,000 조건에서 열린 공고가 없습니다.')).toBeTruthy();
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

  test('지역 조건 칩은 행에서 읽은 라벨로 이름을 보이고 해제 링크를 가진다', () => {
    const screen = render(<TodayScreen data={{ ...ready, search: { ...EMPTY_TODAY_SEARCH, sido: '43' } }} />);
    const chip = screen.getByRole('link', { name: /지역 창원시/ });
    expect(chip.getAttribute('href')).toBe('/today');
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
