/** @module 책임: 공고 분석의 흐름·분포 전환과 범례를 조립하고 URL 조건에 맞는 본문과 확대 동작을 연결한다. */
import Link from 'next/link';

import {
  DECISION_VIEWS,
  buildDecisionExpandRoute,
  buildDecisionViewRoute,
  type DecisionSearch,
  type DecisionView
} from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_model/load-auction-page';
import { DistributionFootnote } from './distribution-footnote';
import { FlowChart } from './flow-chart';
// 범례는 계열 토글이라 브라우저 상태가 필요해 client 모듈이 소유한다. 이 서버 카드는 자리만 정한다.
import { FlowLegend } from './flow-legend';
import { MyRateInput } from './my-rate-input';
import { OrderBook } from './order-book';
import { OrderBookSummary } from './order-book-summary';

type HistoryState = DecisionPageData['history'];
type DistributionState = DecisionPageData['distribution'];

// 분포는 조회 범위가 해석에 영향을 주므로 현재 조건을 안내문에도 함께 표시한다.
function note(view: DecisionView, scope: DecisionSearch['scope']): string {
  switch (view) {
    case '비교집단':
      return `${scope}에서 값마다 낙찰된 횟수입니다. 모집단은 위 필터에서 바꿉니다.`;
    case '흐름':
      return '이 기관의 개찰일별 낙찰 기록입니다. 점을 누르면 참여 기록을 볼 수 있어요.';
  }
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
  unavailable: '회차 이력을 지금 불러오지 못했습니다'
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
function FlowBody({ history, myRate, focus }: { readonly history: HistoryState; readonly myRate: string | null; readonly focus: boolean }) {
  if (history.state !== 'ready') return <PendingBody reason={HISTORY_PENDING_REASON[history.state]} />;
  return <FlowChart presentation={history.presentation} myRate={myRate} focus={focus} />;
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

/**
 * 탭마다 늘 있는 크게 보기 링크. 모달은 주소(`expand=<탭>`)가 열므로 링크 하나면 되고, 본문이 수집 전이어도
 * 링크는 남는다 — 모달이 같은 사유를 말한다. 같은 화면 안 주소 변경이라 스크롤 위치는 그대로 둔다.
 */
function ExpandLink({ auctionId, search }: { readonly auctionId: string; readonly search: DecisionSearch }) {
  return (
    <Link
      href={buildDecisionExpandRoute(auctionId, search, search.expand === '흐름' && search.view === '흐름' ? null : search.view)}
      scroll={false}
      className='ml-auto text-[13px] font-semibold whitespace-nowrap text-primary'
    >
      {search.expand === '흐름' && search.view === '흐름' ? '작게 보기' : '크게 보기'}
    </Link>
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
  const active = search.view;

  return (
    <div data-slot='decision-evidence' className='flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex min-w-0 flex-wrap items-center gap-1'>
        <nav aria-label='근거 보기' className='flex flex-wrap items-center gap-1'>
          {DECISION_VIEWS.map((view) => (
            <Link
              key={view}
              href={buildDecisionViewRoute(auctionId, search, view)}
              aria-current={view === active ? 'page' : undefined}
              className={`inline-flex h-9 items-center rounded-md px-3 text-[15px] whitespace-nowrap ${
                view === active ? 'bg-primary/10 font-semibold text-primary' : 'font-medium text-muted-foreground'
              }`}
            >
              {VIEW_LABEL[view]}
            </Link>
          ))}
        </nav>
        {active === '흐름' ? <FlowLegend /> : null}
      </div>
      <p className='text-[13px] font-medium text-muted-foreground'>{note(active, search.scope)}</p>
      {active === '비교집단' ? (
        <CohortBody auctionId={auctionId} search={search} distribution={distribution} />
      ) : (
        <FlowBody history={history} myRate={search.myRate} focus={search.expand === '흐름'} />
      )}
      <div className='flex'>
        <ExpandLink auctionId={auctionId} search={search} />
      </div>
    </div>
  );
}
