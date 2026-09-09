import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { fixtureNow, noSnapshotFixture, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import type { TodayPageData } from '../_model/load-today-page';
import { presentOpenAuctionList } from '../_model/present-open-auctions';
import { TodayScreen } from './today-screen';
import { TodayScreenSkeleton } from './today-screen-skeleton';

const ready: TodayPageData = {
  nowIso: fixtureNow,
  search: EMPTY_TODAY_SEARCH,
  presentation: presentOpenAuctionList(openAuctionsFixture, fixtureNow),
  cursorReset: false
};

describe('오늘 화면', () => {
  test('서버 markup에 프레임·제목·기준 시각·조건·표가 있다', () => {
    const markup = renderToStaticMarkup(<TodayScreen data={ready} />);
    expect(markup).toContain('data-slot="today-screen"');
    expect(markup).toContain('aria-labelledby="today-title"');
    expect(markup).toContain('열린 공고 4건');
    expect(markup).toContain('09-07 10:30 기준');
    expect(markup).toContain('마감 임박 순');
    expect(markup).toContain('열린 공고 스냅샷 build 601');
    for (const banned of ['무효', '추천', '안전 구간', '예측']) expect(markup).not.toContain(banned);
  });

  test('section 순서가 조건·열린 공고이고 rail이 없다', () => {
    const screen = render(<TodayScreen data={ready} />);
    const labels = [...screen.container.querySelectorAll('section, aside')].map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['조건', '열린 공고']);
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
          search: { ...EMPTY_TODAY_SEARCH, item: '축산', closesWithinHours: 72, baseAmountMin: '3000000.00', baseAmountMax: '10000000.00' },
          presentation: presentOpenAuctionList(empty, fixtureNow)
        }}
      />
    );
    expect(screen.getByText('품목 축산 · 기간 3일 · 기초금액 300만~1,000만 조건에서 열린 공고가 없습니다.')).toBeTruthy();
    expect(screen.getByRole('link', { name: '조건 모두 해제' }).getAttribute('href')).toBe('/today');
    expect(screen.container.querySelector('table')).toBeNull();
  });

  test('조건 없이 결과가 0이면 조회 불가와 다른 문구로 말한다', () => {
    const empty = { ...openAuctionsFixture, auctions: [], meta: { ...openAuctionsFixture.meta, sampleCount: 0 } };
    const screen = render(<TodayScreen data={{ ...ready, presentation: presentOpenAuctionList(empty, fixtureNow) }} />);
    expect(screen.getByText('지금 열린 공고가 없습니다.')).toBeTruthy();
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull();
  });

  test('cursor가 되돌려졌으면 그 사실을 한 줄로 말하고 다음 페이지 링크는 cursor를 싣는다', () => {
    const paged = { ...openAuctionsFixture, nextCursor: '5796472' };
    const screen = render(<TodayScreen data={{ ...ready, presentation: presentOpenAuctionList(paged, fixtureNow), cursorReset: true }} />);
    expect(screen.getByText('목록이 갱신되어 처음부터 다시 보입니다.')).toBeTruthy();
    expect(screen.getByRole('link', { name: '다음 공고 보기' }).getAttribute('href')).toBe('/today?cursor=5796472');
  });

  test('지역 조건 칩은 행에서 읽은 라벨로 이름을 보이고 해제 링크를 가진다', () => {
    const screen = render(<TodayScreen data={{ ...ready, search: { ...EMPTY_TODAY_SEARCH, region: '43' } }} />);
    const chip = screen.getByRole('link', { name: /지역 창원시/ });
    expect(chip.getAttribute('href')).toBe('/today');
  });

  test('skeleton은 같은 프레임과 section 순서를 가진다', () => {
    const screen = render(<TodayScreenSkeleton />);
    expect(screen.getByRole('status', { name: '열린 공고를 불러오는 중' })).toBeTruthy();
    const labels = [...screen.container.querySelectorAll('section')].map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['조건', '열린 공고']);
  });
});
