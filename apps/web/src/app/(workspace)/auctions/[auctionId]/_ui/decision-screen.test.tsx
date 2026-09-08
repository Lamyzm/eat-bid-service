import { describe, expect, test } from 'bun:test';
import { render as renderUI } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceDockFixture } from '../__fixtures__/workspace-dock';
import { renderToStaticMarkup } from 'react-dom/server';

import { attemptsFixture } from '../__fixtures__/attempts';
import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionSearch, DecisionView } from '../_lib/decision-search-params';
import { presentHistory } from '../_model/attempt-history';
import type { DecisionPageData } from '../_model/load-auction-page';
import { presentDecision } from '../_model/present-decision';
import { presentDistribution } from '../_model/present-distribution';
import { DecisionScreen } from './decision-screen';
import { DecisionScreenSkeleton } from './decision-screen-skeleton';

const render = (ui: ReactNode) => renderUI(ui, { wrapper: WorkspaceDockFixture });

const searchOn = (view: DecisionView): DecisionSearch => ({
  period: '12개월',
  scope: '전국',
  view,
  item: null,
  myRate: null,
  rate: null,
  expand: null,
  pages: 1
});
const search = searchOn('비교집단');
const flowSearch = searchOn('흐름');
const decision = () => presentDecision(openAuctionFixture, fixtureNow);

// 화면 셸 테스트는 첫 페이지만 본다. 모달용 expanded는 같은 페이지를 그대로 둔다.
const ready = (presentation: ReturnType<typeof presentHistory>): DecisionPageData['history'] => ({
  state: 'ready',
  presentation,
  expanded: { presentation, loadFailed: false }
});
const readyHistory = ready(presentHistory(attemptsFixture, '7'));
// 회차가 거의 없는 기관(열린 공고 하나뿐인 학교)을 fixture 앞에서 잘라 만든다. 표본 수도 함께 줄여야
// 부제가 실제로 그 기관을 말한 것이 된다.
const historyOf = (count: number): DecisionPageData['history'] =>
  ready(
    presentHistory(
      {
        ...attemptsFixture,
        attempts: attemptsFixture.attempts.slice(0, count),
        meta: { ...attemptsFixture.meta, sampleCount: count }
      },
      null
    )
  );
const unavailable: DecisionPageData['history'] = { state: 'unavailable' };

const readyDistribution: DecisionPageData['distribution'] = {
  state: 'ready',
  presentation: presentDistribution(floor90DistributionFixture, {
    myRate: null,
    isRegionScope: false
  }),
  response: floor90DistributionFixture
};
const lockedDistribution: DecisionPageData['distribution'] = {
  state: 'locked',
  reason: 'missing-terms'
};

