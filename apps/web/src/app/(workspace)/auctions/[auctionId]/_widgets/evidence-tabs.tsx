/** @module 책임: 공고 분석의 흐름·분포 두 본문을 한 번에 렌더해 두고 어느 것을 보일지·어떻게 키울지를 브라우저 전환과 확대 링크에 연결한다. */
import { Suspense } from 'react';

import {
  DECISION_VIEWS,
  buildDecisionViewRoute,
  type DecisionSearch,
  type DecisionView
} from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_lib/load-auction-page';
import { DistributionFootnote } from '../_features/distribution/ui/distribution-footnote';
// 본문 전환은 브라우저 상태라 client 모듈이 소유한다. 이 서버 카드는 자리와 두 본문의 내용만 정한다.
import { EvidenceViewOnly, EvidenceViewPanel, EvidenceViewTabs, type EvidenceTab } from './evidence-view';
import { DecisionExpandLink } from './decision-expand-link';
import { FlowChart } from '../_features/flow/ui/flow-chart';
// 범례는 계열 토글이라 브라우저 상태가 필요해 client 모듈이 소유한다. 이 서버 카드는 자리만 정한다.
import { FlowLegend } from '../_features/flow/ui/flow-legend';
import { MyRateInput } from '../_features/distribution/ui/my-rate-input';
import { OrderBook } from '../_features/distribution/ui/order-book';
import { OrderBookSummary } from '../_features/distribution/ui/order-book-summary';
import { OwnBidControls } from '../_features/own-bid/ui/own-bid-controls';

type HistoryState = DecisionPageData['history'];
type DistributionState = DecisionPageData['distribution'];

// 분포는 조회 범위가 해석에 영향을 주므로 현재 조건을 안내문에도 함께 표시한다.
function cohortNote(scope: DecisionSearch['scope']): string {
  return `${scope}에서 값마다 낙찰된 횟수입니다. 모집단은 위 필터에서 바꿉니다.`;
}

const VIEW_LABEL: Record<DecisionView, string> = { 흐름: '흐름', 비교집단: '분포' };

/**
 * 분포를 못 그린 이유. 재료가 없는 것(locked)과 조회가 실패한 것(unavailable)은 사용자가 할 일이
 * 다르다. 앞은 수집이 더 필요하고 뒤는 다시 열어보면 될 수 있다.
 */
export const DISTRIBUTION_PENDING_REASON: Record<'missing-terms' | 'missing-axis' | 'unavailable' | 'unsupported-filter', string> = {
  'missing-terms': '이 공고의 하한율과 낙찰방식이 아직 수집되지 않았습니다',
  'missing-axis': '이 모집단을 만들 지역·기관이 아직 정규화되지 않았습니다',
  'unsupported-filter': '분포는 전체 품목·한 가지 하한율·12개월 이하에서 볼 수 있습니다. 선택한 조건의 기관 이력은 흐름과 과거 회차에서 확인하세요.',
  unavailable: '분포를 지금 불러오지 못했습니다'
};

/**
 * 이력을 못 부른 이유를 화면이 그대로 말한다. 두 경우는 사용자가 할 일이 다르다. 기관 미정규화는
 * 수집이 더 필요하다는 뜻이고 조회 실패는 다시 열어보면 될 수 있다. 흐름 탭과 과거 회차 카드가
 * 같은 사유를 말해야 하므로 문구는 여기 한 곳만 소유한다.
 */
export const HISTORY_PENDING_REASON: Record<Exclude<HistoryState['state'], 'ready'>, string> = {
  'no-organization': '이 공고의 구매기관이 아직 정규화되지 않았습니다',
  unavailable: '회차 이력을 지금 불러오지 못했습니다',
  // 이어 읽는 사이 자료 기준이 바뀐 경우다. 부분 목록을 보이지 않으며 복구는 과거 회차 카드가 안내한다.
  'build-changed': '자료가 방금 갱신되어 회차 이력을 새 기준으로 다시 불러와야 합니다'
};

/** 빈 자리에도 사유를 붙인다. 사유 없는 빈 카드·빈 모달은 사용자에게 "고장"으로 읽힌다. */
export function PendingBody({ reason, label = '수집 전' }: { readonly reason: string; readonly label?: '수집 전' | '미확인' }) {
  return (
    <p className='flex items-baseline gap-2 text-[15px] font-medium text-muted-foreground'>
      <span className='text-[13px] font-semibold whitespace-nowrap'>{label}</span>
      <span>{reason}</span>
    </p>
  );
}

