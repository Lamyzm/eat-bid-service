import { describe, expect, test } from 'bun:test';
import { act, fireEvent, render, within } from '@testing-library/react';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';

import { attemptsFixture } from '../__fixtures__/attempts';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionSearch, DecisionView } from '../_lib/decision-search-params';
import { presentHistory } from '../_features/history/model/attempt-history';
import type { DecisionPageData } from '../_lib/load-auction-page';
import { presentDistribution } from '../_features/distribution/model/present-distribution';
import { BidRateProvider } from '../_lib/bid-rate-context';
import { AttemptSelectionProvider } from '../_lib/attempt-selection';
import { EvidenceTabs } from './evidence-tabs';
import { EvidenceViews } from './evidence-view';

const presentation = presentHistory(attemptsFixture, '7');
const history = { state: 'ready', presentation, expanded: { presentation, loadFailed: false } } as const;
const distribution: DecisionPageData['distribution'] = {
  state: 'ready',
  presentation: presentDistribution(floor90DistributionFixture, { myRate: null, isRegionScope: false }),
  response: floor90DistributionFixture
};
const searchOn = (view: DecisionView): DecisionSearch => ({ period: '12개월', scope: '전국', view, item: null, myRate: null, rate: null, expand: null, pages: 1 });

// 흐름↔분포는 주소의 `view`만 shallow로 고치는 브라우저 전환이라 제품 route의 nuqs adapter와
// 화면이 소유하는 근거 보기 provider가 함께 있어야 한다. 검사도 같은 조립으로 두고 URL 갱신을 그대로 관측한다.
function renderEvidence({
  search,
  cohort = distribution,
  onUrlUpdate
}: {
  readonly search: DecisionSearch;
  readonly cohort?: DecisionPageData['distribution'];
  readonly onUrlUpdate?: (event: UrlUpdateEvent) => void;
}) {
  return render(
    <NuqsTestingAdapter hasMemory onUrlUpdate={onUrlUpdate}>
      <BidRateProvider initialRate='90.000'>
        <EvidenceViews initialView={search.view} expanded={search.expand !== null}>
          <AttemptSelectionProvider attempts={[]}>
            <EvidenceTabs auctionId='4821' search={search} history={history} distribution={cohort} />
          </AttemptSelectionProvider>
        </EvidenceViews>
      </BidRateProvider>
    </NuqsTestingAdapter>
  );
}

function renderTabs(view: DecisionView, onUrlUpdate?: (event: UrlUpdateEvent) => void) {
  return renderEvidence({ search: searchOn(view), onUrlUpdate });
}