describe('결정 화면', () => {
  test('서버 markup에 프레임·제목·배너·근거 탭이 있다', () => {
    const markup = renderToStaticMarkup(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={unavailable}
        distribution={readyDistribution}
      />
    );
    expect(markup).toContain('data-slot="decision-screen"');
    expect(markup).toContain('aria-labelledby="decision-title"');
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect(markup).not.toContain(openAuctionFixture.provenance.contentSha256);
    expect(markup).not.toContain('원문과 추적 정보');
    expect(markup).not.toContain('실제로 낸 적은 없습니다');
    for (const view of ['흐름', '분포']) expect(markup).toContain(view);
  });

  test('금지 문구가 없다', () => {
    const markup = renderToStaticMarkup(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    for (const banned of ['NeaT', '탈락선', '밀림', '추천', '안전 구간'])
      expect(markup).not.toContain(banned);
  });

  test('중앙은 상태·근거·과거 회차만 소유하고 보조 진입은 전역 위치에 둔다', () => {
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    const frame = screen.container.querySelector('[data-slot="decision-screen"]')!;
    const labels = [...frame.querySelectorAll('section, aside')].map((node) =>
      node.getAttribute('aria-label')
    );
    expect(labels).toEqual(['공고 상태', '근거', '과거 회차']);
    expect(frame.querySelector('aside')).toBeNull();
    expect(
      screen.getByRole('button', { name: '현재 공고 정보' }).closest('[data-dock-host="rail"]')
    ).not.toBeNull();
    const filters = screen.getByRole('button', { name: '기간: 12개월' });
    expect(filters.closest('header')).toBeNull();
    expect(filters.closest('[data-slot="decision-filter-bar"]')).not.toBeNull();
  });

  test('분포 탭은 흐름 차트 대신 호가창을 보인다', () => {
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    expect(screen.queryByRole('figure', { name: '회차별 낙찰률 흐름' })).toBeNull();
    expect(screen.getByText('전국 · 값마다 낙찰된 횟수')).toBeTruthy();
    expect(screen.getByText('90.000 ~ 90.010')).toBeTruthy();
  });

  test('코호트 재료가 없으면 호가창 자리에 그 사유를 말한다', () => {
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={readyHistory}
        distribution={lockedDistribution}
      />
    );
    expect(screen.getByText('이 공고의 하한율과 낙찰방식이 아직 수집되지 않았습니다')).toBeTruthy();
  });

  test('손잡이 값 없이 열면 표 머리글·이 값이면·흐름 각주 어디에도 화면이 정한 투찰률이 없다', () => {
    // 90.000 같은 시작값은 곧 추천값이다(AGENTS 8, PDR-0004, EAT-84). 사용자가 놓기 전에는 빈 상태다.
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    expect(screen.getByRole('figure', { name: '회차별 낙찰률 흐름' })).toBeTruthy();
    expect(screen.queryByText(/썼다면/)).toBeNull();
    expect(screen.queryByText('값을 넣으면 계산')).toBeNull();
    expect(screen.getByText('투찰률을 넣으면 지난 회차와 견줍니다')).toBeTruthy();
    expect(screen.queryByText('내 값 90.000')).toBeNull();
    expect((screen.getByLabelText('투찰률') as HTMLInputElement).value).toBe('');
    expect(screen.container.textContent).not.toContain('90.000 썼다면');
  });

  test('URL rate로 놓은 투찰률이 있으면 차트·과거 회차 표·이 값이면 패널을 그 값 하나로 함께 그린다', () => {
    const withRate: DecisionSearch = { ...flowSearch, rate: '90.000' };
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={withRate}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    expect(screen.getByRole('figure', { name: '회차별 낙찰률 흐름' })).toBeTruthy();
    expect(screen.getByText('90.000 썼다면')).toBeTruthy();
    // 손잡이 값은 표의 마지막 열(투찰률 축)에만 쓰고 사정률 눈금인 흐름 차트에는 선으로 긋지 않는다(PDR-0004).
    expect(screen.queryByText('내 값 90.000')).toBeNull();
    // 품목 7의 17회차 중 예정가격이 관측된 15회차만 낙찰값과 견줄 수 있다.
    expect(screen.getByText('지난 15회 중 낙찰값 이하였을 회차')).toBeTruthy();
  });

  test('탭 링크는 기간·모집단·품목 조건을 그대로 들고 간다', () => {
    const withItem: DecisionSearch = {
      period: '3개월',
      scope: '시군',
      view: '비교집단',
      item: '7',
      myRate: null,
      rate: null,
      expand: null,
      pages: 1
    };
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={withItem}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    const href = screen.getByRole('link', { name: '흐름' }).getAttribute('href') ?? '';
    const query = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(query.get('view')).toBe('흐름');
    expect(query.get('period')).toBe('3개월');
    expect(query.get('scope')).toBe('시군');
    expect(query.get('item')).toBe('7');
  });

  test('과거 회차 캡션은 표가 실제로 그린 행 수를 적는다', () => {
    const full = render(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    expect(full.getByText(`${attemptsFixture.meta.sampleCount}회 · 최근 12회 표시`)).toBeTruthy();

    const fiveRows = ready(
      presentHistory({ ...attemptsFixture, attempts: attemptsFixture.attempts.slice(0, 5) }, '7')
    );
    const short = render(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={fiveRows}
        distribution={readyDistribution}
      />
    );
    expect(short.getByText(`${attemptsFixture.meta.sampleCount}회 · 최근 5회 표시`)).toBeTruthy();
  });

  test('회차가 0건이거나 1건이어도 캡션에 NaN이 나오지 않는다', () => {
    const none = renderToStaticMarkup(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={historyOf(0)}
        distribution={readyDistribution}
      />
    );
    expect(none).not.toContain('NaN');
    expect(none).toContain('0회 · 최근 표시 없음');

    const single = render(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={historyOf(1)}
        distribution={readyDistribution}
      />
    );
    expect(single.getByText('1회 · 최근 1회 표시')).toBeTruthy();
  });

  test('구매기관이 정규화되지 않은 공고는 흐름 탭에서 이유를 그대로 말한다', () => {
    const markup = renderToStaticMarkup(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={{ state: 'no-organization' }}
        distribution={lockedDistribution}
      />
    );
    expect(markup).toContain('이 공고의 구매기관이 아직 정규화되지 않았습니다');
  });

  test('호가창의 상태 넷이 각각 다른 것을 그린다', () => {
    // loading은 route의 skeleton이 소유하므로 여기서는 나머지 셋을 화면 조립 수준에서 고정한다.
    const scarce = {
      ...floor90DistributionFixture,
      meta: { ...floor90DistributionFixture.meta, sampleCount: 7 }
    };
    const unknown: DecisionPageData['distribution'] = {
      state: 'ready',
      presentation: presentDistribution(scarce, { myRate: null, isRegionScope: false }),
      response: scarce
    };
    const failed: DecisionPageData['distribution'] = { state: 'unavailable' };

    const success = render(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    expect(success.getByText('전국 · 값마다 낙찰된 횟수')).toBeTruthy();

    const grey = render(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={readyHistory}
        distribution={unknown}
      />
    );
    expect(grey.getByText('표본 7회차')).toBeTruthy();

    const error = render(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={readyHistory}
        distribution={failed}
      />
    );
    expect(error.getByText('분포를 지금 불러오지 못했습니다')).toBeTruthy();
  });

  test('route 로딩 skeleton은 근거 카드 자리를 실제 높이로 잡아 도착 순간 화면을 밀지 않는다', () => {
    const markup = renderToStaticMarkup(<DecisionScreenSkeleton />);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('data-slot="decision-screen"');
  });

  test('회차 이력 조회가 실패하면 빈 화면 대신 실패 사실을 말한다', () => {
    const markup = renderToStaticMarkup(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={unavailable}
        distribution={readyDistribution}
      />
    );
    expect(markup).toContain('회차 이력을 지금 불러오지 못했습니다');
  });
});
