import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import { attemptsFixture } from '../../__fixtures__/attempts';
import { fixtureNow, openAuctionFixture } from '../../__fixtures__/auction';
import { floor90DistributionFixture } from '../../__fixtures__/distribution';
import type { DecisionExpand, DecisionSearch } from '../../_lib/decision-search-params';
import { presentHistory } from '../../_model/attempt-history';
import type { DecisionPageData } from '../../_model/load-auction-page';
import { presentDecision } from '../../_model/present-decision';
import { presentDistribution } from '../../_model/present-distribution';
import { FORBIDDEN_VERDICT_WORDS } from '../../_model/verdict-vocabulary';
import { BidRateProvider } from '../bid-rate-context';
import { DecisionExpand as DecisionExpandDialog } from './decision-expand';

const decision = presentDecision(openAuctionFixture, fixtureNow);
const presentation = presentHistory(attemptsFixture, '7');
const history: DecisionPageData['history'] = { state: 'ready', presentation, expanded: { presentation, loadFailed: false } };
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
  overrides: Partial<{ history: DecisionPageData['history']; distribution: DecisionPageData['distribution']; search: DecisionSearch; replaced: string[] }> = {}
) {
  return render(
    <AppRouterContext.Provider value={routerStub(overrides.replaced ?? [])}>
      <BidRateProvider initialRate='90.000'>
        <DecisionExpandDialog
          decision={decision}
          search={overrides.search ?? searchWith(expand)}
          history={overrides.history ?? history}
          distribution={overrides.distribution ?? distribution}
        />
      </BidRateProvider>
    </AppRouterContext.Provider>
  );
}

describe('크게 보기 모달', () => {
  test('expand가 없으면 아무것도 그리지 않는다', () => {
    const screen = renderExpand(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('과거 회차 모달은 role=dialog에 제목·표본·10열 표와 더 불러오기를 함께 그린다', () => {
    const screen = renderExpand('과거 회차');
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: '과거 회차' })).toBeTruthy();
    const headers = [...dialog.querySelectorAll('thead th')].map((node) => node.textContent);
    // 확대 표도 기본 표와 같이 그날 하한·낙찰 업체 열을 빼고 나머지 값과 순서를 유지한다(EAT-115).
    expect(headers).toEqual([
      '개찰', '품목', '기초금액', '하한율', '낙찰률(사정률)', '2등가(사정률)',
      '명단', '하한 아래', '낙찰 − 내 값 90.030', '90.000 썼다면'
    ]);
    // 12행 상한이 풀려 fixture 20회가 전부 그려진다.
    expect(dialog.querySelectorAll('tbody tr').length).toBe(attemptsFixture.attempts.length);
    expect(screen.getByText(`표본 ${attemptsFixture.meta.sampleCount}회 중 ${attemptsFixture.attempts.length}회 표시`)).toBeTruthy();
    // fixture는 nextCursor가 null이라 더 부를 것이 없다.
    expect(screen.getByText('이력 끝')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '더 불러오기' })).toBeNull();
    for (const banned of FORBIDDEN_VERDICT_WORDS) expect(dialog.textContent).not.toContain(banned);
  });

  test('이어 붙인 페이지가 있고 cursor가 남아 있으면 모달은 그 행 전부와 pages를 하나 올린 더 불러오기 링크를 그린다', () => {
    const merged = presentHistory(
      { ...attemptsFixture, attempts: [...attemptsFixture.attempts, ...attemptsFixture.attempts.map((attempt) => ({ ...attempt, attemptId: `1${attempt.attemptId}` }))], nextCursor: '5' },
      '7'
    );
    const screen = renderExpand('과거 회차', {
      search: { ...searchWith('과거 회차'), pages: 2 },
      history: { state: 'ready', presentation, expanded: { presentation: merged, loadFailed: false } }
    });
    expect(screen.getByRole('dialog').querySelectorAll('tbody tr').length).toBe(attemptsFixture.attempts.length * 2);
    const href = screen.getByRole('link', { name: '더 불러오기' }).getAttribute('href') ?? '';
    expect(href).toContain('pages=3');
    expect(href).toContain(new URLSearchParams({ expand: '과거 회차' }).toString());
  });

  test('이어 부르다 실패했으면 이력 끝이 아니라 실패 사실을 말하고 링크를 감춘다', () => {
    const screen = renderExpand('과거 회차', {
      history: { state: 'ready', presentation, expanded: { presentation: { ...presentation, nextCursor: '5' }, loadFailed: true } }
    });
    expect(screen.getByRole('alert').textContent).toContain('회차를 더 불러오지 못했습니다');
    expect(screen.queryByText('이력 끝')).toBeNull();
    expect(screen.queryByRole('link', { name: '더 불러오기' })).toBeNull();
  });

  test('낙찰 − 내 값 열은 사정률 내 값만 빼고, 내 값이 없으면 어떤 값도 빼지 않는다', () => {
    const screen = renderExpand('과거 회차', { search: { ...searchWith('과거 회차'), myRate: null } });
    expect(screen.getByText('낙찰 − 내 값')).toBeTruthy();
    const deltaCells = [...screen.getByRole('dialog').querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[8]?.textContent);
    expect(new Set(deltaCells)).toEqual(new Set(['—']));
  });

  test('비교집단 모달은 12개월 히트맵과 모집단 부제를 그린다', () => {
    const screen = renderExpand('비교집단');
    expect(screen.getByRole('heading', { name: '낙찰값 분포 · 달마다 어디에 몰렸나' })).toBeTruthy();
    expect(screen.getByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.')).toBeTruthy();
    expect(screen.getByText(/전국 · 품목 전체 · 하한율 90\.000 · 12개월 · 표본/)).toBeTruthy();
  });

  test('흐름 크게 보기는 페이지가 소유하므로 별도 모달을 만들지 않는다', () => {
    const screen = renderExpand('흐름');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('회차 이력이 없으면 과거 회차·흐름 모달도 같은 사유를 말한다', () => {
    const screen = renderExpand('과거 회차', { history: { state: 'no-organization' } });
    expect(screen.getByText('이 공고의 구매기관이 아직 정규화되지 않았습니다')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('닫기를 누르면 expand만 지운 주소로 replace한다', () => {
    const replaced: string[] = [];
    const screen = renderExpand('비교집단', { replaced });
    screen.getByRole('button', { name: '닫기 ×' }).click();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).not.toContain('expand');
    expect(replaced[0]).toContain('myRate=90.030');
  });

  test('분포가 잠겨 있으면 비교집단 모달은 히트맵 대신 잠긴 사유를 말한다', () => {
    const screen = renderExpand('비교집단', { distribution: { state: 'locked', reason: 'missing-axis' } });
    expect(screen.getByText('이 모집단을 만들 지역·기관이 아직 정규화되지 않았습니다')).toBeTruthy();
  });
});