describe('근거 탭', () => {
  test('시안의 흐름·분포 두 탭만 보이고 현재 탭을 표시한다', () => {
    const screen = renderTabs('흐름');
    const links = within(screen.getByRole('navigation', { name: '근거 보기' })).getAllByRole('link');
    expect(links.map((node) => node.textContent)).toEqual(['흐름', '분포']);
    expect(links.filter((node) => node.getAttribute('aria-current') === 'page').map((node) => node.textContent)).toEqual(['흐름']);
  });

  test('탭을 눌러도 서버를 다시 부르지 않고 주소의 view만 바뀐다', async () => {
    // 두 본문은 이미 서버가 함께 렌더해 두었다. 그래서 전환에 필요한 것은 무엇을 보일지뿐이고, nuqs는
    // shallow로 history만 고친다(shallow=true가 곧 "RSC를 다시 받지 않는다"이다).
    const updates: UrlUpdateEvent[] = [];
    const screen = renderTabs('흐름', (event) => updates.push(event));
    const distributionTab = screen.getByRole('link', { name: '분포' });
    // 주소 공유·새 탭 열기가 지금처럼 되도록 탭은 진짜 href를 유지한다.
    expect(distributionTab.getAttribute('href')).toContain('view=%EB%B9%84%EA%B5%90%EC%A7%91%EB%8B%A8');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      fireEvent(distributionTab, click);
      // nuqs는 같은 tick의 갱신을 모아 한 번에 주소에 쓴다. 큐가 비워질 때까지 기다린 뒤 관측한다.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(click.defaultPrevented).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.options.shallow).toBe(true);
    expect(updates[0]!.searchParams.get('view')).toBe('비교집단');
    // 뒤로 가기가 이전 탭으로 돌아가야 하므로 replace가 아니라 push다.
    expect(updates[0]!.options.history).toBe('push');
    expect(screen.getByRole('link', { name: '분포' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('전국 · 값마다 낙찰된 횟수')).toBeTruthy();
    expect(screen.queryByRole('figure', { name: '회차별 낙찰률 흐름' })).toBeNull();
    // 서버는 아직 흐름을 본다고 알고 있다. 그 주소를 그대로 실으면 크게 보기가 방금 고른 분포를 되돌린다.
    const expandHref = screen.getByRole('link', { name: '크게 보기' }).getAttribute('href') ?? '';
    expect(new URLSearchParams(expandHref.slice(expandHref.indexOf('?'))).get('view')).toBe('비교집단');
  });

  test('확대가 열린 상태의 탭 이동은 확대를 닫으며 서버에서 다시 읽는다', async () => {
    // 비교집단 확대는 같은 분포를 달별로 다시 부르는 조회다. 표시만 바꾸는 전환이 아니므로 왕복을 유지한다.
    const updates: UrlUpdateEvent[] = [];
    const screen = renderEvidence({
      search: { ...searchOn('흐름'), expand: '흐름' },
      onUrlUpdate: (event) => updates.push(event)
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: '분포' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(updates[0]!.options.shallow).toBe(false);
    expect(updates[0]!.searchParams.get('view')).toBe('비교집단');
    expect(updates[0]!.searchParams.get('expand')).toBeNull();
  });

  test('흐름 탭은 차트와 범례를 보이고 점 선택 안내를 반복하지 않는다', () => {
    const screen = renderTabs('흐름');
    expect(screen.getByRole('figure', { name: '회차별 낙찰률 흐름' })).toBeTruthy();
    expect(screen.getByText('점을 누르면 해당 회차의 참여 기록을 오른쪽에서 볼 수 있어요.')).toBeTruthy();
    // 범례는 계열 토글 버튼이며 그날 하한은 사정률 축 계열이 아니라 범례에도 없다(PDR-0004).
    const toggles = screen.getAllByRole('button', { pressed: true });
    expect(toggles.map((node) => node.textContent)).toEqual(['━낙찰', '━내 값', '◆내 투찰', '○다른 품목', '▮명단']);
    // 2등은 시안대로 꺼진 채 시작하지만 범례에는 있어 켤 수 있다.
    expect(screen.getByRole('button', { name: '2등', pressed: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '그날 하한' })).toBeNull();
  });

  test('비교집단 안내문은 지금 모집단을 문장에 넣어 말한다', () => {
    const screen = renderEvidence({
      search: { period: '12개월', scope: '시군', view: '비교집단', item: null, myRate: null, rate: null, expand: null, pages: 1 }
    });
    expect(screen.getByText('시군에서 값마다 낙찰된 횟수입니다. 모집단은 위 필터에서 바꿉니다.')).toBeTruthy();
  });

  test('범례는 흐름 탭에서만 보인다', () => {
    expect(renderTabs('비교집단').queryByRole('button', { name: '낙찰' })).toBeNull();
  });

  test('비교집단 탭은 호가창 사다리·요약·각주·내 값 입력을 함께 그린다', () => {
    const screen = renderTabs('비교집단');
    expect(screen.getByText('전국 · 값마다 낙찰된 횟수')).toBeTruthy();
    // 요약 줄과 사다리의 구간 표식이 같은 문구를 쓴다. 둘 다 있어야 색 없이도 구간이 읽힌다.
    expect(screen.getAllByText('많이 나온 값')).toHaveLength(2);
    expect(screen.getByText(/90\.000 ~ 90\.010/)).toBeTruthy();
    expect(screen.getByLabelText('내 값(사정률)')).toBeTruthy();
    expect(screen.getByText(/하한율 90\.000/)).toBeTruthy();
    // 수집 전 카드가 이 탭에서 사라졌다는 것이 이 슬라이스의 결과다.
    expect(screen.queryByText('낙찰률 분포 계약(EAT-38)이 붙으면 호가창이 보입니다.')).toBeNull();
  });

  test('크게 보기 링크는 조건을 그대로 들고 expand에 지금 탭 이름을 싣는다', () => {
    const screen = renderTabs('비교집단');
    const href = screen.getByRole('link', { name: '크게 보기' }).getAttribute('href') ?? '';
    expect(href).toContain(new URLSearchParams({ expand: '비교집단' }).toString());
    expect(href).toContain('view=%EB%B9%84%EA%B5%90%EC%A7%91%EB%8B%A8');
  });

  test('크게 보기 링크는 두 분석 탭에 있다', () => {
    for (const view of ['흐름', '비교집단'] as const) {
      const screen = renderTabs(view);
      const href = screen.getByRole('link', { name: '크게 보기' }).getAttribute('href') ?? '';
      expect(href).toContain(new URLSearchParams({ expand: view }).toString());
      screen.unmount();
    }
  });

  test('모달이 열린 주소에서도 탭 본문은 사다리 그대로이고 히트맵은 인라인으로 그리지 않는다', () => {
    const screen = renderEvidence({ search: { ...searchOn('비교집단'), expand: '비교집단' } });
    expect(screen.queryByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.')).toBeNull();
    expect(screen.getByText('전국 · 값마다 낙찰된 횟수')).toBeTruthy();
  });

  test('분포 조회가 실패하면 빈 카드 대신 실패 사실을 말한다', () => {
    const screen = renderEvidence({ search: searchOn('비교집단'), cohort: { state: 'unavailable' } });
    expect(screen.getByText('분포를 지금 불러오지 못했습니다')).toBeTruthy();
  });

  test('회색 처리된 분포는 사다리 대신 사유 한 줄을 말한다', () => {
    const scarce = {
      ...floor90DistributionFixture,
      meta: { ...floor90DistributionFixture.meta, sampleCount: 7 }
    };
    const screen = renderEvidence({
      search: searchOn('비교집단'),
      cohort: {
        state: 'ready',
        presentation: presentDistribution(scarce, { myRate: null, isRegionScope: false }),
        response: scarce
      }
    });
    expect(screen.getByText('표본 7회차')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    // 각주는 회색 상태에서도 남아 왜 비었는지 말한다(AGENTS 7).
    expect(screen.getByText(/표본 7회차 · 표본 부족/)).toBeTruthy();
  });
});
