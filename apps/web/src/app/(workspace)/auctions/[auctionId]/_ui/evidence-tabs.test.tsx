import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import type { DecisionSearch, DecisionView } from '../_lib/decision-search-params';
import { presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { EvidenceTabs } from './evidence-tabs';

const history = { state: 'ready', presentation: presentHistory(attemptsFixture, '7') } as const;
const searchOn = (view: DecisionView): DecisionSearch => ({ period: '12개월', scope: '전국', view, item: null });

function renderTabs(view: DecisionView) {
  return render(
    <BidRateProvider initialRate='90.000'>
      <EvidenceTabs auctionId='4821' search={searchOn(view)} history={history} />
    </BidRateProvider>
  );
}

describe('근거 탭', () => {
  test('탭 넷을 순서대로 그리고 현재 탭만 aria-current로 표시한다', () => {
    const screen = renderTabs('흐름');
    const links = screen.getAllByRole('link');
    expect(links.map((node) => node.textContent)).toEqual(['비교집단', '흐름', '그날 하한', '업체']);
    expect(links.filter((node) => node.getAttribute('aria-current') === 'page').map((node) => node.textContent)).toEqual(['흐름']);
  });

  test('흐름 탭은 차트와 안내문·범례를 함께 보인다', () => {
    const screen = renderTabs('흐름');
    expect(screen.getByRole('img', { name: '회차별 낙찰률 흐름' })).toBeTruthy();
    expect(screen.getByText('회차마다 낙찰된 사정률입니다. 굵은 선이 내 값입니다.')).toBeTruthy();
    expect(screen.getByText('━ 그날 하한')).toBeTruthy();
    expect(screen.getByText('○ 다른 품목')).toBeTruthy();
  });

  test('본문이 아직 없는 탭은 무엇이 올 자리인지와 수집 전임을 함께 말한다', () => {
    const screen = renderTabs('업체');
    expect(screen.getByText('수집 전')).toBeTruthy();
    expect(screen.getByText('회차별 명단 계약이 붙으면 참여 업체가 보입니다.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: '회차별 낙찰률 흐름' })).toBeNull();
  });

  test('범례는 흐름 탭에서만 보인다', () => {
    expect(renderTabs('비교집단').queryByText('━ 낙찰')).toBeNull();
  });
});
