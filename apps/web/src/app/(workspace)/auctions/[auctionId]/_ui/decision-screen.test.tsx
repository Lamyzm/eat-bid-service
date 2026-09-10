import { describe, expect, test } from 'bun:test';
import { fireEvent, render as renderUI, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceDockFixture } from '../__fixtures__/workspace-dock';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
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
// 근거 탭이 주소의 `view`를 읽으므로 서버 markup 검사에도 route와 같은 자리에 nuqs adapter를 둔다.
const markupOf = (ui: ReactNode) => renderToStaticMarkup(<NuqsTestingAdapter>{ui}</NuqsTestingAdapter>);

/**
 * 사용자가 실제로 보는 부분만 남긴 markup. 서버는 흐름·분포 두 본문을 함께 렌더해 두고 꺼진 쪽은
 * `hidden`으로 접근성 트리에서도 빼므로, 화면 문구 검사는 켜진 본문만 센다(EAT-139).
 */
function shownMarkup(markup: string): string {
  const host = document.createElement('div');
  host.innerHTML = markup;
  for (const hidden of host.querySelectorAll('[hidden]')) hidden.remove();
  return host.innerHTML;
}

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

// 화면 셸 테스트는 첫 페이지만 본다. 이어 붙인 expanded는 같은 페이지를 그대로 둔다.
const ready = (presentation: ReturnType<typeof presentHistory>): DecisionPageData['history'] => ({
  state: 'ready',
  presentation,
  expanded: { presentation, loadFailed: false }
});
// 두 번째 페이지까지 이어 붙인 조회. 첫 페이지는 그대로 두고 확대·선택만 누적 행을 본다.
const mergedHistory = (): DecisionPageData['history'] => {
  const presentation = presentHistory(attemptsFixture, '7');
  const merged = presentHistory(
    {
      ...attemptsFixture,
      attempts: [
        ...attemptsFixture.attempts,
        ...attemptsFixture.attempts.map((attempt) => ({ ...attempt, attemptId: `1${attempt.attemptId}` }))
      ],
      nextCursor: '5'
    },
    '7'
  );
  return { state: 'ready', presentation, expanded: { presentation: merged, loadFailed: false } };
};
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
  test('서버 markup에 프레임·제목·상태 배지·근거 탭이 있다', () => {
    const markup = markupOf(
      <DecisionScreen
        decision={decision()}
        search={search}
        history={unavailable}
        distribution={readyDistribution}
      />
    );
    expect(markup).toContain('data-slot="decision-screen"');
    expect(markup).toContain('aria-labelledby="decision-title"');
    expect(markup).toContain('검토 중인 공고');
    expect(markup).toContain('진행 중');
    expect(markup).not.toContain(openAuctionFixture.provenance.contentSha256);
    expect(markup).not.toContain('원문과 추적 정보');
    expect(markup).not.toContain('실제로 낸 적은 없습니다');
    for (const view of ['흐름', '분포']) expect(markup).toContain(view);
  });

  test('금지 문구가 없다', () => {
    const markup = shownMarkup(
      markupOf(
        <DecisionScreen
          decision={decision()}
          search={flowSearch}
          history={readyHistory}
          distribution={readyDistribution}
        />
      )
    );
    for (const banned of ['NeaT', '탈락선', '밀림', '추천', '안전 구간'])
      expect(markup).not.toContain(banned);
  });

  test('중앙은 근거·과거 회차만 소유하고 보조 진입은 전역 위치에 둔다', () => {
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
    expect(labels).toEqual(['근거', '과거 회차']);
    expect(frame.querySelector('aside')).toBeNull();
    expect(
      screen.getByRole('button', { name: '현재 공고 정보' }).closest('[data-dock-host="rail"]')
    ).not.toBeNull();
    const filters = screen.getByRole('button', { name: '기간: 12개월' });
    expect(filters.closest('header')).toBeNull();
    expect(filters.closest('[data-slot="decision-filter-bar"]')).not.toBeNull();
  });

  test('본문의 이 공고 정보 버튼이 전역 오른쪽 패널의 현재 공고 사실을 연다', () => {
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={flowSearch}
        history={readyHistory}
        distribution={readyDistribution}
      />
    );
    const button = screen.getByRole('button', { name: '이 공고 정보' });
    expect(button.closest('[data-slot="decision-screen"]')).not.toBeNull();
    expect(screen.queryByRole('region', { name: '현재 공고 사실' })).toBeNull();

    fireEvent.click(button);

    const facts = screen.getByRole('region', { name: '현재 공고 사실' });
    expect(facts.closest('[data-slot="decision-screen"]')).toBeNull();
    // 배너가 강조하던 사실은 사라지지 않고 이 패널이 소유한다(EAT-115).
    expect(facts.textContent).toContain('4곳');
    // 참여 수는 언제 본 값인지와 무엇에 견준 증감인지를 함께 말한다.
    expect(facts.textContent).toContain('09-03 10:00 기준 · 09-02 대비 +2');
    expect(facts.textContent).toContain('보통');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  test('과거 회차 확대는 모달이 아니라 같은 본문의 집중 모드로 누적 행을 그린다', () => {
    const history = mergedHistory();
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={{ ...flowSearch, expand: '과거 회차', pages: 2 }}
        history={history}
        distribution={readyDistribution}
      />
    );
    const frame = screen.container.querySelector('[data-slot="decision-screen"]')!;
    expect(frame.getAttribute('data-focus')).toBe('history');
    expect(screen.queryByRole('dialog')).toBeNull();
    // 확대해도 현재 공고 제목은 그대로다. 선택 회차가 중앙 분석 대상을 덮지 않는다.
    expect(screen.container.querySelector('#decision-title')?.textContent).toBe(
      openAuctionFixture.identity.title
    );
    const table = screen.getByRole('region', { name: '과거 회차' });
    expect(table.querySelectorAll('tbody tr').length).toBe(
      history.state === 'ready' ? history.expanded.presentation.rows.length : 0
    );
    expect(within(table).getByRole('link', { name: '작게 보기' })).toBeTruthy();
    expect(within(table).getByRole('link', { name: '더 불러오기' }).getAttribute('href')).toContain('pages=3');
  });

  test('확대와 복귀는 같은 표 DOM을 유지하고 조회 조건이 바뀔 때만 새로 만든다', () => {
    // 표를 분기마다 다른 자리에서 감싸면 같은 컴포넌트여도 DOM이 다시 마운트돼 확대에서 보던 위치를
    // 잃는다. 반대로 조건이 바뀌면 다른 집단이라 그 위치를 물려받으면 안 된다(EAT-115).
    const history = mergedHistory();
    const focused = { ...flowSearch, expand: '과거 회차' as const, pages: 2 };
    const screen = render(
      <DecisionScreen decision={decision()} search={focused} history={history} distribution={readyDistribution} />
    );
    const scroller = () => screen.container.querySelector('[data-slot="history-table-scroll"]');
    const opened = scroller();
    expect(opened).not.toBeNull();

    screen.rerender(
      <DecisionScreen decision={decision()} search={{ ...focused, expand: null }} history={history} distribution={readyDistribution} />
    );
    expect(scroller()).toBe(opened);

    screen.rerender(
      <DecisionScreen decision={decision()} search={focused} history={history} distribution={readyDistribution} />
    );
    expect(scroller()).toBe(opened);

    screen.rerender(
      <DecisionScreen decision={decision()} search={{ ...focused, period: '3개월' }} history={history} distribution={readyDistribution} />
    );
    expect(scroller()).not.toBe(opened);
  });

  test('확대를 닫으면 12행으로 돌아가고 같은 표·열을 쓴다', () => {
    const history = mergedHistory();
    const screen = render(
      <DecisionScreen
        decision={decision()}
        search={{ ...flowSearch, pages: 2 }}
        history={history}
        distribution={readyDistribution}
      />
    );
    const frame = screen.container.querySelector('[data-slot="decision-screen"]')!;
    expect(frame.getAttribute('data-focus')).toBeNull();
    const table = screen.getByRole('region', { name: '과거 회차' });
    expect(table.querySelectorAll('tbody tr').length).toBe(12);
    expect([...table.querySelectorAll('thead th')].map((node) => node.textContent)).toEqual([
      '개찰',
      '품목',
      '낙찰률(사정률)',
      '2등가(사정률)',
      '명단'
    ]);
    expect(within(table).getByRole('link', { name: '크게 보기' })).toBeTruthy();
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
    expect((screen.getByLabelText('투찰률 눌러서 직접 입력') as HTMLInputElement).value).toBe('');
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
    // 조건 묶음은 이름을 가진 group이다. 맨 div면 role이 generic이라 aria-label이 무시된다.
    expect(screen.getByRole('group', { name: '분석 조건' })).toBeTruthy();
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
    const none = markupOf(
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
    const markup = markupOf(
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
    const markup = markupOf(
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
