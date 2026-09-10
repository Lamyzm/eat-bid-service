import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionExpand, DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_lib/load-auction-page';
import { presentDecision } from '../_lib/present-decision';
import { presentDistribution } from '../_features/distribution/model/present-distribution';
import { BidRateProvider } from '../_lib/bid-rate-context';
import { DecisionExpand as DecisionExpandDialog } from './decision-expand';

const decision = presentDecision(openAuctionFixture, fixtureNow);
const distribution: DecisionPageData['distribution'] = {
  state: 'ready',
  presentation: presentDistribution(floor90DistributionFixture, { myRate: '90.030', isRegionScope: false }),
  response: floor90DistributionFixture
};
const searchWith = (expand: DecisionExpand | null): DecisionSearch => ({
  period: '12개월',
  scope: '전국',
  view: '비교집단',
  item: null,
  myRate: '90.030',
  rate: null,
  expand,
  pages: 1
});

const noop = () => {};

// 셸이 닫을 때 부르는 app router. 닫힘 주소가 어디로 가는지 기록만 한다.
function routerStub(replaced: string[]): AppRouterInstance {
  return {
    back: noop,
    forward: noop,
    refresh: noop,
    push: noop,
    replace: (href) => {
      replaced.push(href);
    },
    prefetch: noop,
    bfcacheId: 'test'
  };
}

function renderExpand(
  expand: DecisionExpand | null,
  overrides: Partial<{ distribution: DecisionPageData['distribution']; search: DecisionSearch; replaced: string[] }> = {}
) {
  return render(
    <AppRouterContext.Provider value={routerStub(overrides.replaced ?? [])}>
      <BidRateProvider initialRate='90.000'>
        <DecisionExpandDialog
          decision={decision}
          search={overrides.search ?? searchWith(expand)}
          distribution={overrides.distribution ?? distribution}
        />
      </BidRateProvider>
    </AppRouterContext.Provider>
  );
}

describe('비교집단 크게 보기 모달', () => {
  test('expand가 없으면 아무것도 그리지 않는다', () => {
    const screen = renderExpand(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('12개월 히트맵과 모집단 부제를 그린다', () => {
    const screen = renderExpand('비교집단');
    expect(screen.getByRole('heading', { name: '낙찰값 분포 · 달마다 어디에 몰렸나' })).toBeTruthy();
    expect(screen.getByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.')).toBeTruthy();
    expect(screen.getByText(/전국 · 품목 전체 · 하한율 90\.000 · 12개월 · 표본/)).toBeTruthy();
  });

  test('닫기를 누르면 expand만 지운 주소로 replace한다', () => {
    const replaced: string[] = [];
    const screen = renderExpand('비교집단', { replaced });
    screen.getByRole('button', { name: '닫기 ×' }).click();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).not.toContain('expand');
    expect(replaced[0]).toContain('myRate=90.030');
  });

  test('분포가 잠겨 있으면 히트맵 대신 잠긴 사유를 말한다', () => {
    const screen = renderExpand('비교집단', { distribution: { state: 'locked', reason: 'missing-axis' } });
    expect(screen.getByText('이 모집단을 만들 지역·기관이 아직 정규화되지 않았습니다')).toBeTruthy();
  });

  test('흐름과 과거 회차 크게 보기는 같은 본문의 집중 모드라 모달을 만들지 않는다', () => {
    // 모달로 복제하면 확대 표가 오른쪽 참여 기록을 덮고 선택·범위가 갈라진다(EAT-115).
    for (const expand of ['흐름', '과거 회차'] as const) {
      expect(renderExpand(expand).queryByRole('dialog')).toBeNull();
    }
  });
});