// 흐름 차트의 내 값 선은 호가창과 같은 사정률 값(URL `myRate`)을 쓴다. 두 탭이 다른 "내 값"을 그리면
// 사용자가 같은 줄을 두 번 놓아야 한다(PDR-0004).
function FlowBody({
  auctionId,
  search,
  history,
  focus
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly history: HistoryState;
  readonly focus: boolean;
}) {
  if (history.state !== 'ready') return <PendingBody reason={HISTORY_PENDING_REASON[history.state]} />;
  return (
    <>
      {/* 컨트롤은 현재 경로를 읽어 로그인·설정 복귀 링크를 만든다. usePathname은 static shell 생성 중 suspend하므로 leaf로 내린다(ADR 0028). */}
      <Suspense fallback={null}>
        <OwnBidControls auctionId={auctionId} search={search} />
      </Suspense>
      <FlowChart presentation={history.presentation} myRate={search.myRate} focus={focus} />
    </>
  );
}

function CohortBody({
  auctionId,
  search,
  distribution
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly distribution: DistributionState;
}) {
  if (distribution.state !== 'ready') {
    const reason = distribution.state === 'locked' ? distribution.reason : 'unavailable';
    return <PendingBody reason={DISTRIBUTION_PENDING_REASON[reason]} />;
  }
  const { presentation } = distribution;
  return (
    <div className='grid min-w-0 gap-3'>
      <MyRateInput auctionId={auctionId} search={search} />
      {presentation.ladder === null ? (
        // 회색 자리도 사유를 말한다.
        <PendingBody label='미확인' reason={presentation.reason ?? ''} />
      ) : (
        <>
          <OrderBookSummary ladder={presentation.ladder} />
          <OrderBook ladder={presentation.ladder} caption={`${search.scope} · 값마다 낙찰된 횟수`} />
        </>
      )}
      <DistributionFootnote meta={presentation.meta} scope={search.scope} />
    </div>
  );
}

export function EvidenceTabs({
  auctionId,
  search,
  history,
  distribution
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly history: HistoryState;
  readonly distribution: DistributionState;
}) {
  // 두 본문을 함께 렌더한다. `loadAuctionPage`가 view와 무관하게 이력과 분포를 둘 다 읽으므로 탭 전환에
  // 필요한 자료는 이미 이 응답 안에 있고, 다시 부를 이유가 없다(EAT-139).
  const tabs: readonly EvidenceTab[] = DECISION_VIEWS.map((view) => ({
    view,
    label: VIEW_LABEL[view],
    href: buildDecisionViewRoute(auctionId, search, view)
  }));

  return (
    <div data-slot='decision-evidence' className='flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 shadow-xs'>
      <div data-slot='evidence-toolbar' className='flex min-w-0 flex-wrap items-center gap-1'>
        <EvidenceViewTabs tabs={tabs} />
        {/* 범례·확대 링크는 지금 보는 본문에만 뜻이 있다. 두 본문 몫을 미리 그려 두고 켜진 쪽만 남긴다. */}
        <EvidenceViewOnly view='흐름'>
          <FlowLegend />
          <DecisionExpandLink auctionId={auctionId} search={search} target='흐름' />
        </EvidenceViewOnly>
        <EvidenceViewOnly view='비교집단'>
          <DecisionExpandLink auctionId={auctionId} search={search} target='비교집단' />
        </EvidenceViewOnly>
      </div>
      {/* 자리는 카드와 같은 세로 flex다. grid로 두면 열 폭이 내용의 min-content로 잡혀, 오른쪽 상세를 열어
          근거 열이 좁아질 때 차트·사다리가 카드 밖으로 밀린다(EAT-139 e2e 폭 검사). */}
      <EvidenceViewPanel view='비교집단' className='flex min-w-0 flex-col gap-3'>
        <p className='text-[13px] font-medium text-muted-foreground'>{cohortNote(search.scope)}</p>
        <CohortBody auctionId={auctionId} search={search} distribution={distribution} />
      </EvidenceViewPanel>
      <EvidenceViewPanel view='흐름' className='flex min-w-0 flex-col gap-3'>
        <FlowBody auctionId={auctionId} search={search} history={history} focus={search.expand === '흐름'} />
      </EvidenceViewPanel>
    </div>
  );
}
