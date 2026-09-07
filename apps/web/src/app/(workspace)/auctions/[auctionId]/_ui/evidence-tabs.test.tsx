import { describe, expect, test } from 'bun:test';
import { render, within } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionSearch, DecisionView } from '../_lib/decision-search-params';
import { presentHistory } from '../_model/attempt-history';
import type { DecisionPageData } from '../_model/load-auction-page';
import { presentDistribution } from '../_model/present-distribution';
import { BidRateProvider } from './bid-rate-context';
import { EvidenceTabs } from './evidence-tabs';

const presentation = presentHistory(attemptsFixture, '7');
const history = { state: 'ready', presentation, expanded: { presentation, loadFailed: false } } as const;
const distribution: DecisionPageData['distribution'] = {
  state: 'ready',
  presentation: presentDistribution(floor90DistributionFixture, { myRate: null, isRegionScope: false }),
  response: floor90DistributionFixture
};
const searchOn = (view: DecisionView): DecisionSearch => ({ period: '12개월', scope: '전국', view, item: null, myRate: null, rate: null, expand: null, pages: 1 });

function renderTabs(view: DecisionView) {
  return render(
    <BidRateProvider initialRate='90.000'>
      <EvidenceTabs auctionId='4821' search={searchOn(view)} history={history} distribution={distribution} />
    </BidRateProvider>
  );
}

describe('근거 탭', () => {
  test('탭 넷을 순서대로 그리고 현재 탭만 aria-current로 표시한다', () => {
    const screen = renderTabs('흐름');
    const links = within(screen.getByRole('navigation', { name: '근거 보기' })).getAllByRole('link');
    expect(links.map((node) => node.textContent)).toEqual(['비교집단', '흐름', '그날 하한', '업체']);
    expect(links.filter((node) => node.getAttribute('aria-current') === 'page').map((node) => node.textContent)).toEqual(['흐름']);
  });

  test('흐름 탭은 차트와 안내문·범례를 함께 보인다', () => {
    const screen = renderTabs('흐름');
    expect(screen.getByRole('img', { name: '회차별 낙찰률 흐름' })).toBeTruthy();
    expect(screen.getByText('회차마다 낙찰된 사정률입니다. 굵은 선이 내 값입니다.')).toBeTruthy();
    // 범례는 계열 토글 버튼이며 그날 하한은 사정률 축 계열이 아니라 범례에도 없다(PDR-0004).
    const toggles = screen.getAllByRole('button', { pressed: true });
    expect(toggles.map((node) => node.textContent)).toEqual(['━낙찰', '━내 값', '○다른 품목', '▮명단']);
    // 2등은 시안대로 꺼진 채 시작하지만 범례에는 있어 켤 수 있다.
    expect(screen.getByRole('button', { name: '2등', pressed: false })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '그날 하한' })).toBeNull();
  });

  test('비교집단 안내문은 지금 모집단을 문장에 넣어 말한다', () => {
    const screen = render(
      <BidRateProvider initialRate='90.000'>
        <EvidenceTabs auctionId='4821' search={{ period: '12개월', scope: '시군', view: '비교집단', item: null, myRate: null, rate: null, expand: null, pages: 1 }} history={history} distribution={distribution} />
      </BidRateProvider>
    );
    expect(screen.getByText('시군에서 값마다 낙찰된 횟수입니다. 모집단은 위 필터에서 바꿉니다.')).toBeTruthy();
  });

  test('본문이 아직 없는 탭은 무엇이 올 자리인지와 수집 전임을 함께 말한다', () => {
    const screen = renderTabs('업체');
    expect(screen.getByText('수집 전')).toBeTruthy();
    expect(screen.getByText('회차별 명단 계약이 붙으면 참여 업체가 보입니다.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: '회차별 낙찰률 흐름' })).toBeNull();
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

  test('크게 보기 링크는 수집 전 탭을 포함해 네 탭 모두에 있다', () => {
    for (const view of ['비교집단', '흐름', '그날 하한', '업체'] as const) {
      const screen = renderTabs(view);
      const href = screen.getByRole('link', { name: '크게 보기' }).getAttribute('href') ?? '';
      expect(href).toContain(new URLSearchParams({ expand: view }).toString());
      screen.unmount();
    }
  });

  test('모달이 열린 주소에서도 탭 본문은 사다리 그대로이고 히트맵은 인라인으로 그리지 않는다', () => {
    const screen = render(
      <BidRateProvider initialRate='90.000'>
        <EvidenceTabs
          auctionId='4821'
          search={{ ...searchOn('비교집단'), expand: '비교집단' }}
          history={history}
          distribution={distribution}
        />
      </BidRateProvider>
    );
    expect(screen.queryByText('달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.')).toBeNull();
    expect(screen.getByText('전국 · 값마다 낙찰된 횟수')).toBeTruthy();
  });

  test('분포 조회가 실패하면 빈 카드 대신 실패 사실을 말한다', () => {
    const screen = render(
      <BidRateProvider initialRate='90.000'>
        <EvidenceTabs
          auctionId='4821'
          search={searchOn('비교집단')}
          history={history}
          distribution={{ state: 'unavailable' }}
        />
      </BidRateProvider>
    );
    expect(screen.getByText('분포를 지금 불러오지 못했습니다')).toBeTruthy();
  });

  test('회색 처리된 분포는 사다리 대신 사유 한 줄을 말한다', () => {
    const scarce = {
      ...floor90DistributionFixture,
      meta: { ...floor90DistributionFixture.meta, sampleCount: 7 }
    };
    const screen = render(
      <BidRateProvider initialRate='90.000'>
        <EvidenceTabs
          auctionId='4821'
          search={searchOn('비교집단')}
          history={history}
          distribution={{
            state: 'ready',
            presentation: presentDistribution(scarce, { myRate: null, isRegionScope: false }),
            response: scarce
          }}
        />
      </BidRateProvider>
    );
    expect(screen.getByText('표본 7회차')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    // 각주는 회색 상태에서도 남아 왜 비었는지 말한다(AGENTS 7).
    expect(screen.getByText(/표본 7회차 · 표본 부족/)).toBeTruthy();
  });
});
